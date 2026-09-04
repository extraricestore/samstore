import { test } from "node:test";
import assert from "node:assert/strict";
import { ReportsService } from "./reports.service.js";

const svc = new ReportsService();

test("profitSummary returns shaped estimate for unknown store", async () => {
  const r = await svc.profitSummary("nope", new Date(Date.now() - 86_400_000), new Date());
  assert.equal(typeof r.revenueMinor, "number");
  assert.equal(typeof r.profitMinor, "number");
  assert.equal(typeof r.cogsNote, "string");
});

test("salesReport returns splits", async () => {
  const r = await svc.salesReport("nope", new Date(Date.now() - 86_400_000), new Date());
  assert.ok(Array.isArray(r.paymentSplit));
  assert.ok(Array.isArray(r.topCustomers));
  assert.equal(typeof r.utangAging.currentMinor, "number");
});