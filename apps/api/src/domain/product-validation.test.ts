import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProductInput, slugify } from "./product-validation.js";

test("valid product input passes", () => {
  assert.deepEqual(
    validateProductInput({ name: "Kape Barako", sku: "KAPE-001", priceMinor: 12000, stock: 10 }),
    { ok: true },
  );
});

test("name too short or empty fails", () => {
  assert.equal(validateProductInput({ name: "A", sku: "SKU-1", priceMinor: 100 }).ok, false);
  assert.equal(validateProductInput({ name: "", sku: "SKU-1", priceMinor: 100 }).ok, false);
});

test("missing sku fails", () => {
  const r = validateProductInput({ name: "Kape", sku: "", priceMinor: 100 });
  assert.equal(r.ok, false);
});

test("negative or fractional price fails", () => {
  assert.equal(validateProductInput({ name: "Kape", sku: "SKU-1", priceMinor: -1 }).ok, false);
  assert.equal(validateProductInput({ name: "Kape", sku: "SKU-1", priceMinor: 10.5 }).ok, false);
});

test("negative stock fails", () => {
  assert.equal(validateProductInput({ name: "Kape", sku: "SKU-1", priceMinor: 100, stock: -1 }).ok, false);
});

test("slugify normalizes names", () => {
  assert.equal(slugify("Kape Barako"), "kape-barako");
  assert.equal(slugify("Turon (4 pcs)!!"), "turon-4-pcs");
  assert.equal(slugify("  UPPER  Case  "), "upper-case");
});