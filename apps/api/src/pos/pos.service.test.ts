import { test } from "node:test";
import assert from "node:assert/strict";
import { PosService } from "./pos.service.js";

const svc = new PosService();

test("empty items rejected", async () => {
  const r = await svc.sell("storeX", "actorX", { items: [], paymentMethod: "cash" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.type, "validation");
});

test("invalid quantity rejected", async () => {
  for (const q of [0, -1, 1.5, 100]) {
    const r = await svc.sell("storeX", "actorX", { items: [{ productId: "p", quantity: q }], paymentMethod: "cash" });
    assert.equal(r.ok, false, `qty ${q} should be rejected`);
    if (!r.ok) assert.equal(r.error.type, "validation");
  }
});

test("invalid payment method rejected", async () => {
  const r = await svc.sell("storeX", "actorX", {
    items: [{ productId: "p", quantity: 1 }],
    paymentMethod: "card" as "cash",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.type, "validation");
});

test("unknown store returns not_found", async () => {
  const r = await svc.sell("store-does-not-exist", "actorX", {
    items: [{ productId: "p", quantity: 1 }],
    paymentMethod: "cash",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.type, "not_found");
});

test("payment effects treat COMPLETED as collected", async () => {
  const { paymentEffectFor } = await import("../domain/order-state.js");
  assert.equal(paymentEffectFor("COMPLETED", "PENDING"), "COLLECTED");
  assert.equal(paymentEffectFor("DELIVERED", "PENDING"), "COLLECTED");
});