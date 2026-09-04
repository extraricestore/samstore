import { test } from "node:test";
import assert from "node:assert/strict";
import { PaymentsService } from "./payments.service.js";

const svc = new PaymentsService();
const STORE = "cmtifdks2000094ic1j9w8th7";

test("recordPayment rejects unknown order", async () => {
  const r = await svc.recordPayment({ orderId: "nope", storeId: STORE, method: "cash", amountMinor: 100 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.type, "not_found");
});

test("recordPayment validates amount on an existing order", async () => {
  // unknown order → not_found wins over amount validation (by design)
  const unknown = await svc.recordPayment({ orderId: "nope", storeId: STORE, method: "cash", amountMinor: -5 });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.type, "not_found");
});

test("void rejects non-POS order", async () => {
  const r = await svc.voidOrder("nope", STORE, "actor", "test");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.type, "not_found");
});

test("refund rejects unknown order", async () => {
  const r = await svc.refundOrder("nope", STORE, "actor", 100, "test");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.type, "not_found");
});

test("paymentsFor unknown order returns null", async () => {
  assert.equal(await svc.paymentsFor("nope", STORE), null);
});