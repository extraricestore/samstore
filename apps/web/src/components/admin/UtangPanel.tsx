"use client";

// Credit Ledger (V3) — renamed from Utang. Tabs: Unpaid (balance > 0) | Paid (settled).
// Shows balance, due date + overdue badge, credit limit/approval, and per-entry start/due
// dates in the ledger. Mobile-first cards (table on ≥md).

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";
import { toast } from "../../lib/toast";

interface LedgerCustomer {
  id: string;
  customerName: string;
  phone: string;
  balanceMinor: number;
  creditLimitMinor: number;
  creditApproved: boolean;
  firstPurchaseAt: string | null;
  oldestDueAt: string | null;
  daysOverdue: number;
  paidAt: string | null;
}

interface LedgerEntry {
  id: string;
  type: string;
  amountMinor: number;
  startAt: string;
  dueAt: string | null;
  note: string | null;
  orderId: string | null;
  createdAt: string;
}

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

export default function UtangPanel() {
  const [status, setStatus] = useState<"unpaid" | "paid">("unpaid");
  const [customers, setCustomers] = useState<LedgerCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<LedgerCustomer | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [payTarget, setPayTarget] = useState<LedgerCustomer | null>(null);
  const [payInput, setPayInput] = useState("");
  const [payNote, setPayNote] = useState("");
  const [ledgerTarget, setLedgerTarget] = useState<string | null>(null);
  const [ledger, setLedger] = useState<{ customerName: string; balanceMinor: number; entries: LedgerEntry[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/credit/utang?status=${status}`, { headers: adminHeaders() });
      if (!res.ok) throw new Error("Failed to load credit ledger");
      const data = await res.json();
      setCustomers(data.customers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const approve = async () => {
    if (!approveTarget) return;
    const limitMinor = Math.round(parseFloat(limitInput || "0") * 100);
    const res = await fetch(`${API_URL}/admin/credit/${approveTarget.id}/approve`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ limitMinor }),
    });
    if (res.ok) {
      setApproveTarget(null);
      setLimitInput("");
      toast("Credit approved");
      await load();
    } else {
      const d = await res.json();
      setError(d?.message ?? "Approve failed");
    }
  };

  const pay = async () => {
    if (!payTarget) return;
    const amountMinor = Math.round(parseFloat(payInput || "0") * 100);
    if (amountMinor <= 0) { setError("Enter an amount"); return; }
    const res = await fetch(`${API_URL}/admin/credit/${payTarget.id}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ amountMinor, note: payNote || undefined }),
    });
    if (res.ok) {
      setPayTarget(null);
      setPayInput("");
      setPayNote("");
      toast("Payment recorded — balance updated");
      await load();
    } else {
      const d = await res.json();
      setError(d?.message ?? "Payment failed");
    }
  };

  const openLedger = async (id: string) => {
    setLedgerTarget(id);
    setLedger(null);
    const res = await fetch(`${API_URL}/admin/credit/${id}`, { headers: adminHeaders() });
    const d = await res.json();
    setLedger(d?.entries ? d : null);
  };

  const rowActions = (c: LedgerCustomer) => (
    <div className="d-flex flex-wrap gap-1">
      {status === "unpaid" && (
        <button className="btn btn-sm btn-outline-success" onClick={() => { setPayTarget(c); setPayInput((c.balanceMinor / 100).toFixed(2)); }}>
          <i className="bi bi-cash-coin me-1"></i>Collect
        </button>
      )}
      <button className="btn btn-sm btn-outline-primary" onClick={() => openLedger(c.id)}>Ledger</button>
      {!c.creditApproved && (
        <button className="btn btn-sm btn-outline-warning" onClick={() => setApproveTarget(c)}>Approve credit</button>
      )}
    </div>
  );

  const cards = (
    <div className="d-grid gap-2 d-lg-none">
      {customers.map((c) => (
        <div className="card" key={c.id}>
          <div className="card-body py-2">
            <div className="d-flex justify-content-between align-items-center">
              <span className="fw-semibold">{c.customerName}</span>
              <span className={`fw-bold ${c.balanceMinor > 0 ? "text-danger" : "text-success"}`}>{toPesos(c.balanceMinor)}</span>
            </div>
            <div className="small text-muted">
              {c.phone || "no phone"}
              {status === "unpaid" && c.oldestDueAt && (
                <span className={c.daysOverdue > 0 ? "text-danger fw-semibold ms-2" : "ms-2"}>
                  · due {fmt(c.oldestDueAt)}{c.daysOverdue > 0 ? ` · ${c.daysOverdue}d overdue` : ""}
                </span>
              )}
              {status === "paid" && c.paidAt && <span className="ms-2">· paid {fmt(c.paidAt)}</span>}
            </div>
            <div className="mt-1">{rowActions(c)}</div>
          </div>
        </div>
      ))}
    </div>
  );

  const table = (
    <div className="table-responsive d-none d-lg-block">
      <table className="table table-hover align-middle">
        <thead>
          <tr>
            <th>Customer</th><th>Phone</th><th className="text-end">Balance</th>
            <th>Due</th><th>Status</th><th className="text-end">Limit</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id}>
              <td className="fw-semibold">{c.customerName}</td>
              <td>{c.phone || "—"}</td>
              <td className={`text-end fw-bold ${c.balanceMinor > 0 ? "text-danger" : "text-success"}`}>{toPesos(c.balanceMinor)}</td>
              <td className="small text-muted">{status === "unpaid" ? fmt(c.oldestDueAt) : fmt(c.paidAt)}</td>
              <td>
                {status === "unpaid" ? (
                  c.daysOverdue > 0
                    ? <span className="badge text-bg-danger">{c.daysOverdue}d overdue</span>
                    : <span className="badge text-bg-warning">pending</span>
                ) : (
                  <span className="badge text-bg-success">paid</span>
                )}
              </td>
              <td className="text-end">{c.creditLimitMinor > 0 ? toPesos(c.creditLimitMinor) : "store default"}</td>
              <td>{rowActions(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <h1 className="h4 mb-2"><i className="bi bi-journal-text me-2"></i>Credit Ledger</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      <p className="text-muted small mb-2">
        Customer credit balances. Collect payments on the Unpaid tab; settled customers move to Paid automatically.
      </p>

      <ul className="nav nav-pills mb-3">
        <li className="nav-item">
          <button className={`nav-link ${status === "unpaid" ? "active bg-primary" : ""}`} onClick={() => setStatus("unpaid")}>Unpaid</button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${status === "paid" ? "active bg-primary" : ""}`} onClick={() => setStatus("paid")}>Paid</button>
        </li>
      </ul>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : customers.length === 0 ? (
        <p className="text-muted text-center py-4">
          <i className="bi bi-journal-x fs-3 d-block mb-2"></i>
          {status === "unpaid" ? "No outstanding balances." : "No settled customers yet."}
        </p>
      ) : (
        <>
          {cards}
          {table}
        </>
      )}

      {/* Approve modal */}
      {approveTarget && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Approve credit — {approveTarget.customerName}</h5>
                  <button type="button" className="btn-close" onClick={() => setApproveTarget(null)}></button>
                </div>
                <div className="modal-body">
                  <label className="form-label small">Credit limit (₱)</label>
                  <input className="form-control" type="number" min="0" step="0.01" value={limitInput} onChange={(e) => setLimitInput(e.target.value)} placeholder="e.g. 500" />
                  <div className="form-text">0 = store default limit. Credit disabled if both are 0.</div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-outline-secondary" onClick={() => setApproveTarget(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={approve}>Approve</button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}

      {/* Payment modal */}
      {payTarget && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Collect payment — {payTarget.customerName}</h5>
                  <button type="button" className="btn-close" onClick={() => setPayTarget(null)}></button>
                </div>
                <div className="modal-body">
                  <p className="small text-muted">
                    Outstanding: <strong className="text-danger">{toPesos(payTarget.balanceMinor)}</strong>
                    {payTarget.oldestDueAt && <span className={payTarget.daysOverdue > 0 ? " d-block text-danger" : " d-block"}>due {fmt(payTarget.oldestDueAt)}{payTarget.daysOverdue > 0 ? ` (${payTarget.daysOverdue}d overdue)` : ""}</span>}
                  </p>
                  <label className="form-label small">Amount (₱)</label>
                  <input className="form-control" type="number" min="0" step="0.01" value={payInput} onChange={(e) => setPayInput(e.target.value)} />
                  <label className="form-label small mt-2">Note</label>
                  <input className="form-control" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="optional" />
                </div>
                <div className="modal-footer">
                  <button className="btn btn-outline-secondary" onClick={() => setPayTarget(null)}>Cancel</button>
                  <button className="btn btn-success" onClick={pay}>Record payment</button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}

      {/* Ledger modal */}
      {ledgerTarget && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Ledger — {ledger?.customerName ?? "…"}</h5>
                  <button type="button" className="btn-close" onClick={() => setLedgerTarget(null)}></button>
                </div>
                <div className="modal-body">
                  {!ledger && <p className="text-muted">Loading…</p>}
                  {ledger && (
                    <>
                      <p className="small">
                        Balance: <strong className={ledger.balanceMinor > 0 ? "text-danger" : "text-success"}>{toPesos(ledger.balanceMinor)}</strong>
                      </p>
                      <div className="table-responsive">
                        <table className="table table-sm">
                          <thead><tr><th>Date</th><th>Start</th><th>Due</th><th>Type</th><th className="text-end">Amount</th><th>Note</th></tr></thead>
                          <tbody>
                            {ledger.entries.map((e) => (
                              <tr key={e.id}>
                                <td className="small text-muted">{fmt(e.createdAt)}</td>
                                <td className="small text-muted">{fmt(e.startAt)}</td>
                                <td className={`small ${e.dueAt && new Date(e.dueAt).getTime() < Date.now() ? "text-danger" : "text-muted"}`}>{fmt(e.dueAt)}</td>
                                <td><span className={`badge ${e.type === "purchase" ? "text-bg-warning" : "text-bg-success"}`}>{e.type}</span></td>
                                <td className={`text-end ${e.amountMinor > 0 ? "text-danger" : "text-success"}`}>{e.amountMinor > 0 ? "+" : ""}{toPesos(e.amountMinor)}</td>
                                <td className="small text-muted">{e.note ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-outline-secondary" onClick={() => setLedgerTarget(null)}>Close</button>
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