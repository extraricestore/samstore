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

const APPROVAL_BADGE: Record<string, string> = {
  NOT_REQUIRED: "text-bg-secondary",
  PENDING: "text-bg-warning",
  APPROVED: "text-bg-success",
  REJECTED: "text-bg-danger",
  SUSPENDED: "text-bg-danger",
};

export default function CustomersPanel() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approveTarget, setApproveTarget] = useState<CustomerRow | null>(null);
  const [limitInput, setLimitInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/customers`, { headers: adminHeaders() });
      if (!res.ok) throw new Error("Failed to load customers");
      const data = await res.json();
      setCustomers(data.customers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div>
      <h1 className="h4 mb-3">Customers &amp; Loyalty</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : customers.length === 0 ? (
        <p className="text-muted">No customers yet. Customers earn loyalty points when their orders are delivered.</p>
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
              <tr key={c.id}>
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
                      <button className="btn btn-sm btn-outline-success" onClick={() => setApproval(c.id, "APPROVED")}>
                        <i className="bi bi-check-lg"></i>
                      </button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => setApproval(c.id, "REJECTED")}>
                        <i className="bi bi-x-lg"></i>
                      </button>
                    </div>
                  ) : c.approvalStatus === "APPROVED" ? (
                    <button className="btn btn-sm btn-outline-warning" onClick={() => setApproval(c.id, "SUSPENDED")}>
                      Suspend
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setApproval(c.id, "APPROVED")}>
                      Re-approve
                    </button>
                  )}
                </td>
                <td>
                  {c.creditApproved ? (
                    <span className="badge text-bg-warning">
                      {c.creditBalanceMinor > 0 ? `₱${(c.creditBalanceMinor / 100).toFixed(2)} owed · ` : ""}₱{(c.creditLimitMinor / 100).toFixed(2)} limit
                    </span>
                  ) : (
                    <button className="btn btn-sm btn-outline-warning" onClick={() => setApproveTarget(c)}>Approve credit</button>
                  )}
                </td>
                <td className="small text-muted">{new Date(c.joinedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
    </div>
  );
}