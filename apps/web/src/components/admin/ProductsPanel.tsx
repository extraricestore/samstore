"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { getAdminToken, adminHeaders } from "../../lib/admin";

export interface AdminProduct {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  priceMinor: number;
  isActive: boolean;
  category: { id: string; name: string; slug: string } | null;
  quantityOnHand: number;
  quantityReserved: number;
  availableQuantity: number;
  reorderThreshold: number;
}

interface ProductForm {
  name: string;
  sku: string;
  priceMinor: string; // pesos input, converted to minor units
  stock: string;
  categorySlug: string;
  description: string;
}

const EMPTY_FORM: ProductForm = { name: "", sku: "", priceMinor: "", stock: "", categorySlug: "", description: "" };

export default function ProductsPanel() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; editing: AdminProduct | null }>({ open: false, editing: null });
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const token = () => getAdminToken();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, cRes] = await Promise.all([
        fetch(`${API_URL}/admin/products`, { headers: adminHeaders() }),
                fetch(`${API_URL}/admin/products/categories`, { headers: adminHeaders() }),
      ]);
      if (!pRes.ok) throw new Error("Failed to load products");
      const p = await pRes.json();
      const c = await cRes.json();
      setProducts(p.products);
      setCategories(c.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setModal({ open: true, editing: null });
  };

  const openEdit = (p: AdminProduct) => {
    setForm({
      name: p.name,
      sku: p.sku,
      priceMinor: (p.priceMinor / 100).toString(),
      stock: p.quantityOnHand.toString(),
      categorySlug: p.category?.slug ?? "",
      description: p.description ?? "",
    });
    setModal({ open: true, editing: p });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const priceMinor = Math.round(parseFloat(form.priceMinor) * 100);
      const payload = {
        name: form.name,
        sku: form.sku,
        priceMinor,
        stock: form.stock === "" ? undefined : parseInt(form.stock, 10),
        categorySlug: form.categorySlug || undefined,
        description: form.description || undefined,
      };
      const res = await fetch(
        `${API_URL}/admin/products${modal.editing ? `/${modal.editing.id}` : ""}`,
        {
          method: modal.editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...adminHeaders() },
                    body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.errors?.join(", ") ?? data?.message ?? "Save failed");
        return;
      }
      setModal({ open: false, editing: null });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: AdminProduct) => {
    await fetch(`${API_URL}/admin/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
            body: JSON.stringify({ isActive: !p.isActive }),
    });
    await load();
  };

  const toPesos = (minor: number) => `₱${(minor / 100).toFixed(2)}`;

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">Products</h1>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <i className="bi bi-plus-lg me-1"></i>New product
        </button>
      </div>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : products.length === 0 ? (
        <p className="text-muted">No products yet. Create your first one!</p>
      ) : (
        <table className="table table-hover align-middle">
          <thead>
            <tr>
              <th>Product</th>
              <th>SKU</th>
              <th className="text-end">Price</th>
              <th className="text-end">Stock</th>
              <th>Category</th>
              <th>Status</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className={p.isActive ? "" : "table-secondary"}>
                <td className="fw-semibold">{p.name}</td>
                <td className="text-muted small">{p.sku}</td>
                <td className="text-end">{toPesos(p.priceMinor)}</td>
                <td className={`text-end ${p.availableQuantity <= p.reorderThreshold ? "text-danger fw-semibold" : ""}`}>
                  {p.availableQuantity}
                  {p.quantityReserved > 0 && <small className="text-muted"> ({p.quantityReserved} reserved)</small>}
                </td>
                <td className="small">{p.category?.name ?? "—"}</td>
                <td>
                  <span className={`badge ${p.isActive ? "text-bg-success" : "text-bg-secondary"}`}>
                    {p.isActive ? "Active" : "Hidden"}
                  </span>
                </td>
                <td className="text-end">
                  <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => openEdit(p)}>
                    <i className="bi bi-pencil"></i>
                  </button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => toggleActive(p)}>
                    <i className={`bi ${p.isActive ? "bi-eye-slash" : "bi-eye"}`}></i>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create/Edit modal */}
      {modal.open && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <form onSubmit={save}>
                  <div className="modal-header">
                    <h5 className="modal-title">{modal.editing ? "Edit product" : "New product"}</h5>
                    <button type="button" className="btn-close" onClick={() => setModal({ open: false, editing: null })}></button>
                  </div>
                  <div className="modal-body">
                    <div className="mb-2">
                      <label className="form-label small">Name *</label>
                      <input className="form-control" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="mb-2">
                      <label className="form-label small">SKU *</label>
                      <input className="form-control" required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
                    </div>
                    <div className="row">
                      <div className="col-6 mb-2">
                        <label className="form-label small">Price (₱) *</label>
                        <input className="form-control" required type="number" step="0.01" min="0" value={form.priceMinor} onChange={(e) => setForm({ ...form, priceMinor: e.target.value })} />
                      </div>
                      <div className="col-6 mb-2">
                        <label className="form-label small">Stock</label>
                        <input className="form-control" type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                      </div>
                    </div>
                    <div className="mb-2">
                      <label className="form-label small">Category</label>
                      <select className="form-select" value={form.categorySlug} onChange={(e) => setForm({ ...form, categorySlug: e.target.value })}>
                        <option value="">— none —</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.slug}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mb-2">
                      <label className="form-label small">Description</label>
                      <textarea className="form-control" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-outline-secondary" onClick={() => setModal({ open: false, editing: null })}>Cancel</button>
                    <button className="btn btn-primary" type="submit" disabled={saving}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </>
      )}
    </div>
  );
}