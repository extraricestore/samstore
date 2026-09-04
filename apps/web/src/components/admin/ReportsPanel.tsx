"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";

interface ProfitData {
  revenueMinor: number; refundsMinor: number; netRevenueMinor: number;
  cogsMinor: number; cogsEstimatedUnits: number; expensesMinor: number;
  profitMinor: number; ordersCount: number; cogsNote: string;
}
interface SalesData {
  paymentSplit: { method: string; totalMinor: number }[];
  topCustomers: { name: string; totalMinor: number; orders: number }[];
  utangAging: { currentMinor: number; over30Minor: number; rows: { name: string; balanceMinor: number; daysOld: number; bucket: string }[] };
}

const toPesos = (m: number) => `₱${(m / 100).toFixed(2)}`;

export default function ReportsPanel() {
  const [days, setDays] = useState(30);
  const [profit, setProfit] = useState<ProfitData | null>(null);
  const [sales, setSales] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    q.set("days", String(days));
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    q.delete("days");
    q.append("from", from.toISOString());
    q.append("to", to.toISOString());
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`${API_URL}/admin/reports/profit?${q.toString()}`, { headers: adminHeaders() }),
        fetch(`${API_URL}/admin/reports/sales?${q.toString()}`, { headers: adminHeaders() }),
      ]);
      if (!pRes.ok) {
        const d = await pRes.json();
        setError(d?.message ?? "Profit report unavailable (owner/manager only)");
      } else {
        setProfit(await pRes.json());
      }
      if (sRes.ok) setSales(await sRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const exportProfit = () => window.open(`${API_URL}/admin/reports/profit.csv?days=${days}`, "_blank");
  const print = () => window.print();

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0"><i className="bi bi-graph-up me-2"></i>Reports</h1>
        <div className="d-flex gap-2">
          <select className="form-select form-select-sm" style={{ width: 130 }} value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button className="btn btn-outline-secondary btn-sm" onClick={exportProfit}><i className="bi bi-filetype-csv me-1"></i>CSV</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={print}><i className="bi bi-printer me-1"></i>Print</button>
        </div>
      </div>
      {error && <div className="alert alert-warning py-2 small">{error}</div>}
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          {profit && (
            <div className="row g-3 mb-3">
              <div className="col-6 col-md-3">
                <div className="card h-100"><div className="card-body text-center">
                  <div className="small text-muted">Revenue (fulfilled)</div>
                  <div className="h4 mb-0">{toPesos(profit.netRevenueMinor)}</div>
                  <div className="small text-muted">{profit.ordersCount} orders{profit.refundsMinor > 0 ? ` · refunds ${toPesos(profit.refundsMinor)}` : ""}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className="card h-100"><div className="card-body text-center">
                  <div className="small text-muted">COGS (estimate)</div>
                  <div className="h4 mb-0">{toPesos(profit.cogsMinor)}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className="card h-100"><div className="card-body text-center">
                  <div className="small text-muted">Expenses</div>
                  <div className="h4 mb-0">{toPesos(profit.expensesMinor)}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className={`card h-100 ${profit.profitMinor < 0 ? "border-danger" : ""}`}><div className="card-body text-center">
                  <div className="small text-muted">Profit (estimate)</div>
                  <div className={`h4 mb-0 ${profit.profitMinor < 0 ? "text-danger" : "text-success"}`}>{toPesos(profit.profitMinor)}</div>
                </div></div>
              </div>
              <div className="col-12">
                <p className="small text-muted mb-0"><i className="bi bi-info-circle me-1"></i>{profit.cogsNote}</p>
              </div>
            </div>
          )}

          {sales && (
            <div className="row g-3">
              <div className="col-md-4">
                <div className="card h-100"><div className="card-body">
                  <h6 className="card-title small fw-bold">Payment split</h6>
                  {sales.paymentSplit.length === 0 ? (
                    <p className="text-muted small">No fulfilled orders in this period.</p>
                  ) : (
                    <table className="table table-sm mb-0">
                      <tbody>
                        {sales.paymentSplit.map((s) => (
                          <tr key={s.method}>
                            <td className="text-capitalize">{s.method}</td>
                            <td className="text-end">{toPesos(s.totalMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div></div>
              </div>
              <div className="col-md-4">
                <div className="card h-100"><div className="card-body">
                  <h6 className="card-title small fw-bold">Utang aging</h6>
                  <div className="small">
                    <div className="d-flex justify-content-between"><span>Current (&le;30d)</span><span>{toPesos(sales.utangAging.currentMinor)}</span></div>
                    <div className="d-flex justify-content-between text-danger"><span>Over 30 days</span><span>{toPesos(sales.utangAging.over30Minor)}</span></div>
                  </div>
                  <ul className="small text-muted mb-0 mt-2">
                    {sales.utangAging.rows.slice(0, 5).map((r) => (
                      <li key={r.name}>{r.name} — {toPesos(r.balanceMinor)} ({r.daysOld}d)</li>
                    ))}
                    {sales.utangAging.rows.length === 0 && <li>No outstanding balances.</li>}
                  </ul>
                </div></div>
              </div>
              <div className="col-md-4">
                <div className="card h-100"><div className="card-body">
                  <h6 className="card-title small fw-bold">Top customers</h6>
                  {sales.topCustomers.length === 0 ? (
                    <p className="text-muted small">No data.</p>
                  ) : (
                    <table className="table table-sm mb-0">
                      <tbody>
                        {sales.topCustomers.slice(0, 5).map((c) => (
                          <tr key={c.name}>
                            <td>{c.name}</td>
                            <td className="text-end">{toPesos(c.totalMinor)}</td>
                            <td className="text-end text-muted small">{c.orders} orders</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}