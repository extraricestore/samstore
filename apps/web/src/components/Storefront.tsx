"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductDTO, PublicStoreDTO, CheckoutResponse } from "../types";
import ProductCard from "../components/ProductCard";
import CartDrawer, { type CartLineUI } from "../components/CartDrawer";
import CheckoutForm from "../components/CheckoutForm";

const toPesos = (minor: number) => `₱${(minor / 100).toFixed(2)}`;
const STORAGE_KEY = "samstore.cart.v1";

interface StorefrontProps {
  store: PublicStoreDTO;
  products: ProductDTO[];
}

export default function Storefront({ store, products }: StorefrontProps) {
  const [cartOpen, setCartOpen] = useState(false);
  const [view, setView] = useState<"menu" | "checkout" | "done">("menu");
  const [lastOrder, setLastOrder] = useState<CheckoutResponse | null>(null);
  const [orderInfo, setOrderInfo] = useState<{ name: string; phone: string; address: string } | null>(null);

  // cart state persisted to localStorage (guest cart token approach replaced later)
  const [lines, setLines] = useState<CartLineUI[]>([]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setLines(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {}
  }, [lines]);

  const addProduct = (p: ProductDTO) => {
    setLines((ls) => {
      const found = ls.find((l) => l.product.id === p.id);
      if (found) return ls.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { product: p, quantity: 1 }];
    });
  };

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setLines((ls) => ls.filter((l) => l.product.id !== productId));
      return;
    }
    setLines((ls) => ls.map((l) => (l.product.id === productId ? { ...l, quantity: qty } : l)));
  };

  const cartCount = lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.product.priceMinor * l.quantity, 0);
  const total = subtotal + (subtotal > 0 ? store.deliveryFeeMinor : 0);

  const handleCheckoutSuccess = (r: CheckoutResponse) => {
    setLastOrder(r);
    setLines([]);
    setView("done");
  };

  if (store.orderingPaused || !store.guestOrderingEnabled) {
    return (
      <div className="container py-5 text-center">
        <i className="bi bi-shop fs-1 d-block mb-3"></i>
        <h1 className="h3">{store.name}</h1>
        <p className="lead">{store.closedStoreMessage ?? "We're currently closed for orders. Please check back soon!"}</p>
      </div>
    );
  }

  return (
    <div className="storefront">
      {/* Navbar */}
      <nav className="navbar navbar-dark bg-dark sticky-top">
        <div className="container">
          <span className="navbar-brand fw-semibold">
            <i className="bi bi-shop me-2"></i>{store.name}
          </span>
          <button className="btn btn-outline-light position-relative" onClick={() => setCartOpen(true)}>
            <i className="bi bi-cart3 me-1"></i>Cart
            {cartCount > 0 && (
              <span className="badge rounded-pill bg-primary position-absolute top-0 start-100 translate-middle">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* Hero */}
      <header className="py-4 bg-light border-bottom">
        <div className="container">
          <h1 className="h3 mb-1">{store.name}</h1>
          {store.description && <p className="text-muted mb-0">{store.description}</p>}
          <small className="text-muted">
            {store.deliveryEnabled && `Delivery fee ${toPesos(store.deliveryFeeMinor)} · `}
            {store.minOrderAmountMinor > 0 && `Min order ${toPesos(store.minOrderAmountMinor)} · `}
            Cash on delivery
          </small>
        </div>
      </header>

      {/* Body */}
      <main className="container py-4">
        {view === "done" && lastOrder ? (
          <div className="text-center py-5">
            <i className="bi bi-check-circle-fill text-success fs-1 d-block mb-3"></i>
            <h2 className="h4">Order placed!</h2>
            <p className="mb-1">Your order number is</p>
            <h3 className="fw-bold text-primary">{lastOrder.orderNumber}</h3>
            <p className="text-muted mb-4">Total {toPesos(lastOrder.totalMinor)} · Cash on delivery</p>
            <button className="btn btn-outline-secondary" onClick={() => setView("menu")}>Back to menu</button>
          </div>
        ) : view === "checkout" ? (
          <CheckoutForm
            cartToken="cart-demo-token"
            deliveryFeeMinor={store.deliveryFeeMinor}
            totalMinor={total}
            onSuccess={handleCheckoutSuccess}
            onClose={() => setView("menu")}
          />
        ) : (
          <div className="row g-3">
            {products.map((p) => (
              <div className="col-6 col-md-4 col-lg-3" key={p.id}>
                <ProductCard product={p} onAdd={addProduct} />
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Cart drawer */}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        lines={lines}
        onUpdateQty={updateQty}
        onCheckout={() => { setCartOpen(false); setView("checkout"); }}
        deliveryFeeMinor={store.deliveryFeeMinor}
        minOrderMinor={store.minOrderAmountMinor}
      />
    </div>
  );
}