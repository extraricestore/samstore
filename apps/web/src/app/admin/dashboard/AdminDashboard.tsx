"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAdminToken, getAdminStoreId, setAdminStoreId } from "../../../lib/admin";
import { API_URL } from "../../../config";
import OrdersPanel from "../../../components/admin/OrdersPanel";
import ProductsPanel from "../../../components/admin/ProductsPanel";
import SettingsPanel from "../../../components/admin/SettingsPanel";
import VouchersPanel from "../../../components/admin/VouchersPanel";
import StoresPanel from "../../../components/admin/StoresPanel";
import CustomersPanel from "../../../components/admin/CustomersPanel";
import AnalyticsPanel from "../../../components/admin/AnalyticsPanel";
import MaintenancePanel from "../../../components/admin/MaintenancePanel";
import TeamPanel from "../../../components/admin/TeamPanel";
import WarehousesPanel from "../../../components/admin/WarehousesPanel";

type Tab = "orders" | "products" | "settings" | "vouchers" | "stores" | "customers" | "analytics" | "maintenance" | "team" | "warehouses";

interface MyStore { id: string; name: string; slug: string; role: string; }

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("orders");
  const [authed, setAuthed] = useState(false);
  const [stores, setStores] = useState<MyStore[]>([]);
  const [activeStore, setActiveStore] = useState<string | null>(null);

  useEffect(() => {
    if (!getAdminToken()) {
      router.replace("/admin/login");
      return;
    }
    setAuthed(true);
    setActiveStore(getAdminStoreId());
    // Load the user's stores for the switcher.
    fetch(`${API_URL}/admin/stores/mine`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.stores?.length) {
          setStores(data.stores);
          if (!getAdminStoreId()) setAdminStoreId(data.stores[0].id);
          setActiveStore(getAdminStoreId());
        }
      })
      .catch(() => { /* non-fatal */ });
  }, [router]);

  const switchStore = (storeId: string) => {
    setAdminStoreId(storeId);
    setActiveStore(storeId);
    // force panels to reload: bump a key would require prop wiring; simplest is a hard remount via key
    window.location.reload();
  };

  const logout = () => {
    sessionStorage.removeItem("samstore.admin.token");
    sessionStorage.removeItem("samstore.admin.storeId");
    router.push("/admin/login");
  };

  if (!authed) return null;
  const activeName = stores.find((s) => s.id === activeStore)?.name;

  return (
    <div key={activeStore ?? "none"}>
      <nav className="navbar navbar-dark bg-dark">
        <div className="container">
          <span className="navbar-brand fw-semibold">
            <i className="bi bi-speedometer2 me-2"></i>Sam&apos;s Admin
          </span>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            {stores.length > 0 && (
              <select
                className="form-select form-select-sm"
                style={{ width: 180 }}
                value={activeStore ?? ""}
                onChange={(e) => e.target.value && switchStore(e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                ))}
              </select>
            )}
            <ul className="nav nav-pills">
              {(["orders", "products", "team", "customers", "analytics", "vouchers", "settings", "warehouses", "stores", "maintenance"] as Tab[]).map((t) => (
                <li className="nav-item" key={t}>
                  <button
                    className={`nav-link text-capitalize ${tab === t ? "active bg-primary" : "text-light"}`}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn btn-outline-light btn-sm" onClick={logout}>
              <i className="bi bi-box-arrow-right me-1"></i>Log out
            </button>
          </div>
        </div>
      </nav>
      <main className="container py-4">
        {activeName && (
          <div className="alert alert-light border small py-2 d-flex justify-content-between align-items-center">
            <span><i className="bi bi-shop me-1"></i>Managing: <strong>{activeName}</strong></span>
            <a className="small" href="/sam-store" target="_blank" rel="noreferrer">view storefront</a>
          </div>
        )}
        {tab === "orders" && <OrdersPanel />}
        {tab === "products" && <ProductsPanel />}
        {tab === "settings" && <SettingsPanel />}
        {tab === "vouchers" && <VouchersPanel />}
        {tab === "team" && <TeamPanel />}
        {tab === "customers" && <CustomersPanel />}
        {tab === "analytics" && <AnalyticsPanel />}
        {tab === "maintenance" && <MaintenancePanel />}
        {tab === "warehouses" && <WarehousesPanel />}
        {tab === "stores" && <StoresPanel />}
      </main>
    </div>
  );
}