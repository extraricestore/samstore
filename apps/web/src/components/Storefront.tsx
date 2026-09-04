"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProductDTO, PublicStoreDTO, CheckoutResponse, CartWithItemsDTO } from "../types";
import ProductCard from "../components/ProductCard";
import CartDrawer, { type CartLineUI } from "../components/CartDrawer";
import CheckoutForm from "../components/CheckoutForm";
import OrderTracker from "../components/OrderTracker";
import { CustomerAccount } from "../components/CustomerAccount";
import {
  ensureCartToken,
  getStoredCartToken,
  getCart,
  addItem,
  updateItemQuantity,
  removeItem,
  clearStoredCartToken,
} from "../lib/cart-client";

const toPesos = (minor: number) => `₱${(minor / 100).toFixed(2)}`;

interface StorefrontProps {
  store: PublicStoreDTO;
  products: ProductDTO[];
}

export default function Storefront({ store, products }: StorefrontProps) {
  const [cartOpen, setCartOpen] = useState(false);
  const [view, setView] = useState<"menu" | "checkout" | "done">("menu");
  const [cartToken, setCartToken] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLineUI[]>([]);
  const [cartError, setCartError] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<CheckoutResponse | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const productById = useCallback(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const toLines = useCallback(
    (cart: CartWithItemsDTO): CartLineUI[] =>
      cart.items
        .map((i) => {
          const product = productById().get(i.productId);
          if (!product) return null;
          return { product: { ...product, priceMinor: i.unitPriceMinor }, quantity: i.quantity };
        })
        .filter((l): l is CartLineUI => l !== null),
    [productById],
  );

  // Hydrate an existing cart (token in localStorage) on mount.
  useEffect(() => {
    const token = getStoredCartToken();
    if (!token) return;
    setCartToken(token);
    getCart(token)
      .then((cart) => setLines(toLines(cart)))
      .catch(() => {
        // stale token → start fresh
        clearStoredCartToken();
        setCartToken(null);
      });
  }, [toLines]);

  const addProduct = async (p: ProductDTO) => {
    setCartError(null);
    try {
      const token = cartToken ?? (await ensureCartToken());
      setCartToken(token);
      const cart = await addItem(token, p.id, 1);
      setLines(toLines(cart));
    } catch (e) {
      setCartError(e instanceof Error ? e.message : "Could not add item");
    }
  };

  const updateQty = async (productId: string, qty: number) => {
    if (!cartToken) return;
    setCartError(null);
    try {
      const cart =
        qty <= 0
          ? await removeItem(cartToken, productId)
          : await updateItemQuantity(cartToken, productId, qty);
      setLines(toLines(cart));
    } catch (e) {
      setCartError(e instanceof Error ? e.message : "Could not update item");
    }
  };

  const handleCheckoutSuccess = (r: CheckoutResponse) => {
    setLastOrder(r);
    setLines([]);
    clearStoredCartToken();
    setCartToken(null);
    setView("done");
  };

  const cartCount = lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.product.priceMinor * l.quantity, 0);
  const total = subtotal + (subtotal > 0 ? store.deliveryFeeMinor : 0);

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
      {/* Per-store branding (P8): accent color scoped to this page */}
      <style>{`
        .storefront { --sam-primary: ${store.accentColor ?? "#d94f2b"}; }
        .storefront .btn-primary { background-color: var(--sam-primary); border-color: var(--sam-primary); }
      `}</style>
      {store.bannerText && (
        <div className="text-center py-2 fw-semibold small text-white" style={{ background: store.accentColor ?? "#d94f2b" }}>
          {store.bannerText}
        </div>
      )}
      {/* Navbar */}
      <nav className="navbar navbar-dark bg-dark sticky-top">
        <div className="container">
          <span className="navbar-brand fw-semibold">
            <i className="bi bi-shop me-2"></i>{store.name}
          </span>
          <div className="d-flex align-items-center gap-2">
            <button className="btn btn-outline-light btn-sm" onClick={() => setAccountOpen((v) => !v)}>
              <i className="bi bi-person me-1"></i>Account
            </button>
            <button className="btn btn-outline-light position-relative" onClick={() => setCartOpen(true)}>
              <i className="bi bi-cart3 me-1"></i>Cart
              {cartCount > 0 && (
                <span className="badge rounded-pill bg-primary position-absolute top-0 start-100 translate-middle">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
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
        {accountOpen && (
          <div className="mb-4" style={{ maxWidth: 420 }}>
            <CustomerAccount />
          </div>
        )}
        {cartError && (
          <div className="alert alert-danger py-2 small">{cartError}</div>
        )}
        {view === "done" && lastOrder ? (
          <div className="text-center py-5">
            <i className="bi bi-check-circle-fill text-success fs-1 d-block mb-3"></i>
            <h2 className="h4">Order placed!</h2>
            <p className="mb-1">Your order number is</p>
            <h3 className="fw-bold text-primary">{lastOrder.orderNumber}</h3>
            <p className="text-muted mb-4">Total {toPesos(lastOrder.totalMinor)} · Cash on delivery</p>
            <p className="small text-muted">Keep this link to track your order:</p>
            <code className="d-block mb-3 small text-break">{lastOrder.claimToken}</code>
            <OrderTracker initialToken={lastOrder.claimToken} />
            <div className="mt-4">
              <button className="btn btn-outline-secondary" onClick={() => setView("menu")}>Back to menu</button>
            </div>
          </div>
        ) : view === "checkout" ? (
          <CheckoutForm
            cartToken={cartToken ?? ""}
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