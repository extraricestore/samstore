"use client";

// Overview — KPI landing (U3): today's sales, pending, out-for-delivery, low stock, utang.
// Numbers come from the live API (analytics/status, analytics/daily, inventory, credit/utang).

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";
import BarChart from "./BarChart";

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;

interface OverviewProps {
  onNavigate: (tab: string) => void;
  storeSlug?: string;
  storeName?: string;
}

interface StatusRow { status: string; count: number; revenueMinor: number }
interface DayRow { date: string; count: number; revenueMinor: number }

export default function OverviewPanel({ onNavigate, storeSlug, storeName }: OverviewProps) {
  const [status, setStatus] = useState<StatusRow[]>([]);
  const [daily, setDaily] = useState<DayRow[]>([]);
  const [lowStockCount, setLowStockCount] = useState<number | null>(null);
  const [utangMinor, setUtangMinor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, dRes, iRes] = await Promise.all([
        fetch(`${API_URL}/admin/analytics/status`, { headers: adminHeaders() }),
        fetch(`${API_URL}/admin/analytics/daily?days=7`, { headers: adminHeaders() }),
        fetch(`${API_URL}/admin/inventory?status=low`, { headers: adminHeaders() }),
      ]);
      if (!sRes.ok) throw new Error("Failed to load overview");
      setStatus(((await sRes.json()).rows ?? []) as StatusRow[]);
      setDaily((await dRes.json()).days ?? []);
      if (iRes.ok) setLowStockCount(((await iRes.json()).items ?? []).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Utang owed (owner/manager surface — silently skip on 403)
  useEffect(() => {
    fetch(`${API_URL}/admin/credit/utang`, { headers: adminHeaders() })
      .then((r) => (r.ok ? r.json() : null) as Promise<{ customers?: { balanceMinor: number }[] } | null>)
      .then((d) => setUtangMinor(d?.customers?.reduce((s, c) => s + c.balanceMinor, 0) ?? 0))
      .catch(() => setUtangMinor(null));
  }, []);

  const countOf = (s: string) => status.find((r) => r.status === s)?.count ?? 0;
  const today = daily.length > 0 ? daily[daily.length - 1] : null;
  const awaiting = countOf("RECEIVED") + countOf("CONFIRMED");
  const outForDelivery = countOf("OUT_FOR_DELIVERY");
  const chartData = daily.map((d) => ({ label: d.date.slice(5), value: d.revenueMinor }));

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <div className="spinner-border text-primary" role="status"></div>
        <span className="ms-2 text-muted">Loading overview…</span>
      </div>
    );
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center flex-wrap mb-3">
        <div>
          <h1 className="h4 mb-0">Good day! 👋</h1>
          {storeName && <small className="text-muted">Here&apos;s how {storeName} is doing today.</small>}
        </div>
        <div className="d-flex gap-2 align-items-center">
          {storeSlug && (
            <a className="btn btn-sm btn-outline-primary" href={`/${storeSlug}`} target="_blank" rel="noreferrer">
              <i className="bi bi-box-arrow-up-right me-1"></i>Open storefront
            </a>
          )}
          <button className="btn btn-sm btn-outline-secondary" onClick={load} title="Refresh">
            <i className="bi bi-arrow-clockwise"></i>
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      <div className="row g-3 mb-3">
        <div className="col-6 col-md-3">
          <button className="btn card text-start h-100 p-3 shadow-sm" onClick={() => onNavigate("orders")}>
            <div className="small text-muted">Today&apos;s sales</div>
            <div className="h4 mb-0">{toPesos(today?.revenueMinor ?? 0)}</div>
            <small className="text-muted">{today?.count ?? 0} orders</small>
          </button>
        </div>
        <div className="col-6 col-md-3">
          <button className="btn card text-start h-100 p-3 shadow-sm" onClick={() => onNavigate("orders")}>
            <div className="small text-muted">Awaiting action</div>
            <div className={`h4 mb-0 ${awaiting > 0 ? "text-warning" : ""}`}>{awaiting}</div>
            <small className="text-muted">received + confirmed</small>
          </button>
        </div>
        <div className="col-6 col-md-3">
          <button className="btn card text-start h-100 p-3 shadow-sm" onClick={() => onNavigate("orders")}>
            <div className="small text-muted">Out for delivery</div>
            <div className={`h4 mb-0 ${outForDelivery > 0 ? "text-primary" : ""}`}>{outForDelivery}</div>
            <small className="text-muted">couriers on the road</small>
          </button>
        </div>
        <div className="col-6 col-md-3">
          <button className="btn card text-start h-100 p-3 shadow-sm" onClick={() => onNavigate("inventory")}>
            <div className="small text-muted">Low stock</div>
            <div className={`h4 mb-0 ${(lowStockCount ?? 0) > 0 ? "text-danger" : ""}`}>{lowStockCount ?? "—"}</div>
            <small className="text-muted">at or below reorder</small>
          </button>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-md-8">
          <div className="card h-100">
            <div className="card-body">
              <h6 className="card-title small fw-bold">Revenue — last 7 days</h6>
              <BarChart data={chartData} />
            </div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="card h-100">
            <div className="card-body">
              <h6 className="card-title small fw-bold">Utang owed (credit)</h6>
              {utangMinor === null ? (
                <p className="text-muted small mb-0">Not available for this role.</p>
              ) : utangMinor === 0 ? (
                <p className="text-success mb-0"><i className="bi bi-check-lg me-1"></i>No outstanding balances.</p>
              ) : (
                <div className="h4 text-danger">{toPesos(utangMinor)}</div>
              )}
              <button className="btn btn-sm btn-outline-warning mt-2" onClick={() => onNavigate("utang")}>
                <i className="bi bi-journal-text me-1"></i>Utang list
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}