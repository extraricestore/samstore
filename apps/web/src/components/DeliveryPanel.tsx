"use client";

// Mobile delivery site (DELIVERY role): "My deliveries" — all OUT_FOR_DELIVERY orders
// of the store, with address/phone/landmark/schedule; mark DELIVERED / FAILED_DELIVERY.

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../config";
import { getAdminToken } from "../lib/admin";

interface DeliveryOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  deliveryAddressLine1: string;
  deliveryAddressLine2: string | null;
  landmark: string | null;
  deliverySchedule: string | null;
  notes: string | null;
  totalMinor: number;
  paymentMethod: string;
  createdAt: string;
  items: { productName: string; quantity: number; lineTotalMinor: number }[];
}

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;

export default function DeliveryPanel() {
  const [deliveries, setDeliveries] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failTarget, setFailTarget] = useState<{ id: string; orderNumber: string } | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/delivery/orders`, { headers: { Authorization: `Bearer ${getAdminToken()}` } });
      if (!res.ok) throw new Error("Failed to load deliveries (DELIVERY role required)");
      const data = await res.json();
      setDeliveries(data.deliveries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000); // courier auto-refresh
    return () => clearInterval(t);
  }, [load]);

  const mark = async (id: string, toStatus: "DELIVERED" | "FAILED_DELIVERY") => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/delivery/orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ toStatus, reason: toStatus === "FAILED_DELIVERY" ? (reason || "Delivery failed") : undefined }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d?.message ?? "Update failed"); return; }
      setFailTarget(null);
      setReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container py-4" style={{ maxWidth: 560 }}>
      <div className="d-flex align-items-center gap-2 mb-3">
        <i className="bi bi-truck fs-3"></i>
        <div>
          <h1 className="h5 mb-0">My deliveries</h1>
          <small className="text-muted">All orders out for delivery — updates every 15s</small>
        </div>
        <button className="btn btn-sm btn-outline-secondary ms-auto" onClick={load}><i className="bi bi-arrow-clockwise"></i></button>
      </div>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : deliveries.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <i className="bi bi-box-seam fs-1 d-block mb-2"></i>
          No orders out for delivery right now.
        </div>
      ) : (
        <div className="d-grid gap-3">
          {deliveries.map((o) => (
            <div className="card" key={o.id}>
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <div>
                    <span className="fw-bold">{o.orderNumber}</span>
                    <div className="small text-muted">{new Date(o.createdAt).toLocaleString()}</div>
                  </div>
                  <span className="badge text-bg-dark">{toPesos(o.totalMinor)} · {o.paymentMethod}</span>
                </div>
                <div className="mb-2">
                  <div className="fw-semibold"><i className="bi bi-person me-1"></i>{o.customerName}</div>
                  <div className="small"><i className="bi bi-telephone me-1"></i>{o.customerPhone || "no phone"}</div>
                  <div className="small"><i className="bi bi-geo-alt me-1"></i>{o.deliveryAddressLine1}{o.deliveryAddressLine2 ? `, ${o.deliveryAddressLine2}` : ""}</div>
                  {o.landmark && <div className="small text-muted"><i className="bi bi-signpost me-1"></i>Near: {o.landmark}</div>}
                  {o.deliverySchedule && <div className="small text-muted"><i className="bi bi-clock me-1"></i>Schedule: {o.deliverySchedule}</div>}
                  {o.notes && <div className="small text-muted"><i className="bi bi-chat-left-text me-1"></i>{o.notes}</div>}
                </div>
                <div className="small text-muted mb-3">
                  {o.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}
                </div>
                <div className="d-flex gap-2">
                  <button className="btn btn-success btn-sm flex-fill" disabled={busyId === o.id} onClick={() => mark(o.id, "DELIVERED")}>
                    <i className="bi bi-check-lg me-1"></i>Delivered
                  </button>
                  <button className="btn btn-outline-danger btn-sm flex-fill" disabled={busyId === o.id} onClick={() => setFailTarget({ id: o.id, orderNumber: o.orderNumber })}>
                    <i className="bi bi-x-lg me-1"></i>Failed delivery
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Failed delivery reason modal */}
      {failTarget && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Failed delivery — {failTarget.orderNumber}</h5>
                  <button type="button" className="btn-close" onClick={() => setFailTarget(null)}></button>
                </div>
                <div className="modal-body">
                  <label className="form-label small">Reason (required)</label>
                  <textarea className="form-control" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer not home, wrong address…" />
                </div>
                <div className="modal-footer">
                  <button className="btn btn-outline-secondary" onClick={() => setFailTarget(null)}>Cancel</button>
                  <button className="btn btn-danger" disabled={reason.trim().length < 3} onClick={() => mark(failTarget.id, "FAILED_DELIVERY")}>
                    Mark failed
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}
    </div>
  );
}