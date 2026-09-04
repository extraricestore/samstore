"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";

interface CustomerRow {
  id: string;
  customerId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  approvalStatus: string;
  loyaltyPoints: number;
  creditApproved: boolean;
  creditLimitMinor: number;
  creditBalanceMinor: number;
  joinedAt: string;
}

interface ProfileData {
  id: string;
  customer: { id: string; email: string | null; name: string | null; phone: string | null };
  approvalStatus: string;
  loyaltyBalancePoints: number;
  creditApproved: boolean;
  creditLimitMinor: number;
  creditBalanceMinor: number;
  createdAt: string;
  orders: { id: string; orderNumber: string; status: string; totalMinor: number; source: string; createdAt: string }[];
  creditEntries: { id: string; type: string; amountMinor: number; note: string | null; orderId: string | null; createdAt: string }[];
}

const APPROVAL_BADGE: Record<string, string> = {
  NOT_REQUIRED: "text-bg-secondary",
  PENDING: "text-bg-warning",
  APPROVED: "text-bg-success",
  REJECTED: "text-bg-danger",
  SUSPENDED: "text-bg-danger",
};

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;

export default function CustomersPanel() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("");
  const [onlyUtang, setOnlyUtang] = useState(false);
  const [approveTarget, setApproveTarget] = useState<CustomerRow | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      if (approvalFilter) q.set("approvalStatus", approvalFilter);
      if (onlyUtang) q.set("onlyUtang", "true");
      const res = await fetch(`${API_URL}/admin/customers?${q.toString()}`, { headers: adminHeaders() });
      if (!res.ok) throw new Error("Failed to load customers");
      const data = await res.json();
      setCustomers(data.customers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [search, approvalFilter, onlyUtang]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const setApproval = async (id: string, status: string) => {
    await fetch(`${API_URL}/admin/customers/${id}/approval`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ status }),
    });
    await load();
  };

  const approveCredit = async () => {
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

  const openProfile = async (id: string) => {
    setProfileTarget(id);
    setProfile(null);
    const res = await fetch(`${API_URL}/admin/customers/${id}`, { headers: adminHeaders() });
    const d = await res.json();
    if (d?.orders) setProfile(d);
    else setError(d?.message ?? "Could not load profile");
  };

  const exportCsv = () => {
    window.open(`${API_URL}/admin/customers/export.csv`, "_blank");
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Customers &amp; Loyalty</h1>
        <button className="btn btn-outline-secondary btn-sm" onClick={exportCsv}>
          <i className="bi bi-filetype-csv me-1"></i>Export CSV
        </button>
      </div>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      <div className="row g-2 mb-2">
        <div className="col-md-5">
          <input className="form-control form-control-sm" placeholder="Search name, email or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="col-md-3">
          <select className="form-select form-select-sm" value={approvalFilter} onChange={(e) => setApprovalFilter(e.target.value)}>
            <option value="">All approval statuses</option>
            {Object.keys(APPROVAL_BADGE).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="col-md-2">
          <div className="form-check form-switch">
            <input className="form-check-input" type="checkbox" id="onlyUtang" checked={onlyUtang} onChange={(e) => setOnlyUtang(e.target.checked)} />
            <label className="form-check-label small" htmlFor="onlyUtang">Has utang</label>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : customers.length === 0 ? (
        <p className="text-muted">No customers match.</p>
      ) : (
        <table className="table table-hover align-middle">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Contact</th>
              <th className="text-end">Loyalty points</th>
              <th>Status</th>
              <th>Approval</th>
              <th>Credit</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => openProfile(c.id)}>
                <td className="fw-semibold">{c.name ?? c.email ?? c.phone ?? "Guest"}</td>
                <td className="small text-muted">{c.email ?? c.phone ?? "—"}</td>
                <td className="text-end">
                  <span className={`fw-semibold ${c.loyaltyPoints > 0 ? "text-primary" : "text-muted"}`}>
                    {c.loyaltyPoints} pts
                  </span>
                </td>
                <td><span className="badge text-bg-secondary">{c.approvalStatus}</span></td>
                <td>
                  {c.approvalStatus === "PENDING" ? (
                    <div className="d-flex gap-1">
                      <button className="btn btn-sm btn-outline-success" onClick={(e) => { e.stopPropagation(); setApproval(c.id, "APPROVED"); }}><i className="bi bi-check-lg"></i></button>
                      <button className="btn btn-sm btn-outline-danger" onClick={(e) => { e.stopPropagation(); setApproval(c.id, "REJECTED"); }}><i className="bi bi-x-lg"></i></button>
                    </div>
                  ) : c.approvalStatus === "APPROVED" ? (
                    <button className="btn btn-sm btn-outline-warning" onClick={(e) => { e.stopPropagation(); setApproval(c.id, "SUSPENDED"); }}>Suspend</button>
                  ) : (
                    <button className="btn btn-sm btn-outline-secondary" onClick={(e) => { e.stopPropagation(); setApproval(c.id, "APPROVED"); }}>Re-approve</button>
                  )}
                </td>
                <td>
                  {c.creditApproved ? (
                    <span className="badge text-bg-warning" onClick={(e) => e.stopPropagation()}>
                      {c.creditBalanceMinor > 0 ? `${toPesos(c.creditBalanceMinor)} owed · ` : ""}{toPesos(c.creditLimitMinor)} limit
                    </span>
                  ) : (
                    <button className="btn btn-sm btn-outline-warning" onClick={(e) => { e.stopPropagation(); setApproveTarget(c); }}>Approve credit</button>
                  )}
                </td>
                <td className="small text-muted">{new Date(c.joinedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Approve credit modal */}
      {approveTarget && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Approve credit — {approveTarget.name ?? approveTarget.email ?? "Customer"}</h5>
                  <button type="button" className="btn-close" onClick={() => setApproveTarget(null)}></button>
                </div>
                <div className="modal-body">
                  <label className="form-label small">Credit limit (₱)</label>
                  <input className="form-control" type="number" min="0" step="0.01" value={limitInput} onChange={(e) => setLimitInput(e.target.value)} placeholder="e.g. 500" />
                  <div className="form-text">0 = store default limit. Credit disabled if both are 0.</div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-outline-secondary" onClick={() => setApproveTarget(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={approveCredit}>Approve</button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}

      {/* Profile modal */}
      {profileTarget && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Customer — {profile?.customer.name ?? profile?.customer.email ?? "…"}</h5>
                  <button type="button" className="btn-close" onClick={() => setProfileTarget(null)}></button>
                </div>
                <div className="modal-body">
                  {!profile && <p className="text-muted">Loading…</p>}
                  {profile && (
                    <>
                      <div className="row g-2 small mb-2">
                        <div className="col-6">Email: <strong>{profile.customer.email ?? "—"}</strong></div>
                        <div className="col-6">Phone: <strong>{profile.customer.phone ?? "—"}</strong></div>
                        <div className="col-6">Status: <span className={`badge ${APPROVAL_BADGE[profile.approvalStatus] ?? "text-bg-secondary"}`}>{profile.approvalStatus}</span></div>
                        <div className="col-6">Loyalty: <strong>{profile.loyaltyBalancePoints} pts</strong></div>
                        <div className="col-6">Credit: <span className={profile.creditBalanceMinor > 0 ? "text-danger fw-bold" : ""}>{toPesos(profile.creditBalanceMinor)} owed</span> (limit {toPesos(profile.creditLimitMinor)})</div>
                      </div>
                      <h6 className="small fw-bold">Recent orders</h6>
                      {profile.orders.length === 0 ? (
                        <p className="text-muted small">No orders.</p>
                      ) : (
                        <table className="table table-sm mb-3">
                          <thead><tr><th>Order</th><th>Status</th><th className="text-end">Total</th><th>Source</th><th>Date</th></tr></thead>
                          <tbody>
                            {profile.orders.map((o) => (
                              <tr key={o.id}>
                                <td>{o.orderNumber}</td>
                                <td><span className="badge text-bg-secondary">{o.status}</span></td>
                                <td className="text-end">{toPesos(o.totalMinor)}</td>
                                <td>{o.source}</td>
                                <td className="small text-muted">{new Date(o.createdAt).toLocaleDateString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <h6 className="small fw-bold">Credit ledger</h6>
                      {profile.creditEntries.length === 0 ? (
                        <p className="text-muted small">No credit activity.</p>
                      ) : (
                        <table className="table table-sm">
                          <thead><tr><th>Date</th><th>Type</th><th className="text-end">Amount</th><th>Note</th></tr></thead>
                          <tbody>
                            {profile.creditEntries.map((e) => (
                              <tr key={e.id}>
                                <td className="small text-muted">{new Date(e.createdAt).toLocaleDateString()}</td>
                                <td><span className={`badge ${e.type === "purchase" ? "text-bg-warning" : "text-bg-success"}`}>{e.type}</span></td>
                                <td className={`text-end ${e.amountMinor > 0 ? "text-danger" : "text-success"}`}>{e.amountMinor > 0 ? "+" : ""}{toPesos(e.amountMinor)}</td>
                                <td className="small text-muted">{e.note ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => setProfileTarget(null)}>Close</button>
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