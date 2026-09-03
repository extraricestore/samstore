"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";

interface StoreRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  currencyCode: string;
  timezone: string;
  _count: { products: number; orders: number };
}

export default function StoresPanel() {
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", ownerEmail: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/stores`, { headers: adminHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? `Failed (${res.status})`);
      }
      const data = await res.json();
      setStores(data.stores);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/admin/stores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ name: form.name, slug: form.slug, ownerEmail: form.ownerEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.errors?.join(", ") ?? data?.message ?? "Create failed");
        return;
      }
      setForm({ name: "", slug: "", ownerEmail: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="h4 mb-3">Stores</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      <form onSubmit={create} className="card mb-4">
        <div className="card-body">
          <h6 className="card-title">Create a new store</h6>
          <div className="row g-2">
            <div className="col-md-3">
              <input className="form-control form-control-sm" placeholder="Store name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="col-md-3">
              <input className="form-control form-control-sm" placeholder="slug (e.g. my-store)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().trim() })} required pattern="[a-z0-9-]{2,40}" />
            </div>
            <div className="col-md-4">
              <input className="form-control form-control-sm" type="email" placeholder="Owner email (registered admin)" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} required />
            </div>
            <div className="col-md-2">
              <button className="btn btn-primary btn-sm w-100" type="submit" disabled={saving}>
                {saving ? "…" : "Create store"}
              </button>
            </div>
          </div>
        </div>
      </form>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : stores.length === 0 ? (
        <p className="text-muted">No stores yet.</p>
      ) : (
        <table className="table table-hover align-middle">
          <thead>
            <tr>
              <th>Store</th>
              <th>Slug</th>
              <th className="text-end">Products</th>
              <th className="text-end">Orders</th>
              <th>Currency</th>
              <th>Status</th>
              <th>Public link</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id}>
                <td className="fw-semibold">{s.name}</td>
                <td><code>{s.slug}</code></td>
                <td className="text-end">{s._count.products}</td>
                <td className="text-end">{s._count.orders}</td>
                <td>{s.currencyCode}</td>
                <td><span className="badge text-bg-success">{s.status}</span></td>
                <td>
                  <a className="small" href={`/sam-store`} target="_blank" rel="noreferrer">/storefront</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}