"use client";

import { useState } from "react";
import type { CheckoutResponse } from "../types";

interface CheckoutFormProps {
  cartToken: string;
  deliveryFeeMinor: number;
  totalMinor: number;
  onSuccess: (r: CheckoutResponse) => void;
  onClose: () => void;
}

const toPesos = (minor: number) => `₱${(minor / 100).toFixed(2)}`;

export default function CheckoutForm({ cartToken, deliveryFeeMinor, totalMinor, onSuccess, onClose }: CheckoutFormProps) {
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    deliveryAddressLine1: "",
    deliveryAddressLine2: "",
    landmark: "",
    deliverySchedule: "",
    notes: "",
    voucherCode: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, cartToken, paymentMethod: "cod", idempotencyKey, voucherCode: form.voucherCode.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errors = (data?.errors as string[]) ?? [data?.message ?? "Checkout failed"];
        setError(Array.isArray(errors) ? errors.join(" · ") : String(errors));
        return;
      }
      onSuccess(data as CheckoutResponse);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="checkout-form">
      <h5 className="mb-3">Checkout</h5>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      <form onSubmit={submit}>
        <div className="mb-2">
          <label className="form-label small">Full name *</label>
          <input className="form-control" value={form.customerName} onChange={set("customerName")} required minLength={2} />
        </div>
        <div className="mb-2">
          <label className="form-label small">Phone *</label>
          <input className="form-control" value={form.customerPhone} onChange={set("customerPhone")} required placeholder="+63..." />
        </div>
        <div className="mb-2">
          <label className="form-label small">Address line 1 *</label>
          <input className="form-control" value={form.deliveryAddressLine1} onChange={set("deliveryAddressLine1")} required minLength={5} placeholder="House no. & street" />
        </div>
        <div className="mb-2">
          <label className="form-label small">Address line 2</label>
          <input className="form-control" value={form.deliveryAddressLine2} onChange={set("deliveryAddressLine2")} placeholder="Barangay / city" />
        </div>
        <div className="mb-2">
          <label className="form-label small">Landmark</label>
          <input className="form-control" value={form.landmark} onChange={set("landmark")} />
        </div>
        <div className="mb-2">
          <label className="form-label small">Delivery schedule</label>
          <input className="form-control" value={form.deliverySchedule} onChange={set("deliverySchedule")} placeholder="e.g. Today 5-8pm" />
        </div>
        <div className="mb-2">
          <label className="form-label small">Notes</label>
          <input className="form-control" value={form.notes} onChange={set("notes")} />
        </div>
        <div className="mb-3">
          <label className="form-label small">Voucher code</label>
          <input className="form-control" value={form.voucherCode} onChange={set("voucherCode")} placeholder="e.g. SAM10 (optional)" />
        </div>

        <div className="d-flex justify-content-between align-items-center mb-3">
          <span className="small text-muted">Total (incl. {toPesos(deliveryFeeMinor)} delivery)</span>
          <strong>{toPesos(totalMinor)}</strong>
        </div>
        <div className="alert alert-light border small mb-3">
          <i className="bi bi-cash me-1"></i> Cash on delivery
        </div>

        <div className="d-grid gap-2">
          <button className="btn btn-success" type="submit" disabled={submitting}>
            {submitting ? "Placing order…" : "Place order (Cash on Delivery)"}
          </button>
          <button className="btn btn-outline-secondary" type="button" onClick={onClose}>
            Back to cart
          </button>
        </div>
      </form>
    </div>
  );
}