"use client";

// POS (V1) — staged, mobile-first: Products → Review (customer + autosave) → Payment
// (Cash w/ tendered + change, or Utang w/ start/due dates) → Done (+print receipt).
// Hold: creates an ON_HOLD order (stock earmarked) listed in the held strip; Resume loads it back.

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";
import { toast } from "../../lib/toast";
import ReceiptModal from "./ReceiptModal";

interface PosProduct {
  id: string; name: string; sku: string; priceMinor: number;
  availableQuantity: number; category: { name: string } | null;
}
interface PosCustomer { id: string; name: string | null; email: string | null; phone: string | null; }
interface CartLine { product: PosProduct; quantity: number; }
interface HeldOrder { id: string; orderNumber: string; totalMinor: number; customerName: string; storeCustomerId: string | null; createdAt: string; items: { productId: string; productName: string; quantity: number; unitPriceMinor: number }[]; }
interface LastSale { orderId: string; orderNumber: string; totalMinor: number; changeMinor: number; paymentMethod: string }

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;
const QUICK_CASH = [5000, 10000, 20000, 50000, 100000];

export default function PosPanel() {
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [holds, setHolds] = useState<HeldOrder[]>([]);
  const [step, setStep] = useState<"products" | "review" | "payment" | "done">("products");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [payment, setPayment] = useState<"cash" | "credit">("cash");
  const [tendered, setTendered] = useState("");
  const [startAt, setStartAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [termDays, setTermDays] = useState(30);
  const [workingHoldId, setWorkingHoldId] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, c, h, s] = await Promise.all([
        fetch(`${API_URL}/admin/products`, { headers: adminHeaders() }).then((r) => r.json()),
        fetch(`${API_URL}/admin/customers`, { headers: adminHeaders() }).then((r) => r.json()),
        fetch(`${API_URL}/admin/pos/holds`, { headers: adminHeaders() }).then((r) => r.json()),
        fetch(`${API_URL}/admin/settings`, { headers: adminHeaders() }).then((r) => r.json()),
      ]);
      setProducts(p.products ?? []);
      setCustomers(c.customers ?? []);
      setHolds(h.holds ?? []);
      setTermDays(s?.settings?.creditTermDays ?? 30);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const subtotal = cart.reduce((s, l) => s + l.product.priceMinor * l.quantity, 0);
  const tenderedMinor = Math.round(parseFloat(tendered || "0") * 100);
  const changeMinor = payment === "cash" ? tenderedMinor - subtotal : 0;
  const canPay = cart.length > 0 && (payment === "cash" ? tenderedMinor >= subtotal : !!customerId);

  const addProduct = (product: PosProduct) => {
    setError(null);
    setCart((c) => {
      const found = c.find((l) => l.product.id === product.id);
      if (found) {
        if (found.quantity + 1 > product.availableQuantity) { setError(`Only ${product.availableQuantity} left for ${product.name}`); return c; }
        return c.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...c, { product, quantity: 1 }];
    });
  };

  const setQty = (productId: string, qty: number) => {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.product.id !== productId) : c.map((l) => (l.product.id === productId ? { ...l, quantity: qty } : l))));
  };

  // Customer: select existing, or quick-create (autosave) by name/phone.
  const ensureCustomer = async (): Promise<string | null> => {
    if (customerId) return customerId;
    if (!newName.trim()) return null;
    const res = await fetch(`${API_URL}/admin/pos/quick-customer`, {
      method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ name: newName.trim(), phone: newPhone.trim() || undefined }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    setCustomerId(d.id);
    await load();
    return d.id;
  };

  const quickCash = (minor: number) => setTendered((minor / 100).toString());

  const hold = async () => {
    if (cart.length === 0) { setError("Cart is empty"); return; }
    setBusy(true); setError(null);
    try {
      // If resuming, first void the old hold then create fresh (keeps items authoritative).
      const customer = await ensureCustomer();
      const res = await fetch(`${API_URL}/admin/pos/hold`, {
        method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })), customerId: customer ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.errors?.join(", ") ?? data?.message ?? "Hold failed"); return; }
      if (workingHoldId) {
        await fetch(`${API_URL}/admin/pos/holds/${workingHoldId}/void`, { method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() }, body: JSON.stringify({ reason: "re-held with edits" }) });
      }
      toast(`Held ${data.orderNumber} — stock reserved`);
      resetSale();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hold failed");
    } finally { setBusy(false); }
  };

  const resume = (h: HeldOrder) => {
    setError(null);
    const lineMap = new Map(products.map((p) => [p.id, p]));
    const lines: CartLine[] = [];
    for (const it of h.items) {
      const prod = lineMap.get(it.productId);
      if (prod) lines.push({ product: prod, quantity: it.quantity });
    }
    setCart(lines);
    setCustomerId(h.storeCustomerId ?? "");
    setWorkingHoldId(h.id);
    setPayment("cash");
    setTendered("");
    setStep("review");
  };

  const complete = async () => {
    if (!canPay) { setError(payment === "cash" ? "Tendered amount must cover the total" : "Select a customer for utang"); return; }
    setBusy(true); setError(null);
    try {
      const customer = await ensureCustomer();
      if (payment === "credit" && !customer) { setError("Add or select a customer for utang"); setBusy(false); return; }
      const payload = {
        items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        paymentMethod: payment,
        tenderedMinor: payment === "cash" ? tenderedMinor : undefined,
        customerId: customer ?? undefined,
        startAt: payment === "credit" ? (startAt || new Date().toISOString()) : undefined,
        dueAt: payment === "credit" ? (dueAt || undefined) : undefined,
      };
      const url = workingHoldId
        ? `${API_URL}/admin/pos/holds/${workingHoldId}/complete`
        : `${API_URL}/admin/pos/sell`;
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) { setError(data?.errors?.join(", ") ?? data?.message ?? "Sale failed"); return; }
      setLastSale({ orderId: data.orderId, orderNumber: data.orderNumber, totalMinor: data.totalMinor, changeMinor: data.changeMinor ?? 0, paymentMethod: data.paymentMethod });
      toast(`${payment === "cash" ? "Sale" : "Utang sale"} ${data.orderNumber} completed`);
      setStep("done");
      resetSale();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sale failed");
    } finally { setBusy(false); }
  };

  const resetSale = () => {
    setCart([]); setCustomerId(""); setNewName(""); setNewPhone("");
    setTendered(""); setStartAt(""); setDueAt(""); setWorkingHoldId(null);
  };

  const categories = [...new Set(products.map((p) => p.category?.name).filter(Boolean))] as string[];
  const filtered = products.filter((p) => {
    const q = search.trim().toLowerCase();
    const inSearch = !q || (p.name + p.sku).toLowerCase().includes(q);
    const inCat = !category || p.category?.name === category;
    return inSearch && inCat;
  });

  const fmtDate = (iso: string) => iso.slice(0, 10);

  return (
    <div>
      <h1 className="h4 mb-2"><i className="bi bi-cash-register me-2"></i>POS</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      {receiptOrder && <ReceiptModal orderId={receiptOrder} onClose={() => setReceiptOrder(null)} />}

      {/* step indicator */}
      <div className="d-flex gap-2 small mb-3">
        {(["products", "review", "payment", "done"] as const).map((s, i) => (
          <span key={s} className={`badge ${step === s ? "text-bg-primary" : "text-bg-secondary"}`}>{i + 1}. {s}</span>
        ))}
      </div>

      {/* ── DONE ── */}
      {step === "done" && lastSale && (
        <div className="card text-center border-success shadow-sm">
          <div className="card-body p-4">
            <i className="bi bi-check-circle-fill text-success fs-1 d-block mb-2"></i>
            <h2 className="h4 mb-1">Order completed</h2>
            <div className="h3 fw-bold text-primary">{lastSale.orderNumber}</div>
            <p className="mb-1">Total <strong>{toPesos(lastSale.totalMinor)}</strong></p>
            {lastSale.paymentMethod === "cash" && (
              <p className={`h5 mb-2 ${lastSale.changeMinor >= 0 ? "text-success" : ""}`}>Change: <strong>{toPesos(lastSale.changeMinor)}</strong></p>
            )}
            {lastSale.paymentMethod === "credit" && <p className="mb-2 text-warning">Charged to credit (utang)</p>}
            <div className="d-grid gap-2">
              <button className="btn btn-primary btn-lg" onClick={() => { setLastSale(null); setStep("products"); }}>
                <i className="bi bi-plus-lg me-1"></i>New sale
              </button>
              <button className="btn btn-outline-secondary" onClick={() => setReceiptOrder(lastSale.orderId)}>
                <i className="bi bi-printer me-1"></i>Print receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PRODUCTS ── */}
      {step === "products" && (
        <>
          <div className="d-flex gap-2 mb-2 flex-wrap">
            <input className="form-control form-control-sm" style={{ maxWidth: 200 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className={`btn btn-sm ${category === "" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setCategory("")}>All</button>
            {categories.map((c) => (
              <button key={c} className={`btn btn-sm ${category === c ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setCategory(category === c ? "" : c)}>{c}</button>
            ))}
          </div>

          {holds.length > 0 && (
            <div className="alert alert-light border small mb-2 d-flex flex-wrap gap-2 align-items-center">
              <span className="fw-semibold"><i className="bi bi-pause-circle me-1"></i>On hold ({holds.length})</span>
              {holds.map((h) => (
                <button key={h.id} className="btn btn-sm btn-outline-warning" onClick={() => resume(h)}>
                  {h.orderNumber} · {toPesos(h.totalMinor)} · resume
                </button>
              ))}
            </div>
          )}

          <div className="row g-2">
            {filtered.map((p) => (
              <div className="col-6 col-md-4 col-lg-3" key={p.id}>
                <button
                  type="button"
                  className="btn btn-outline-primary w-100 py-3 d-flex flex-column"
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
          </div>

          {/* sticky bottom bar */}
          <div className="position-fixed bottom-0 start-0 end-0 bg-white border-top shadow-sm d-flex align-items-center justify-content-between px-3 py-2">
            <div>
              <div className="fw-bold">{cart.reduce((s, l) => s + l.quantity, 0)} item(s)</div>
              <div className="text-muted small">{toPesos(subtotal)}</div>
            </div>
            <button className="btn btn-primary btn-lg" disabled={cart.length === 0} onClick={() => setStep("review")}>
              Review order <i className="bi bi-arrow-right ms-1"></i>
            </button>
          </div>
        </>
      )}

      {/* ── REVIEW ── */}
      {step === "review" && (
        <div className="card mb-2">
          <div className="card-body">
            {cart.length === 0 ? (
              <p className="text-muted small text-center py-4">No items — go back and add products.</p>
            ) : (
              <>
                {cart.map((l) => (
                  <div key={l.product.id} className="d-flex align-items-center gap-2 mb-1">
                    <div className="flex-grow-1 small">
                      <div className="fw-semibold">{l.product.name}</div>
                      <div className="text-muted">{toPesos(l.product.priceMinor)}</div>
                    </div>
                    <div className="input-group input-group-sm" style={{ width: 104 }}>
                      <button className="btn btn-outline-secondary" onClick={() => setQty(l.product.id, l.quantity - 1)}>-</button>
                      <input className="form-control text-center" value={l.quantity} readOnly />
                      <button className="btn btn-outline-secondary" onClick={() => setQty(l.product.id, l.quantity + 1)}>+</button>
                    </div>
                    <div className="fw-semibold small" style={{ width: 66, textAlign: "right" }}>{toPesos(l.product.priceMinor * l.quantity)}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* customer + payment (review/payment share the card) */}
      {step === "review" && (
        <div className="card mb-2">
          <div className="card-body">
            <h6 className="small fw-bold mb-2">Customer</h6>
            <select className="form-select form-select-sm mb-1" value={customerId} onChange={(e) => { setCustomerId(e.target.value); if (e.target.value) { setNewName(""); setNewPhone(""); } }}>
              <option value="">Walk-in (no customer)…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.email ?? c.phone ?? "Customer"}</option>)}
            </select>
            {!customerId && (
              <div className="row g-1 mb-1">
                <div className="col-7"><input className="form-control form-control-sm" placeholder="New customer name (autosaves)" value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
                <div className="col-5"><input className="form-control form-control-sm" placeholder="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} /></div>
              </div>
            )}
            {newName.trim() && !customerId && <small className="text-muted">Customer is saved automatically when you complete.</small>}

            <div className="d-flex justify-content-between fw-bold fs-5 mt-2 mb-2">
              <span>Total</span><span>{toPesos(subtotal)}</span>
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary flex-fill" onClick={() => setStep("products")}>Back</button>
              <button className="btn btn-warning flex-fill" disabled={cart.length === 0 || busy} onClick={hold}>
                <i className="bi bi-pause-circle me-1"></i>Hold order
              </button>
              <button className="btn btn-primary flex-fill" disabled={cart.length === 0} onClick={() => { setError(null); setStep("payment"); }}>
                Pay <i className="bi bi-arrow-right ms-1"></i>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PAYMENT ── */}
      {step === "payment" && (
        <div className="card">
          <div className="card-body">
            <h6 className="small fw-bold mb-2">Mode of payment</h6>
            <div className="d-flex gap-2 mb-3">
              <button type="button" className={`btn ${payment === "cash" ? "btn-success" : "btn-outline-success"} flex-fill`} onClick={() => setPayment("cash")}>
                <i className="bi bi-cash me-1"></i>Cash
              </button>
              <button type="button" className={`btn ${payment === "credit" ? "btn-warning" : "btn-outline-warning"} flex-fill`} onClick={() => setPayment("credit")}>
                <i className="bi bi-journal me-1"></i>Utang (credit)
              </button>
            </div>

            {payment === "cash" ? (
              <>
                <label className="form-label small">Amount payable: <strong>{toPesos(subtotal)}</strong></label>
                <input className="form-control form-control-lg text-end mb-2" type="number" inputMode="decimal" min="0" step="0.01" placeholder="Enter amount paid by customer" value={tendered} onChange={(e) => setTendered(e.target.value)} />
                <div className="d-flex flex-wrap gap-1 mb-2">
                  {QUICK_CASH.map((q) => <button key={q} type="button" className="btn btn-sm btn-outline-secondary" onClick={() => quickCash(q)}>{toPesos(q)}</button>)}
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => quickCash(subtotal)}>Exact</button>
                </div>
                <div className="d-flex justify-content-between fs-5 mb-3">
                  <span className="text-muted">Change</span>
                  <span className={changeMinor >= 0 ? "text-success fw-bold" : "text-danger"}>
                    {changeMinor < 0 ? `Short ${toPesos(-changeMinor)}` : toPesos(changeMinor)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="small text-muted mb-2">Charged to the customer&apos;s credit (utang). Approved customers only.</p>
                {!customerId && (
                  <>
                    <input className="form-control form-control-sm mb-1" placeholder="Customer name (saves automatically)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    <input className="form-control form-control-sm mb-2" placeholder="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                  </>
                )}
                <div className="row g-2 mb-3">
                  <div className="col-6">
                    <label className="form-label small">Start date</label>
                    <input className="form-control form-control-sm" type="date" value={startAt ? fmtDate(startAt) : ""} onChange={(e) => setStartAt(e.target.value ? new Date(e.target.value).toISOString() : "")} />
                  </div>
                  <div className="col-6">
                    <label className="form-label small">Due date (default +{termDays}d)</label>
                    <input className="form-control form-control-sm" type="date" value={dueAt ? fmtDate(dueAt) : ""} onChange={(e) => setDueAt(e.target.value ? new Date(e.target.value).toISOString() : "")} />
                  </div>
                  {!dueAt && startAt && (
                    <small className="text-muted">Due date will default to start + {termDays} days.</small>
                  )}
                </div>
              </>
            )}

            {workingHoldId && <div className="alert alert-light small py-2 mb-2"><i className="bi bi-pause-circle me-1"></i>Completing held order (resumed sale).</div>}

            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary flex-fill" onClick={() => setStep("review")}>Back</button>
              <button className="btn btn-success btn-lg flex-fill" disabled={!canPay || busy} onClick={complete}>
                {busy ? "Completing…" : `Complete · ${toPesos(subtotal)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}