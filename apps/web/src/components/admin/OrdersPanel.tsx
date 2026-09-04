"use client";

// Orders (V2) — tabs Today/Pending/On Process/Completed/Void, day-range + customer filter,
// mobile-first cards (table on ≥md). On-Process allows editing held (ON_HOLD) orders,
// paying (cash w/ tendered / utang w/ dates), or voiding — plus the existing transitions
// for delivery-flow statuses. Role-gated via roleCan.

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
  ON_HOLD: [], // handled by dedicated edit/pay/void buttons
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
  ON_HOLD: "text-bg-warning",
  COMPLETED: "text-bg-success",
  CANCELLED: "text-bg-danger",
  FAILED_DELIVERY: "text-bg-danger",
};

const TABS: { id: string; label: string; status?: string[] }[] = [
  { id: "today", label: "Today", status: undefined },
  { id: "pending", label: "Pending", status: ["RECEIVED"] },
  { id: "onprocess", label: "On Process", status: ["CONFIRMED", "PREPARING", "READY", "ON_HOLD"] },
  { id: "fordelivery", label: "For Delivery", status: ["OUT_FOR_DELIVERY"] },
  { id: "completed", label: "Completed", status: ["DELIVERED", "COMPLETED"] },
  { id: "void", label: "Void", status: ["CANCELLED", "FAILED_DELIVERY"] },
];

interface EditLine { productId: string; productName: string; quantity: number; unitPriceMinor: number }
interface ProductOption { id: string; name: string; sku: string }

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;
const dayRange = (d: Date) => ({ from: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).toISOString(), to: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString() });

export default function OrdersPanel() {
  const role = getAdminRole();
  const canVoidRefund = roleCan(role, "voidRefund");
  const canWrite = roleCan(role, "write");
  const [tab, setTab] = useState("today");
  const [range, setRange] = useState<"today" | "yesterday" | "tomorrow" | "custom">("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customer, setCustomer] = useState("");
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [pendingReason, setPendingReason] = useState<{ orderId: string; to: string } | null>(null);
  const [reason, setReason] = useState("");
  const [receiptOrder, setReceiptOrder] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ orderId: string; kind: "void" | "refund" | "voidHold" } | null>(null);
  const [orderDetail, setOrderDetail] = useState<AdminOrder | null>(null);
  // On-process editing
  const [editHold, setEditHold] = useState<{ id: string; orderNumber: string; status: string; lines: EditLine[] } | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [payHold, setPayHold] = useState<{ id: string; orderNumber: string; totalMinor: number } | null>(null);
  const [payMethod, setPayMethod] = useState<"cash" | "credit">("cash");
  const [tendered, setTendered] = useState("");
  const [startAt, setStartAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [payCustomerId, setPayCustomerId] = useState("");
  const [customers, setCustomers] = useState<{ id: string; name: string | null }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      const cur = TABS.find((t) => t.id === tab)!;
      if (cur.status) q.set("status", cur.status.join(","));
      if (tab === "today" || range !== "custom") {
        const base = range === "today" ? new Date() : range === "yesterday" ? new Date(Date.now() - 86_400_000) : new Date(Date.now() + 86_400_000);
        const d = dayRange(base);
        q.set("from", d.from);
        q.set("to", d.to);
      } else {
        if (customFrom) q.set("from", new Date(customFrom).toISOString());
        if (customTo) q.set("to", new Date(new Date(customTo).getTime() + 86_399_000).toISOString());
      }
      if (customer.trim()) q.set("customer", customer.trim());
      const res = await fetch(`${API_URL}/admin/orders?${q.toString()}`, { headers: adminHeaders() });
      if (!res.ok) throw new Error("Failed to load orders");
      const data = await res.json();
      setOrders(data.orders ?? []);
      if (canWrite) {
        const p = await fetch(`${API_URL}/admin/products`, { headers: adminHeaders() }).then((r) => r.json());
        const c = await fetch(`${API_URL}/admin/customers`, { headers: adminHeaders() }).then((r) => r.json());
        setProducts((p.products ?? []).map((x: any) => ({ id: x.id, name: x.name, sku: x.sku })));
        setCustomers((c.customers ?? []).map((x: any) => ({ id: x.id, name: x.name ?? x.email ?? x.phone ?? "Customer" })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [tab, range, customFrom, customTo, customer, canWrite]);

  useEffect(() => { load(); }, [load]);

  const transition = async (orderId: string, toStatus: string) => {
    if (toStatus === "CANCELLED" || toStatus === "FAILED_DELIVERY") { setPendingReason({ orderId, to: toStatus }); return; }
    await doTransition(orderId, toStatus);
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
      if (!res.ok) { setError(data?.message ?? "Transition failed"); return; }
      setPendingReason(null);
      setReason("");
      toast(`Order → ${toStatus}`);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed");
    } finally { setTransitioning(null); }
  };

  const doVoidRefund = async (orderId: string, kind: "void" | "refund" | "voidHold", reasonText?: string) => {
      setTransitioning(orderId);
      setError(null);
      try {
        const url = kind === "voidHold" ? `${API_URL}/admin/pos/holds/${orderId}/void` : `${API_URL}/admin/orders/${orderId}/${kind}`;
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() }, body: JSON.stringify({ reason: reasonText }) });
        const data = await res.json();
        if (!res.ok) { setError(data?.message ?? `${kind} failed`); return; }
        setConfirmAction(null);
        setReason("");
        toast(kind === "voidHold" ? "Held order voided — stock restored" : `${kind === "void" ? "Voided" : "Refunded"} → CANCELLED`);
        void load();
      } catch (e) {
        setError(e instanceof Error ? e.message : `${kind} failed`);
      } finally { setTransitioning(null); }
    };

      // ── W1/W2: routing + order edit ──
      const sendForDelivery = async (orderId: string) => {
        setTransitioning(orderId);
        setError(null);
        try {
          const res = await fetch(`${API_URL}/admin/orders/${orderId}/send-for-delivery`, { method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() } });
          const data = await res.json();
          if (!res.ok) { setError(data?.message ?? "Failed"); return; }
          toast(`${data.orderNumber ?? "Order"} → OUT_FOR_DELIVERY`);
          void load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed");
        } finally { setTransitioning(null); }
      };

      const completeNow = async (orderId: string) => {
        setTransitioning(orderId);
        setError(null);
        try {
          const res = await fetch(`${API_URL}/admin/orders/${orderId}/complete-now`, { method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() } });
          const data = await res.json();
          if (!res.ok) { setError(data?.message ?? "Failed"); return; }
          toast("Order completed — payment collected");
          void load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed");
        } finally { setTransitioning(null); }
      };

      /** Save order item edits (RECEIVED/CONFIRMED/ON_HOLD) via W1 stock-delta endpoint. */
      const saveOrderEdit = async () => {
        if (!editHold) return;
        setError(null);
        const res = await fetch(`${API_URL}/admin/orders/${editHold.id}/items`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...adminHeaders() },
          body: JSON.stringify({ items: editHold.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) }),
        });
        const d = await res.json();
        if (!res.ok) { setError(d?.message ?? "Edit failed"); return; }
        setEditHold(null);
        toast(`Order updated · ${toPesos(d.totalMinor)} (stock adjusted)`);
        void load();
      };

      // ── On-process: edit held items ──
  const saveHoldEdit = async () => {
    if (!editHold) return;
    setError(null);
    const res = await fetch(`${API_URL}/admin/pos/holds/${editHold.id}/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ items: editHold.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d?.message ?? "Edit failed"); return; }
    setEditHold(null);
    toast(`Held order updated · ${toPesos(d.totalMinor)}`);
    await load();
    setPayHold({ id: d.id, orderNumber: editHold.orderNumber, totalMinor: d.totalMinor });
  };

  const addHoldLine = (productId: string) => {
    if (!editHold) return;
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    const existing = editHold.lines.find((l) => l.productId === productId);
    if (existing) setEditHold({ ...editHold, lines: editHold.lines.map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + 1 } : l)) });
    else setEditHold({ ...editHold, lines: [...editHold.lines, { productId, productName: prod.name, quantity: 1, unitPriceMinor: 0 }] });
  };

  const setHoldLineQty = (productId: string, qty: number) => {
    if (!editHold) return;
    setEditHold({ ...editHold, lines: qty <= 0 ? editHold.lines.filter((l) => l.productId !== productId) : editHold.lines.map((l) => (l.productId === productId ? { ...l, quantity: qty } : l)) });
  };

  // ── On-process: pay a held order ──
  const completeHold = async () => {
    if (!payHold) return;
    setError(null);
    const tenderedMinor = Math.round(parseFloat(tendered || "0") * 100);
    if (payMethod === "cash" && tenderedMinor < payHold.totalMinor) { setError("Tendered amount must cover the total"); return; }
    if (payMethod === "credit" && !payCustomerId) { setError("Select a customer for utang"); return; }
    const res = await fetch(`${API_URL}/admin/pos/holds/${payHold.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({
        paymentMethod: payMethod,
        tenderedMinor: payMethod === "cash" ? tenderedMinor : undefined,
        customerId: payMethod === "credit" ? payCustomerId : undefined,
        startAt: payMethod === "credit" ? (startAt || new Date().toISOString()) : undefined,
        dueAt: payMethod === "credit" ? (dueAt || undefined) : undefined,
      }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d?.message ?? "Complete failed"); return; }
    setPayHold(null);
    setTendered(""); setStartAt(""); setDueAt(""); setPayCustomerId("");
    toast(`Held order ${d.orderNumber} completed${d.changeMinor ? ` · change ${toPesos(d.changeMinor)}` : ""}`);
    void load();
  };

  const summaryOf = (o: AdminOrder) => `${o.orderNumber} · ${toPesos(o.totalMinor)} · ${o.customerName}`;

  const rowActions = (o: AdminOrder) => {
      const next = ALLOWED[o.status] ?? [];
      const isDeliv = (o.deliveryType ?? "delivery") === "delivery"; // legacy/online = delivery
      const editable = ["RECEIVED", "CONFIRMED", "ON_HOLD"].includes(o.status);
      return (
        <div className="d-flex flex-wrap gap-1 align-items-center">
          {looking(o)}
          {/* Pending routing analysis */}
          {o.status === "RECEIVED" && (
            <span className={`badge ${isDeliv ? "text-bg-primary" : "text-bg-success"}`}>
              {isDeliv ? <><i className="bi bi-truck me-1"></i>delivery</> : <><i className="bi bi-shop me-1"></i>pickup</>}
            </span>
          )}
          {o.status === "ON_HOLD" && canWrite && (
            <>
              <button className="btn btn-sm btn-outline-warning" onClick={() => openEdit(o)}><i className="bi bi-pencil me-1"></i>Edit</button>
              <button className="btn btn-sm btn-success" onClick={() => { setPayHold({ id: o.id, orderNumber: o.orderNumber, totalMinor: o.totalMinor }); setPayMethod("cash"); setTendered(""); }}><i className="bi bi-cash me-1"></i>Pay</button>
              <button className="btn btn-sm btn-outline-success" onClick={() => { setPayHold({ id: o.id, orderNumber: o.orderNumber, totalMinor: o.totalMinor }); setPayMethod("credit"); }}><i className="bi bi-journal me-1"></i>Utang</button>
              {canVoidRefund && <button className="btn btn-sm btn-outline-danger" onClick={() => setConfirmAction({ orderId: o.id, kind: "voidHold" })}><i className="bi bi-pause-btn me-1"></i>Void</button>}
            </>
          )}
          {o.status !== "ON_HOLD" && canWrite && (
            <>
              {/* RECEIVED (Pending): route by analysis */}
              {o.status === "RECEIVED" && (
                <>
                  {editable && <button className="btn btn-sm btn-outline-warning" onClick={() => openEdit(o)}><i className="bi bi-pencil me-1"></i>Edit</button>}
                  {!isDeliv ? (
                    <button className="btn btn-sm btn-success" disabled={transitioning === o.id} onClick={() => completeNow(o.id)}><i className="bi bi-check2-circle me-1"></i>Move to completed</button>
                  ) : (
                    <button className="btn btn-sm btn-primary" disabled={transitioning === o.id} onClick={() => transition(o.id, "CONFIRMED")}><i className="bi bi-check-lg me-1"></i>Confirm</button>
                  )}
                </>
              )}
              {/* On Process: one-tap delivery routing */}
              {isDeliv && ["CONFIRMED", "PREPARING", "READY"].includes(o.status) && (
                <button className="btn btn-sm btn-primary" disabled={transitioning === o.id} onClick={() => sendForDelivery(o.id)}><i className="bi bi-truck me-1"></i>Send for delivery</button>
              )}
              {isDeliv && o.status === "CONFIRMED" && editable && (
                <button className="btn btn-sm btn-outline-warning" onClick={() => openEdit(o)}><i className="bi bi-pencil me-1"></i>Edit</button>
              )}
              {next.length > 0 && (
                <select className="form-select form-select-sm" style={{ width: 150 }} value="" disabled={transitioning === o.id} onChange={(e) => e.target.value && transition(o.id, e.target.value)}>
                  <option value="" disabled>— {o.status} —</option>
                  {next.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              <button className="btn btn-sm btn-outline-secondary" title="Receipt" onClick={() => setReceiptOrder(o.id)}><i className="bi bi-receipt"></i></button>
              {canVoidRefund && o.status === "COMPLETED" && (
                <button className="btn btn-sm btn-outline-danger" title="Void/Refund" onClick={() => setConfirmAction({ orderId: o.id, kind: o.paymentStatus === "COLLECTED" ? "refund" : "void" })}><i className="bi bi-x-circle"></i></button>
              )}
            </>
          )}
          <button className="btn btn-sm btn-outline-secondary" title="Details" onClick={() => setOrderDetail(o)}><i className="bi bi-view-list"></i></button>
        </div>
      );
    };

  const openEdit = (o: AdminOrder) => {
    fetch(`${API_URL}/admin/orders/${o.id}`, { headers: adminHeaders() })
      .then((r) => r.json())
      .then((d) => setEditHold({
              id: o.id,
              orderNumber: o.orderNumber,
              status: o.status,
              lines: (d?.items ?? []).map((i: any) => ({ productId: i.productId ?? "", productName: i.productName, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor })),
            }))
      .catch(() => setError("Could not load held order"));
  };

  const looking = (o: AdminOrder) => (
    <span className={`badge ${STATUS_BADGE[o.status] ?? "text-bg-secondary"}`}>{o.status}</span>
  );

  const cardGrid = (
    <div className="d-grid gap-2 d-lg-none">
      {orders.map((o) => (
        <div className="card" key={o.id}>
          <div className="card-body py-2">
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <span className="fw-semibold">{o.orderNumber}</span>
                <div className="small text-muted">{o.customerName} · {toPesos(o.totalMinor)}</div>
              </div>
              {looking(o)}
            </div>
            <div className="small text-muted mb-1">{new Date(o.createdAt).toLocaleString()}</div>
            {rowActions(o)}
          </div>
        </div>
      ))}
    </div>
  );

  const tableGrid = (
    <div className="table-responsive d-none d-lg-block">
      <table className="table table-hover align-middle">
        <thead>
          <tr><th>Order</th><th>Customer</th><th className="text-end">Total</th><th>Status</th><th>Placed</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="fw-semibold">{o.orderNumber}</td>
              <td>{o.customerName}</td>
              <td className="text-end">{toPesos(o.totalMinor)}</td>
              <td>{looking(o)}</td>
              <td className="small text-muted">{new Date(o.createdAt).toLocaleString()}</td>
              <td>{rowActions(o)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <h1 className="h4 mb-2"><i className="bi bi-receipt me-2"></i>Orders</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {/* Filters */}
      <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
        <select className="form-select form-select-sm" style={{ width: 140 }} value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="tomorrow">Tomorrow</option>
          <option value="custom">Custom range</option>
        </select>
        {range === "custom" && (
          <>
            <input className="form-control form-control-sm" style={{ width: 140 }} type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-muted small">→</span>
            <input className="form-control form-control-sm" style={{ width: 140 }} type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
        <input className="form-control form-control-sm" style={{ width: 180 }} placeholder="Search customer name/phone…" value={customer} onChange={(e) => setCustomer(e.target.value)} />
      </div>

      {/* Tabs */}
      <ul className="nav nav-pills mb-3 flex-wrap">
        {TABS.map((t) => (
          <li className="nav-item" key={t.id}>
            <button className={`nav-link ${tab === t.id ? "active bg-primary" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
          </li>
        ))}
      </ul>

      {loading ? (
        <p className="text-muted">Loading orders…</p>
      ) : orders.length === 0 ? (
        <p className="text-muted text-center py-4"><i className="bi bi-inbox fs-3 d-block mb-2"></i>No orders in this view.</p>
      ) : (
        <>
          {cardGrid}
          {tableGrid}
        </>
      )}

      {/* Reason modal */}
      {pendingReason && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Reason for {pendingReason.to}</h5>
                  <button type="button" className="btn-close" onClick={() => setPendingReason(null)}></button>
                </div>
                <div className="modal-body">
                  <textarea className="form-control" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer request…" />
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setPendingReason(null)}>Cancel</button>
                  <button className="btn btn-danger" disabled={reason.trim().length < 3} onClick={() => doTransition(pendingReason.orderId, pendingReason.to, reason)}>Confirm</button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}

      {/* Void/refund confirm */}
      {confirmAction && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{confirmAction.kind === "voidHold" ? "Void held order" : confirmAction.kind === "void" ? "Void sale" : "Refund sale"}</h5>
                  <button type="button" className="btn-close" onClick={() => setConfirmAction(null)}></button>
                </div>
                <div className="modal-body">
                  <p className="small">
                    {confirmAction.kind === "voidHold"
                      ? "This discards the held order and restores stock."
                      : confirmAction.kind === "void"
                        ? "This reverses the sale and restores stock."
                        : "This records a refund and cancels the order. Stock is not restored."}
                  </p>
                  <input className="form-control form-control-sm" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                  <button className="btn btn-danger" disabled={transitioning === confirmAction.orderId} onClick={() => doVoidRefund(confirmAction.orderId, confirmAction.kind, reason)}>
                    {transitioning === confirmAction.orderId ? "Working…" : "Confirm"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}

      {/* Edit held order modal */}
      {editHold && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                                  <h5 className="modal-title">Edit order — {editHold.orderNumber}</h5>
                                  <button type="button" className="btn-close" onClick={() => setEditHold(null)}></button>
                                </div>
                <div className="modal-body">
                  <select className="form-select form-select-sm mb-2" value="" onChange={(e) => e.target.value && addHoldLine(e.target.value)}>
                    <option value="" disabled>+ Add product…</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                  {editHold.lines.length === 0 ? (
                    <p className="text-muted small">No lines — sale will be voided if saved without items.</p>
                  ) : (
                    editHold.lines.map((l) => (
                      <div key={l.productId} className="d-flex align-items-center gap-2 mb-1">
                        <span className="flex-grow-1 small">{l.productName}</span>
                        <div className="input-group input-group-sm" style={{ width: 96 }}>
                          <button className="btn btn-outline-secondary" onClick={() => setHoldLineQty(l.productId, l.quantity - 1)}>-</button>
                          <input className="form-control text-center" value={l.quantity} readOnly />
                          <button className="btn btn-outline-secondary" onClick={() => setHoldLineQty(l.productId, l.quantity + 1)}>+</button>
                        </div>
                        <button className="btn btn-sm btn-outline-danger py-0" onClick={() => setHoldLineQty(l.productId, 0)}><i className="bi bi-x"></i></button>
                      </div>
                    ))
                  )}
                </div>
                <div className="modal-footer">
                                  <button className="btn btn-outline-secondary" onClick={() => setEditHold(null)}>Cancel</button>
                                  <button className="btn btn-primary" onClick={() => (editHold.status === "ON_HOLD" ? saveHoldEdit() : saveOrderEdit())}>Save changes</button>
                                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}

      {/* Pay held order modal */}
      {payHold && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Complete {payHold.orderNumber} · {toPesos(payHold.totalMinor)}</h5>
                  <button type="button" className="btn-close" onClick={() => setPayHold(null)}></button>
                </div>
                <div className="modal-body">
                  <div className="d-flex gap-2 mb-2">
                    <button type="button" className={`btn btn-sm ${payMethod === "cash" ? "btn-success" : "btn-outline-success"} flex-fill`} onClick={() => setPayMethod("cash")}>Cash</button>
                    <button type="button" className={`btn btn-sm ${payMethod === "credit" ? "btn-warning" : "btn-outline-warning"} flex-fill`} onClick={() => setPayMethod("credit")}>Utang</button>
                  </div>
                  {payMethod === "cash" ? (
                    <>
                      <label className="form-label small">Amount tendered</label>
                      <input className="form-control" type="number" min="0" step="0.01" placeholder={`Due ${toPesos(payHold.totalMinor)}`} value={tendered} onChange={(e) => setTendered(e.target.value)} />
                      {(() => { const t = Math.round(parseFloat(tendered || "0") * 100); const ch = t - payHold.totalMinor; return ch >= 0 && t > 0 ? <div className="small text-success mt-1">Change: {toPesos(ch)}</div> : null; })()}
                    </>
                  ) : (
                    <>
                      <select className="form-select form-select-sm mb-2" value={payCustomerId} onChange={(e) => setPayCustomerId(e.target.value)}>
                        <option value="">Select customer…</option>
                        {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <div className="row g-2">
                        <div className="col-6">
                          <label className="form-label small">Start</label>
                          <input className="form-control form-control-sm" type="date" value={startAt ? startAt.slice(0, 10) : ""} onChange={(e) => setStartAt(e.target.value ? new Date(e.target.value).toISOString() : "")} />
                        </div>
                        <div className="col-6">
                          <label className="form-label small">Due</label>
                          <input className="form-control form-control-sm" type="date" value={dueAt ? dueAt.slice(0, 10) : ""} onChange={(e) => setDueAt(e.target.value ? new Date(e.target.value).toISOString() : "")} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-outline-secondary" onClick={() => setPayHold(null)}>Cancel</button>
                  <button className="btn btn-success" onClick={completeHold}>Complete</button>
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