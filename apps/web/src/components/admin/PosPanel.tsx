"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";
import { toast } from "../../lib/toast";

interface PosProduct {
  id: string;
  name: string;
  sku: string;
  priceMinor: number;
  availableQuantity: number;
}
interface PosCustomer { id: string; name: string | null; email: string | null; phone: string | null; }
interface CartLine { product: PosProduct; quantity: number; }

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;

export default function PosPanel() {
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [payment, setPayment] = useState<"cash" | "credit">("cash");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        fetch(`${API_URL}/admin/products`, { headers: adminHeaders() }).then((r) => r.json()),
        fetch(`${API_URL}/admin/customers`, { headers: adminHeaders() }).then((r) => r.json()),
      ]);
      setProducts(p.products ?? []);
      setCustomers(c.customers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addProduct = (product: PosProduct) => {
    setError(null); setSuccess(null);
    setCart((c) => {
      const found = c.find((l) => l.product.id === product.id);
      if (found) {
        if (found.quantity + 1 > product.availableQuantity) {
          setError(`Only ${product.availableQuantity} in stock for ${product.name}`);
          return c;
        }
        return c.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...c, { product, quantity: 1 }];
    });
  };

  const setQty = (productId: string, qty: number) => {
    setCart((c) => {
      if (qty <= 0) return c.filter((l) => l.product.id !== productId);
      const line = c.find((l) => l.product.id === productId);
      if (line && qty > line.product.availableQuantity) {
        setError(`Only ${line.product.availableQuantity} in stock`);
        return c;
      }
      return c.map((l) => (l.product.id === productId ? { ...l, quantity: qty } : l));
    });
  };

  const subtotal = cart.reduce((s, l) => s + l.product.priceMinor * l.quantity, 0);

  const sell = async () => {
    if (cart.length === 0) { setError("Cart is empty"); return; }
    setBusy(true); setError(null); setSuccess(null);
    try {
      const res = await fetch(`${API_URL}/admin/pos/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({
          items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          paymentMethod: payment,
          ...(customerId ? { customerId } : { customerName: customerName || undefined }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.errors?.join(", ") ?? data?.message ?? "Sale failed");
        return;
      }
      setSuccess(`${data.paymentMethod === "credit" ? "Credit sale" : "Sale"} completed — ${data.orderNumber} · ${toPesos(data.totalMinor)} (cash changes ${payment === "cash" ? "OK" : "n/a"})`);
      toast(`${data.paymentMethod === "credit" ? "Credit sale" : "Sale"} ${data.orderNumber} completed · ${toPesos(data.totalMinor)}`);
      setCart([]);
      setCustomerId(""); setCustomerName("");
      await load(); // refresh stock
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sale failed");
    } finally {
      setBusy(false);
    }
  };

  const filtered = search
    ? products.filter((p) => (p.name + p.sku).toLowerCase().includes(search.toLowerCase()))
    : products;

  return (
    <div>
      <h1 className="h4 mb-3"><i className="bi bi-cash-register me-2"></i>Sell (POS)</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      {success && <div className="alert alert-success py-2 small">{success}</div>}

      <div className="row g-3">
        {/* Left: product picker */}
        <div className="col-md-7">
          <div className="card">
            <div className="card-body">
              <input className="form-control form-control-sm mb-2" placeholder="Search by name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="row g-2" style={{ maxHeight: 420, overflowY: "auto" }}>
                {filtered.map((p) => (
                  <div className="col-6 col-lg-4" key={p.id}>
                    <button
                      type="button"
                      className="btn btn-outline-primary w-100 h-100 py-2 d-flex flex-column align-items-center justify-content-center"
                      style={{ minHeight: 84 }}
                      disabled={p.availableQuantity <= 0}
                      onClick={() => addProduct(p)}
                    >
                      <span className="fw-semibold small text-truncate w-100 text-center">{p.name}</span>
                      <span className="small">{toPesos(p.priceMinor)}</span>
                      <span className={`small ${p.availableQuantity <= 0 ? "text-danger" : "text-muted"}`}>
                        {p.availableQuantity <= 0 ? "Out" : `${p.availableQuantity} left`}
                      </span>
                    </button>
                  </div>
                ))}
                {filtered.length === 0 && <div className="col-12 text-muted small py-3 text-center">No products match.</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Right: cart + payment */}
        <div className="col-md-5">
          <div className="card">
            <div className="card-body">
              <div className="row g-2 mb-2">
                <div className="col-7">
                  <select className="form-select form-select-sm" value={customerId} onChange={(e) => { setCustomerId(e.target.value); if (e.target.value) setCustomerName(""); }}>
                    <option value="">Walk-in (no customer)…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name ?? c.email ?? c.phone ?? "Customer"}</option>
                    ))}
                  </select>
                </div>
                <div className="col-5">
                  <input className="form-control form-control-sm" placeholder="Or name" value={customerName} disabled={!!customerId} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
              </div>

              {cart.length === 0 ? (
                <p className="text-muted small text-center py-4">Tap products to add to the sale.</p>
              ) : (
                <ul className="list-group list-group-flush mb-2" style={{ maxHeight: 240, overflowY: "auto" }}>
                  {cart.map((l) => (
                    <li key={l.product.id} className="list-group-item px-0 d-flex align-items-center gap-2">
                      <div className="flex-grow-1 small">
                        <div className="fw-semibold">{l.product.name}</div>
                        <div className="text-muted">{toPesos(l.product.priceMinor)}</div>
                      </div>
                      <div className="input-group input-group-sm" style={{ width: 108 }}>
                        <button className="btn btn-outline-secondary" onClick={() => setQty(l.product.id, l.quantity - 1)}>-</button>
                        <input className="form-control text-center" value={l.quantity} readOnly />
                        <button className="btn btn-outline-secondary" onClick={() => setQty(l.product.id, l.quantity + 1)}>+</button>
                      </div>
                      <div className="fw-semibold small" style={{ width: 66, textAlign: "right" }}>{toPesos(l.product.priceMinor * l.quantity)}</div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="d-flex justify-content-between fw-bold fs-5 mb-3">
                <span>Total</span><span>{toPesos(subtotal)}</span>
              </div>
              <div className="btn-group w-100 mb-3" role="group">
                <button type="button" className={`btn ${payment === "cash" ? "btn-success" : "btn-outline-success"}`} onClick={() => setPayment("cash")}>
                  <i className="bi bi-cash me-1"></i>Cash
                </button>
                <button type="button" className={`btn ${payment === "credit" ? "btn-warning" : "btn-outline-warning"}`} onClick={() => setPayment("credit")}>
                  <i className="bi bi-journal me-1"></i>Credit (utang)
                </button>
              </div>
              <button className="btn btn-primary btn-lg w-100" disabled={cart.length === 0 || busy} onClick={sell}>
                <i className="bi bi-check2-circle me-1"></i>{busy ? "Completing…" : `Complete sale · ${toPesos(subtotal)}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}