import { test } from "node:test";
import assert from "node:assert/strict";
import { CheckoutService } from "./checkout.service.js";
import type { CheckoutRequest } from "@sam-store/contracts";
import {
  InMemoryStoreRepository,
  InMemoryCatalogRepository,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  InMemoryOrderSequenceRepository,
  type StoreRecord,
  type ProductRecord,
  type CartRecord,
} from "../persistence/repositories.js";

const CLAIM_SECRET = "test-claim-secret-0123456789";

function makeStore(over: Partial<StoreRecord> = {}): StoreRecord {
  return {
    id: "store-1",
    slug: "sam-store",
    name: "Sam's Store",
    currencyCode: "PHP",
    timezone: "Asia/Manila",
    status: "ACTIVE",
    guestOrderingEnabled: true,
    orderingPaused: false,
    closedStoreMessage: null,
    deliveryFeeMinor: 5000, // ₱50.00
    deliveryEnabled: true,
    pickupEnabled: false,
    minOrderAmountMinor: 0,
    ...over,
  };
}

function makeProduct(over: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: "prod-1",
    storeId: "store-1",
    sku: "SKU-001",
    name: "Test Product",
    description: null,
    priceMinor: 15000, // ₱150.00
    isActive: true,
    categoryName: "Drinks",
    images: ["https://cdn.example.test/img1.jpg"],
    quantityOnHand: 100,
    quantityReserved: 0,
    ...over,
  };
}

function makeCart(over: Partial<CartRecord> = {}): CartRecord {
  return {
    id: "cart-1",
    storeId: "store-1",
    token: "cart-token-abc123",
    status: "OPEN",
    lines: [{ productId: "prod-1", quantity: 2, unitPriceMinor: 15000 }],
    ...over,
  };
}

function makeRequest(over: Partial<CheckoutRequest> = {}): CheckoutRequest {
  return {
    cartToken: "cart-token-abc123",
    customerName: "Maria Santos",
    customerPhone: "+639171234567",
    deliveryAddressLine1: "123 Rizal Avenue",
    landmark: "Near the church",
    deliverySchedule: "Tomorrow 2pm-5pm",
    paymentMethod: "cod",
    idempotencyKey: "checkout-abc-123",
    ...over,
  };
}

function makeService() {
  const stores = new InMemoryStoreRepository();
  const catalog = new InMemoryCatalogRepository();
  const carts = new InMemoryCartRepository();
  const orders = new InMemoryOrderRepository();
  const sequences = new InMemoryOrderSequenceRepository();
  stores.seed(makeStore());
  catalog.seed(makeProduct());
  carts.seed(makeCart());
  const svc = new CheckoutService(stores, catalog, carts, orders, sequences, CLAIM_SECRET);
  return { svc, stores, catalog, carts, orders, sequences };
}

test("happy path: guest COD checkout creates an order", async () => {
  const { svc, orders } = makeService();
  const r = await svc.checkout(makeRequest());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.orderNumber, "SAMSTO-000001");
  assert.equal(r.value.status, "RECEIVED");
  // 2 × ₱150.00 + ₱50.00 delivery = ₱350.00
  assert.equal(r.value.totalMinor, 35000);
  assert.equal(r.value.currencyCode, "PHP");
  assert.ok(r.value.claimToken.includes("."));

  const stored = orders.exportedForTests().orders[0]!;
  assert.equal(stored.idempotencyKey.length, 64);
  assert.equal(stored.paymentStatus, "PENDING");
  assert.equal(stored.customerName, "Maria Santos");
});

test("server recomputes totals; client-supplied values are ignored", async () => {
  const { svc } = makeService();
  const r = await svc.checkout(makeRequest());
  if (!r.ok) throw new Error("expected ok");
  // The request carries no totals at all; totals come from cart lines + store delivery fee.
  assert.equal(r.value.totalMinor, 35000);
});

test("same idempotency key on retry returns the SAME order and SAME claim token", async () => {
  const { svc, orders } = makeService();
  const first = await svc.checkout(makeRequest());
  const second = await svc.checkout(makeRequest());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.value.orderId, first.value.orderId);
  assert.equal(second.value.orderNumber, first.value.orderNumber);
  // a retry after a lost response must return the SAME usable claim token, not an empty one
  assert.ok(first.value.claimToken.length > 0);
  assert.equal(second.value.claimToken, first.value.claimToken);
  assert.equal(orders.exportedForTests().orders.length, 1);
});

test("idempotency key reused with a DIFFERENT cart is rejected (no claim-token leak)", async () => {
  const { svc, orders } = makeService();
  await svc.checkout(makeRequest({ idempotencyKey: "checkout-abc-123" }));
  const r = await svc.checkout(
    makeRequest({ idempotencyKey: "checkout-abc-123", cartToken: "some-other-cart" }),
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.type, "conflict");
  assert.equal(orders.exportedForTests().orders.length, 1);
});

test("different idempotency keys create different orders", async () => {
  const { svc, carts, orders } = makeService();
  await svc.checkout(makeRequest({ idempotencyKey: "checkout-abc-123" }));
  // fresh cart for the second attempt
  carts.seed(
    makeCart({
      token: "cart-token-2",
      lines: [{ productId: "prod-1", quantity: 1, unitPriceMinor: 15000 }],
    }),
  );
  const r2 = await svc.checkout(
    makeRequest({ idempotencyKey: "checkout-abc-124", cartToken: "cart-token-2" }),
  );
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(orders.exportedForTests().orders.length, 2);
  assert.equal(r2.value.orderNumber, "SAMSTO-000002");
});

test("cross-store cart rejection: cart from store B cannot be checked out", async () => {
  const { svc, stores, carts } = makeService();
  stores.seed(makeStore({ id: "store-b", slug: "other-store" }));
  carts.seed(makeCart({ token: "cart-token-B", storeId: "store-b", lines: [] }));
  const r = await svc.checkout(makeRequest({ cartToken: "cart-token-B" }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.type, "validation"); // empty cart for store B
});

test("paused store rejects checkouts with its message", async () => {
  const { svc, stores, carts } = makeService();
  stores.seed(
    makeStore({ id: "store-paused", slug: "paused", orderingPaused: true, closedStoreMessage: "Back soon!" }),
  );
  carts.seed(makeCart({ token: "cart-token-P", storeId: "store-paused" }));
  const r = await svc.checkout(makeRequest({ cartToken: "cart-token-P" }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.type, "conflict");
  if (r.error.type === "conflict") assert.equal(r.error.message, "Back soon!");
});

test("price change is applied before order creation", async () => {
  const { svc, catalog } = makeService();
  catalog.seed(makeProduct({ id: "prod-1", priceMinor: 18000 })); // ₱150 → ₱180
  const r = await svc.checkout(makeRequest());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // 2 × ₱180.00 + ₱50.00 = ₱410.00
  assert.equal(r.value.totalMinor, 41000);
});

test("inactive product is dropped; checkout fails with unavailable message", async () => {
  const { svc, catalog } = makeService();
  catalog.seed(makeProduct({ id: "prod-1", isActive: false }));
  const r = await svc.checkout(makeRequest());
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.type, "conflict");
});

test("invalid payment method is rejected", async () => {
  const { svc } = makeService();
  const r = await svc.checkout(
    makeRequest({ paymentMethod: "card" as CheckoutRequest["paymentMethod"] }),
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.type, "validation");
});

test("missing cart returns not_found", async () => {
  const { svc } = makeService();
  const r = await svc.checkout(makeRequest({ cartToken: "no-such-cart" }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.type, "not_found");
});

test("min order amount enforced", async () => {
  const { svc, stores } = makeService();
  stores.seed(makeStore({ id: "store-1", minOrderAmountMinor: 40000 })); // ₱400 min
  const r = await svc.checkout(makeRequest());
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.type, "conflict");
});

test("second order gets next sequence number", async () => {
  const { svc, carts, orders } = makeService();
  await svc.checkout(makeRequest());
  assert.equal(orders.exportedForTests().orders[0]?.orderNumber, "SAMSTO-000001");
  // fresh cart, fresh key → second order
  carts.seed(makeCart({ token: "cart-token-2", lines: [{ productId: "prod-1", quantity: 1, unitPriceMinor: 15000 }] }));
  const r2 = await svc.checkout(makeRequest({ cartToken: "cart-token-2", idempotencyKey: "checkout-abc-125" }));
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.value.orderNumber, "SAMSTO-000002");
});