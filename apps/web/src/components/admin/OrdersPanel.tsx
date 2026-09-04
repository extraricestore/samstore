"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders, type AdminOrder, getAdminRole, roleCan } from "../../lib/admin";
import ReceiptModal from "./ReceiptModal";
import { toast } from "../../lib/toast";

const ALLOWED: Record<string, string[]> = {
  RECEIVED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED_DELIVERY"],
  DELIVERED: [],
  COMPLETED: [],
  CANCELLED: [],
  FAILED_DELIVERY: ["OUT_FOR_DELIVERY"],
};

const STATUS_BADGE: Record<string, string> = {
  RECEIVED: "text-bg-secondary",
  CONFIRMED: "text-bg-info",
  PREPARING: "text-bg-warning",
  READY: "text-bg-primary",
  OUT_FOR_DELIVERY: "text-bg-dark",
  DELIVERED: "text-bg-success",
  COMPLETED: "text-bg-success",
  CANCELLED: "text-bg-danger",
  FAILED_DELIVERY: "text-bg-danger",
};

export default function OrdersPanel() {
  const role = getAdminRole();
  const canVoidRefund = roleCan(role, "voidRefund");
    const canWrite = roleCan(role, "write");
    const [orderDetail, setOrderDetail] = useState<AdminOrder | null>(null);
    const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [pendingReason, setPendingReason] = useState<{ orderId: string; to: string } | null>(null);
  const [reason, setReason] = useState("");
  const [receiptOrder, setReceiptOrder] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ orderId: string; kind: "void" | "refund" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/orders`, {
        headers: { ...adminHeaders() },
      });
      if (!res.ok) throw new Error("Failed to load orders");
      const data = await res.json();
      setOrders(data.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const transition = async (orderId: string, toStatus: string) => {
    if (toStatus === "CANCELLED" || toStatus === "FAILED_DELIVERY") {
      setPendingReason({ orderId, to: toStatus });
      return;
    }
    await doTransition(orderId, toStatus);
  };

  const doVoidRefund = async (orderId: string, kind: "void" | "refund", reasonText?: string) => {
    setTransitioning(orderId);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/orders/${orderId}/${kind}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ reason: reasonText }),
      });
      const data = await res.json();
            if (!res.ok) { setError(data?.message ?? `${kind} failed`); return; }
            setConfirmAction(null);
            setReason("");
            toast(`${kind === "void" ? "Voided" : "Refunded"} → CANCELLED`);
            void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${kind} failed`);
    } finally {
      setTransitioning(null);
    }
  };

  const doTransition = async (orderId: string, toStatus: string, reasonText?: string) => {
    setTransitioning(orderId);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ toStatus, reason: reasonText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? "Transition failed");
        return;
      }
      setPendingReason(null);
            setReason("");
            toast(`Order → ${toStatus}`);
            void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed");
    } finally {
      setTransitioning(null);
    }
  };

  const toPesos = (minor: number) => `₱${(minor / 100).toFixed(2)}`;

  return (
    <div>
      <h1 className="h4 mb-3">Orders</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      {loading ? (
        <p className="text-muted">Loading orders…</p>
      ) : orders.length === 0 ? (
        <p className="text-muted">No orders yet.</p>
      ) : (
        <div className="table-responsive">
                  <table className="table table-hover align-middle">
                    <thead>
                    <tr>
                      <th>Order</th>
              <th>Customer</th>
              <th>Phone</th>
              <th className="text-end">Total</th>
              <th>Status</th>
              <th>Update status</th>
              <th>Placed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const next = ALLOWED[o.status] ?? [];
              return (
                <tr key={o.id}>
                  <td className="fw-semibold">{o.orderNumber}</td>
                  <td>{o.customerName}</td>
                  <td>{o.customerPhone}</td>
                  <td className="text-end">{toPesos(o.totalMinor)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[o.status] ?? "text-bg-secondary"}`}>{o.status}</span>
                  </td>
                  <td>
                                      {canWrite && next.length > 0 ? (
                      <select
                        className="form-select form-select-sm"
                        style={{ width: 160 }}
                        value=""
                        disabled={transitioning === o.id}
                        onChange={(e) => e.target.value && transition(o.id, e.target.value)}
                      >
                        <option value="" disabled>— transition —</option>
                        {next.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-muted small">{canWrite ? "terminal" : "view only"}</span>
                    )}
                  </td>
                  <td className="text-muted small">{new Date(o.createdAt).toLocaleString()}</td>
                  <td className="text-end">
                                      {canWrite && (
                                        <button className="btn btn-sm btn-outline-secondary me-1" title="Receipt" onClick={() => setReceiptOrder(o.id)}>
                                          <i className="bi bi-receipt"></i>
                                        </button>
                                      )}
                                      {canVoidRefund && o.status === "COMPLETED" && (
                                        <button
                                          className="btn btn-sm btn-outline-danger me-1"
                                          title="Void/Refund"
                                          onClick={() => setConfirmAction({ orderId: o.id, kind: o.paymentStatus === "COLLECTED" ? "refund" : "void" })}
                                        >
                                          <i className="bi bi-x-circle"></i>
                                        </button>
                                      )}
                                      <button className="btn btn-sm btn-outline-secondary" onClick={() => setOrderDetail(o)} title="Details">
                                        <i className="bi bi-view-list"></i>
                                      </button>
                                    </td>
                                  </tr>
              );
            })}
          </tbody>
        </table>
                </div>
              )}

      {/* Reason modal for cancellations / failed delivery */}
      {pendingReason && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Reason for {pendingReason.to}</h5>
                  <button type="button" className="btn-close" onClick={() => setPendingReason(null)}></button>
                </div>
                <div className="modal-body">
                  <label className="form-label small">Reason (required)</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Customer request, out of stock…"
                  />
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setPendingReason(null)}>Cancel</button>
                  <button
                    className="btn btn-danger"
                    disabled={reason.trim().length < 3}
                    onClick={() => doTransition(pendingReason.orderId, pendingReason.to, reason)}
                  >
                    Confirm {pendingReason.to}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}

      {/* Void / refund confirm modal */}
      {confirmAction && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{confirmAction.kind === "void" ? "Void sale" : "Refund sale"}</h5>
                  <button type="button" className="btn-close" onClick={() => setConfirmAction(null)}></button>
                </div>
                <div className="modal-body">
                  <p className="small">
                    {confirmAction.kind === "void"
                      ? "This reverses the sale and restores stock. Only uncollected POS sales can be voided."
                      : "This records a refund and cancels the order. Stock is not restored."}
                  </p>
                  <input
                    className="form-control form-control-sm"
                    placeholder="Reason (optional)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                  <button
                    className="btn btn-danger"
                    disabled={transitioning === confirmAction.orderId}
                    onClick={() => doVoidRefund(confirmAction.orderId, confirmAction.kind, reason)}
                  >
                    {transitioning === confirmAction.orderId ? "Working…" : `Confirm ${confirmAction.kind}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}

      {receiptOrder && <ReceiptModal orderId={receiptOrder} onClose={() => setReceiptOrder(null)} />}
            {orderDetail && (
              <>
                <div className="modal fade show d-block" tabIndex={-1}>
                  <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content">
                      <div className="modal-header">
                        <h5 className="modal-title">{orderDetail.orderNumber}</h5>
                        <button type="button" className="btn-close" onClick={() => setOrderDetail(null)}></button>
                      </div>
                      <div className="modal-body small">
                        <dl className="row mb-2">
                          <dt className="col-5">Customer</dt><dd className="col-7">{orderDetail.customerName}</dd>
                          <dt className="col-5">Phone</dt><dd className="col-7">{orderDetail.customerPhone || "—"}</dd>
                          <dt className="col-5">Status</dt><dd className="col-7"><span className="badge text-bg-secondary">{orderDetail.status}</span></dd>
                          <dt className="col-5">Total</dt><dd className="col-7 fw-semibold">{toPesos(orderDetail.totalMinor)}</dd>
                          {orderDetail.paymentStatus && <><dt className="col-5">Payment</dt><dd className="col-7">{orderDetail.paymentStatus}</dd></>}
                          {orderDetail.source && <><dt className="col-5">Source</dt><dd className="col-7">{orderDetail.source}</dd></>}
                        </dl>
                      </div>
                      <div className="modal-footer">
                        <button className="btn btn-outline-secondary btn-sm" onClick={() => setOrderDetail(null)}>Close</button>
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