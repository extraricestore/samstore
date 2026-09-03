"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAdminToken } from "../../../lib/admin";
import OrdersPanel from "../../../components/admin/OrdersPanel";
import ProductsPanel from "../../../components/admin/ProductsPanel";

type Tab = "orders" | "products";

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("orders");
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (!getAdminToken()) {
      router.replace("/admin/login");
      return;
    }
    setAuthed(true);
  }, [router]);

  const logout = () => {
    sessionStorage.removeItem("samstore.admin.token");
    router.push("/admin/login");
  };

  if (!authed) return null;

  return (
    <div>
      <nav className="navbar navbar-dark bg-dark">
        <div className="container">
          <span className="navbar-brand fw-semibold">
            <i className="bi bi-speedometer2 me-2"></i>Sam&apos;s Admin
          </span>
          <div className="d-flex align-items-center gap-2">
            <ul className="nav nav-pills">
              <li className="nav-item">
                <button
                  className={`nav-link ${tab === "orders" ? "active bg-primary" : "text-light"}`}
                  onClick={() => setTab("orders")}
                >
                  Orders
                </button>
              </li>
              <li className="nav-item">
                <button
                  className={`nav-link ${tab === "products" ? "active bg-primary" : "text-light"}`}
                  onClick={() => setTab("products")}
                >
                  Products
                </button>
              </li>
            </ul>
            <button className="btn btn-outline-light btn-sm" onClick={logout}>
              <i className="bi bi-box-arrow-right me-1"></i>Log out
            </button>
          </div>
        </div>
      </nav>
      <main className="container py-4">
        {tab === "orders" ? <OrdersPanel /> : <ProductsPanel />}
      </main>
    </div>
  );
}