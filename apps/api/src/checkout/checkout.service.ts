// Checkout orchestration — the slice's core transaction path.
// Pure of HTTP; depends only on repository interfaces + domain functions.
// Invariants enforced here (per AGENTS.md):
//   • server-side validation only  • re-price before order creation
//   • no orders on empty cart      • canonical idempotency key → no duplicates
//   • claim token signed, single-use

import type { CheckoutRequest, CheckoutResponse, ApiError } from "@sam-store/contracts";
import { validateCheckoutInput } from "../domain/checkout-validation.js";
import { revalidateCartLines, CartRevalidationError } from "../domain/cart.js";
import { computeOrderTotals, InvalidPriceInputError } from "../domain/pricing.js";
import { normalizeIdempotencyKey, InvalidIdempotencyKeyError } from "../domain/idempotency.js";
import { formatOrderNumber } from "../domain/order-number.js";
import { signClaimToken } from "../domain/claim-token.js";
import type {
  CartRepository,
  CatalogRepository,
  OrderRepository,
  OrderSequenceRepository,
  StoreRepository,
  OrderRecord,
} from "../persistence/repositories.js";
import { randomId } from "../persistence/repositories.js";

export type CheckoutResult = { ok: true; value: CheckoutResponse } | { ok: false; error: ApiError };

/** DI token — explicit, so dependency resolution doesn't rely on emitDecoratorMetadata. */
export const CHECKOUT_SERVICE = Symbol("CHECKOUT_SERVICE");

export class CheckoutService {
  constructor(
    private readonly stores: StoreRepository,
    private readonly catalog: CatalogRepository,
    private readonly carts: CartRepository,
    private readonly orders: OrderRepository,
    private readonly sequences: OrderSequenceRepository,
    private readonly claimSecret: string,
  ) {}

  async checkout(request: CheckoutRequest): Promise<CheckoutResult> {
    // 1. Server-side validation (never trust the client)
    const validation = validateCheckoutInput(request);
    if (!validation.ok) {
      return { ok: false, error: { type: "validation", errors: validation.errors } };
    }

    // 2. Canonical idempotency key — checked BEFORE cart/order state so a retry
    //    after a successful checkout returns the SAME order instead of an error.
    let canonicalKey: string;
    try {
      canonicalKey = normalizeIdempotencyKey(request.idempotencyKey);
    } catch (e) {
      if (e instanceof InvalidIdempotencyKeyError) {
        return { ok: false, error: { type: "validation", errors: [e.message] } };
      }
      throw e;
    }
    const existing = await this.orders.findByIdempotencyKey(canonicalKey);
    if (existing) {
      // Idempotent retry must be bound to the same cart, or the claim token would leak
      // to whoever reuses a key. Mismatch → hard conflict, never a response.
      if (existing.cartToken !== request.cartToken) {
        return {
          ok: false,
          error: { type: "conflict", message: "idempotencyKey was already used for a different cart" },
        };
      }
      return { ok: true, value: this.toResponse(existing) };
    }

    // 3. Load the guest cart
    const cart = await this.carts.findByToken(request.cartToken);
    if (!cart) {
      return { ok: false, error: { type: "not_found", message: "Cart not found" } };
    }
    if (cart.status !== "OPEN") {
      return { ok: false, error: { type: "conflict", message: "Cart is no longer open" } };
    }

    // 4. Store must accept guest orders right now
    const store = await this.stores.findById(cart.storeId);
    if (!store) {
      return { ok: false, error: { type: "not_found", message: "Store not found" } };
    }
    if (store.status !== "ACTIVE") {
      return { ok: false, error: { type: "conflict", message: "Store is not accepting orders" } };
    }
    if (store.orderingPaused || !store.guestOrderingEnabled) {
      return {
        ok: false,
        error: {
          type: "conflict",
          message: store.closedStoreMessage ?? "Store is not accepting orders right now",
        },
      };
    }

    // 5. Re-price against live catalog (inventory + price changes)
    const freshProducts = await this.catalog.getProductsByIds(
      cart.storeId,
      cart.lines.map((l) => l.productId),
    );
    let revalidated;
    try {
      revalidated = revalidateCartLines(
        cart.lines,
        new Map(
          freshProducts.map((p) => [p.id, { id: p.id, priceMinor: p.priceMinor, isActive: p.isActive }]),
        ),
      );
    } catch (e) {
      if (e instanceof CartRevalidationError) {
        return { ok: false, error: { type: "validation", errors: ["Cart is empty"] } };
      }
      throw e;
    }

    if (revalidated.lines.length === 0) {
      return { ok: false, error: { type: "conflict", message: "All cart items are unavailable" } };
    }
    if (revalidated.priceChanges.length > 0) {
      // Prices were updated; totals below are computed on the NEW prices. The storefront
      // surfaces revalidated.priceChanges to the customer (AGENTS.md: explain changes).
    }

    // 6. Server-authoritative totals
    let totals;
    try {
      totals = computeOrderTotals({
        lines: revalidated.lines,
        deliveryFeeMinor: store.deliveryFeeMinor,
      });
    } catch (e) {
      if (e instanceof InvalidPriceInputError) {
        return { ok: false, error: { type: "conflict", message: e.message } };
      }
      throw e;
    }

    if (store.minOrderAmountMinor > 0 && totals.totalMinor < store.minOrderAmountMinor) {
      return {
        ok: false,
        error: { type: "conflict", message: "Total is below the store's minimum order amount" },
      };
    }

    // 7. Order number from store-scoped sequence
    const seq = await this.sequences.nextOrderSequence(store.id);
    const orderNumber = formatOrderNumber(store.slug, seq);

    // 8. Immutable line items (names/SKUs snapshot at purchase time)
    const items = revalidated.lines.map((line) => {
      const product = freshProducts.find((p) => p.id === line.productId);
      return {
        productId: product?.id ?? null,
        productName: product?.name ?? "Unknown product",
        sku: product?.sku ?? "UNKNOWN",
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        lineTotalMinor: line.unitPriceMinor * line.quantity,
      };
    });

    // 9. Persist order with immutable snapshot + claim token (persisted so an
    //    idempotent retry after a lost response can return the SAME token).
    const id = randomId();
    const claimToken = signClaimToken(id, this.claimSecret);
    const order: OrderRecord = {
      id,
      orderNumber,
      storeId: store.id,
      status: "RECEIVED",
      currencyCode: store.currencyCode,
      subtotalMinor: totals.subtotalMinor,
      deliveryFeeMinor: totals.deliveryFeeMinor,
      discountMinor: totals.discountMinor,
      totalMinor: totals.totalMinor,
      snapshot: {
        lines: revalidated.lines,
        items,
        priceChanges: revalidated.priceChanges,
        store: { slug: store.slug, name: store.name },
        paymentMethod: "cod",
      },
      paymentMethod: "cod",
      paymentStatus: "PENDING",
      idempotencyKey: canonicalKey,
      cartToken: cart.token,
      customerName: request.customerName.trim(),
      customerPhone: request.customerPhone.trim(),
      deliveryAddressLine1: request.deliveryAddressLine1.trim(),
      deliveryAddressLine2: request.deliveryAddressLine2?.trim() ?? null,
      landmark: request.landmark?.trim() ?? null,
      deliverySchedule: request.deliverySchedule?.trim() ?? null,
      notes: request.notes?.trim() ?? null,
      claimToken,
      items,
      createdAt: new Date(),
    };
    const created = await this.orders.create(order);

    // 9. Cart is spent
    await this.carts.save({ ...cart, status: "CONVERTED" });

    return {
      ok: true,
      value: {
        orderId: created.id,
        orderNumber: created.orderNumber,
        status: "RECEIVED",
        totalMinor: created.totalMinor,
        currencyCode: created.currencyCode,
        claimToken: created.claimToken!,
      },
    };
  }

  private toResponse(order: OrderRecord): CheckoutResponse {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status as CheckoutResponse["status"],
      totalMinor: order.totalMinor,
      currencyCode: order.currencyCode,
      claimToken: order.claimToken ?? "",
    };
  }
}