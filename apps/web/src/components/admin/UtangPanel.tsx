"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";
import { toast } from "../../lib/toast";

interface UtangCustomer {
  id: string;
  customerName: string;
  phone: string;
  balanceMinor: number;
  creditLimitMinor: number;
  creditApproved: boolean;
}

interface LedgerEntry {
  id: string;
  type: string;
  amountMinor: number;
  note: string | null;
  orderId: string | null;
  createdAt: string;
}

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;

export default function UtangPanel() {
  const [customers, setCustomers] = useState<UtangCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<UtangCustomer | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [payTarget, setPayTarget] = useState<UtangCustomer | null>(null);
  const [payInput, setPayInput] = useState("");
  const [payNote, setPayNote] = useState("");
  const [ledgerTarget, setLedgerTarget] = useState<string | null>(null);
  const [ledger, setLedger] = useState<{ customerName: string; balanceMinor: number; entries: LedgerEntry[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/credit/utang`, { headers: adminHeaders() });
      if (!res.ok) throw new Error("Failed to load utang list");
      const data = await res.json();
      setCustomers(data.customers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

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
      toast("Utang payment recorded");
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

  return (
    <div>
      <h1 className="h4 mb-3"><i className="bi bi-journal-text me-2"></i>Utang (Credit)</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      <p className="text-muted small mb-3">
        Outstanding customer balances. Approve customers for credit in the Customers tab, then sell on credit at the POS.
      </p>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : customers.length === 0 ? (
        <p className="text-muted">No outstanding balances.</p>
      ) : (
        <table className="table table-hover align-middle">
          <thead>
            <tr><th>Customer</th><th>Phone</th><th className="text-end">Balance</th><th className="text-end">Limit</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="fw-semibold">{c.customerName}</td>
                <td>{c.phone || "—"}</td>
                <td className="text-end fw-bold text-danger">{toPesos(c.balanceMinor)}</td>
                <td className="text-end">{c.creditLimitMinor > 0 ? toPesos(c.creditLimitMinor) : "store default"}</td>
                <td>
                  <button className="btn btn-sm btn-outline-success me-1" onClick={() => { setPayTarget(c); setPayInput((c.balanceMinor / 100).toFixed(2)); }}>
                    <i className="bi bi-cash-coin me-1"></i>Pay
                  </button>
                  <button className="btn btn-sm btn-outline-primary" onClick={() => openLedger(c.id)}>Ledger</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
                  <h5 className="modal-title">Record payment — {payTarget.customerName}</h5>
                  <button type="button" className="btn-close" onClick={() => setPayTarget(null)}></button>
                </div>
                <div className="modal-body">
                  <p className="small text-muted">Outstanding: <strong className="text-danger">{toPesos(payTarget.balanceMinor)}</strong></p>
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
            <div className="modal-dialog modal-dialog-centered modal-lg">
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
                        Balance: <strong className="text-danger">{toPesos(ledger.balanceMinor)}</strong>
                      </p>
                      <table className="table table-sm">
                        <thead><tr><th>Date</th><th>Type</th><th className="text-end">Amount</th><th>Note</th></tr></thead>
                        <tbody>
                          {ledger.entries.map((e) => (
                            <tr key={e.id}>
                              <td className="small text-muted">{new Date(e.createdAt).toLocaleDateString()}</td>
                              <td><span className={`badge ${e.type === "purchase" ? "text-bg-warning" : "text-bg-success"}`}>{e.type}</span></td>
                              <td className={`text-end ${e.amountMinor > 0 ? "text-danger" : "text-success"}`}>
                                {e.amountMinor > 0 ? "+" : ""}{toPesos(e.amountMinor)}
                              </td>
                              <td className="small text-muted">{e.note ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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