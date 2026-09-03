"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchAdminOrders, getAdminToken, type AdminOrder } from "../../../lib/admin";

export default function AdminDashboard() {
  const router = useRouter();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      router.replace("/admin/login");
      return;
    }
    fetchAdminOrders(token)
      .then(setOrders)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load orders"))
      .finally(() => setLoading(false));
  }, [router]);

  const logout = () => {
    sessionStorage.removeItem("samstore.admin.token");
    router.push("/admin/login");
  };

  const toPesos = (minor: number) => `₱${(minor / 100).toFixed(2)}`;

  return (
    <div>
      <nav className="navbar navbar-dark bg-dark">
        <div className="container">
          <span className="navbar-brand fw-semibold">
            <i className="bi bi-speedometer2 me-2"></i>Sam&apos;s Admin
          </span>
          <button className="btn btn-outline-light btn-sm" onClick={logout}>
            <i className="bi bi-box-arrow-right me-1"></i>Log out
          </button>
        </div>
      </nav>
      <main className="container py-4">
        <h1 className="h4 mb-3">Orders</h1>
        {error && <div className="alert alert-danger">{error}</div>}
        {loading ? (
          <p className="text-muted">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="text-muted">No orders yet.</p>
        ) : (
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Phone</th>
                <th className="text-end">Total</th>
                <th>Status</th>
                <th>Placed</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="fw-semibold">{o.orderNumber}</td>
                  <td>{o.customerName}</td>
                  <td>{o.customerPhone}</td>
                  <td className="text-end">{toPesos(o.totalMinor)}</td>
                  <td>
                    <span className="badge text-bg-success">{o.status}</span>
                  </td>
                  <td className="text-muted small">{new Date(o.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}