"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";

interface InvItem {
  id: string; name: string; sku: string; category: string | null;
  quantityOnHand: number; quantityReserved: number; availableQuantity: number;
  reorderThreshold: number; costMinor: number; valueMinor: number; status: "in" | "low" | "out";
}
interface Warehouse { id: string; name: string; isDefault: boolean }
interface Category { id: string; name: string }

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;
const STATUS_BADGE: Record<string, string> = { in: "text-bg-success", low: "text-bg-warning", out: "text-bg-danger" };

export default function InventoryPanel() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"name" | "qty" | "value">("name");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      if (categoryId) q.set("categoryId", categoryId);
      if (warehouseId) q.set("warehouseId", warehouseId);
      if (status) q.set("status", status);
      const res = await fetch(`${API_URL}/admin/inventory?${q.toString()}`, { headers: adminHeaders() });
      if (!res.ok) throw new Error("Failed to load inventory");
      const data = await res.json();
      let rows: InvItem[] = data.items ?? [];
      if (sort === "qty") rows = [...rows].sort((a, b) => a.quantityOnHand - b.quantityOnHand);
      else if (sort === "value") rows = [...rows].sort((a, b) => b.valueMinor - a.valueMinor);
      else rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
      setItems(rows);
      setWarehouses(data.warehouses ?? []);
      setCategories(data.categories ?? []);
      setTotalValue(data.totalValueMinor ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [search, categoryId, warehouseId, status, sort]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <h1 className="h4 mb-3"><i className="bi bi-boxes me-2"></i>Inventory</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      <div className="row g-2 mb-2">
        <div className="col-md-3">
          <input className="form-control form-control-sm" placeholder="Search name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="col-md-2">
          <select className="form-select form-select-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="col-md-2">
          <select className="form-select form-select-sm" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">All warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.isDefault ? " (default)" : ""}</option>)}
          </select>
        </div>
        <div className="col-md-2">
          <select className="form-select form-select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All stock</option>
            <option value="in">In stock</option>
            <option value="low">Low</option>
            <option value="out">Out</option>
          </select>
        </div>
        <div className="col-md-3">
          <select className="form-select form-select-sm" value={sort} onChange={(e) => setSort(e.target.value as "name" | "qty" | "value")}>
            <option value="name">Sort: name</option>
            <option value="qty">Sort: quantity</option>
            <option value="value">Sort: value</option>
          </select>
        </div>
      </div>

      <div className="alert alert-primary py-2 small d-flex justify-content-between">
        <span><strong>{items.length}</strong> products</span>
        <span>Inventory value (cost): <strong>{toPesos(totalValue)}</strong></span>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-muted">No products match.</p>
      ) : (
        <table className="table table-hover align-middle">
          <thead>
            <tr>
              <th>Product</th><th>SKU</th><th>Category</th>
              <th className="text-end">On hand</th><th className="text-end">Reserved</th>
              <th className="text-end">Available</th><th className="text-end">Unit cost</th>
              <th className="text-end">Value</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td className="fw-semibold">{r.name}</td>
                <td className="small text-muted">{r.sku}</td>
                <td className="small text-muted">{r.category ?? "—"}</td>
                <td className="text-end">{r.quantityOnHand}</td>
                <td className="text-end text-muted">{r.quantityReserved}</td>
                <td className="text-end fw-semibold">{r.availableQuantity}</td>
                <td className="text-end">{toPesos(r.costMinor)}</td>
                <td className="text-end">{toPesos(r.valueMinor)}</td>
                <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}