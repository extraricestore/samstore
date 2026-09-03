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
  joinedAt: string;
}

export default function CustomersPanel() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
                <td className="small text-muted">{new Date(c.joinedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}