"use client";

import { useEffect, useState } from "react";
import { API_URL } from "../../config";
import { adminHeaders } from "../../lib/admin";

// Printable receipt view (browser print). VAT display-only label per decision #2.

interface ReceiptData {
  orderNumber: string;
  status: string;
  source: string;
  storeName: string;
  currencyCode: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string;
  createdAt: string;
  items: { productName: string; sku: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number }[];
  payments: { id: string; method: string; amountMinor: number; changeMinor: number; type: string; note: string | null; receivedAt: string }[];
}

function useReceipt(orderId: string) {
  const [data, setData] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ receiptHeader?: string | null; receiptFooter?: string | null; showVatLabel?: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/admin/settings`, { headers: adminHeaders() })
      .then((r) => r.json())
      .then((d) => { if (alive) setSettings(d?.settings ?? null); })
      .catch(() => {});
    fetch(`${API_URL}/admin/orders/${orderId}/receipt`, { headers: adminHeaders() })
      .then((r) => r.json())
      .then((d) => { if (alive) { if (d?.orderNumber) setData(d); else setError(d?.message ?? "Load failed"); } })
      .catch(() => alive && setError("Network error"));
    return () => { alive = false; };
  }, [orderId]);
  return { data, error, settings };
}

export default function ReceiptModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { data, error, settings } = useReceipt(orderId);
  const pesos = (m: number) => `₱${(m / 100).toFixed(2)}`;
  const showVat = settings?.showVatLabel ?? true;

  return (
    <>
      <div className="modal fade show d-block" tabIndex={-1}>
        <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 420 }}>
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title"><i className="bi bi-receipt me-1"></i>Receipt</h5>
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger py-2 small">{error}</div>}
              {!data && !error && <p className="text-muted small">Loading…</p>}
              {data && (
                <div className="receipt-print">
                  {settings?.receiptHeader && (
                    <div className="text-center small text-muted mb-1">{settings.receiptHeader}</div>
                  )}
                  <div className="text-center mb-2">
                    <div className="fw-bold">{data.storeName}</div>
                    <div className="small text-muted">Order {data.orderNumber}</div>
                    <div className="small text-muted">{new Date(data.createdAt).toLocaleString()}</div>
                  </div>
                  <table className="table table-sm small mb-2">
                    <thead><tr><th>Item</th><th className="text-end">Qty</th><th className="text-end">Amount</th></tr></thead>
                    <tbody>
                      {data.items.map((i, idx) => (
                        <tr key={idx}>
                          <td>{i.productName}</td>
                          <td className="text-end">{i.quantity}</td>
                          <td className="text-end">{pesos(i.lineTotalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="small">
                    <div className="d-flex justify-content-between"><span>Subtotal</span><span>{pesos(data.subtotalMinor)}</span></div>
                    {data.deliveryFeeMinor > 0 && (
                      <div className="d-flex justify-content-between"><span>Delivery</span><span>{pesos(data.deliveryFeeMinor)}</span></div>
                    )}
                    {data.discountMinor > 0 && (
                      <div className="d-flex justify-content-between text-danger"><span>Discount</span><span>-{pesos(data.discountMinor)}</span></div>
                    )}
                    <div className="d-flex justify-content-between fw-bold"><span>TOTAL</span><span>{pesos(data.totalMinor)}</span></div>
                    {showVat && <div className="text-muted mt-1">Prices VAT-inclusive (12%)</div>}
                    <hr className="my-2" />
                    <div className="text-muted">Payment: {data.paymentMethod} · {data.paymentStatus}</div>
                    {data.payments.map((p) => (
                      <div key={p.id} className="text-muted">
                        {p.type === "refund" && <span className="text-danger">Refund </span>}
                        {p.type === "void" && <span className="text-warning">Void </span>}
                        {p.type !== "refund" && p.type !== "void" && `${p.method}: `}
                        {p.amountMinor !== 0 && pesos(p.amountMinor)}
                        {p.changeMinor > 0 && <span> · change {pesos(p.changeMinor)}</span>}
                        {p.note && <span className="small"> ({p.note})</span>}
                      </div>
                    ))}
                  </div>
                  {settings?.receiptFooter && (
                    <div className="text-center small text-muted mt-2">{settings.receiptFooter}</div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={onClose}>Close</button>
              <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print</button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" onClick={onClose}></div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .receipt-print, .receipt-print * { visibility: visible; }
          .receipt-print { position: absolute; inset: 0; }
        }
      `}</style>
    </>
  );
}