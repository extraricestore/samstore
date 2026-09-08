"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "../../config";
import { getAdminToken, adminHeaders } from "../../lib/admin";
import { toast } from "../../lib/toast";

interface StoreSettings {
  id: string;
  name: string;
  slug: string;
  currencyCode: string;
  timezone: string;
  status: string;
  publicLink: { slug: string; token: string; status: string } | null;
  settings: {
    allowGuestOrders: boolean;
    orderingPaused: boolean;
    closedStoreMessage: string | null;
    minOrderAmountMinor: number;
    deliveryFeeMinor: number;
    deliveryEnabled: boolean;
    pickupEnabled: boolean;
    orderCutoff: string | null;
    maxOpenOrdersPerCustomer: number;
    creditLimitMinor: number;
    receiptHeader: string | null;
    receiptFooter: string | null;
    showVatLabel: boolean;
  };
}

export default function SettingsPanel() {
  const [data, setData] = useState<StoreSettings | null>(null);
  const [form, setForm] = useState({
    deliveryFeePesos: "",
    minOrderPesos: "",
    orderCutoff: "",
    closedStoreMessage: "",
    maxOpenOrders: "10",
    creditLimitPesos: "",
    receiptHeader: "",
    receiptFooter: "",
  });
  const [allowGuest, setAllowGuest] = useState(true);
  const [paused, setPaused] = useState(false);
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [pickupEnabled, setPickupEnabled] = useState(false);
  const [showVat, setShowVat] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/settings`, {
        headers: { ...adminHeaders() },
      });
      if (!res.ok) throw new Error("Failed to load settings");
      const d = (await res.json()) as StoreSettings;
      setData(d);
      setForm({
        deliveryFeePesos: (d.settings.deliveryFeeMinor / 100).toString(),
        minOrderPesos: (d.settings.minOrderAmountMinor / 100).toString(),
        orderCutoff: d.settings.orderCutoff ?? "",
        closedStoreMessage: d.settings.closedStoreMessage ?? "",
        maxOpenOrders: d.settings.maxOpenOrdersPerCustomer.toString(),
        creditLimitPesos: (d.settings.creditLimitMinor / 100).toString(),
        receiptHeader: d.settings.receiptHeader ?? "",
        receiptFooter: d.settings.receiptFooter ?? "",
      });
      setAllowGuest(d.settings.allowGuestOrders);
      setPaused(d.settings.orderingPaused);
      setDeliveryEnabled(d.settings.deliveryEnabled);
      setPickupEnabled(d.settings.pickupEnabled);
      setShowVat(d.settings.showVatLabel);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${API_URL}/admin/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({
          allowGuestOrders: allowGuest,
          orderingPaused: paused,
          deliveryEnabled,
          pickupEnabled,
          deliveryFeeMinor: Math.round(parseFloat(form.deliveryFeePesos || "0") * 100),
          minOrderAmountMinor: Math.round(parseFloat(form.minOrderPesos || "0") * 100),
          orderCutoff: form.orderCutoff || null,
          closedStoreMessage: form.closedStoreMessage || null,
          maxOpenOrdersPerCustomer: parseInt(form.maxOpenOrders, 10) || 10,
          creditLimitMinor: Math.round(parseFloat(form.creditLimitPesos || "0") * 100),
          receiptHeader: form.receiptHeader || null,
          receiptFooter: form.receiptFooter || null,
          showVatLabel: showVat,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message ?? body?.errors?.join(", ") ?? "Save failed");
        return;
      }
      setSaved(true);
            toast("Settings saved");
            await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-muted">Loading…</p>;

  // ── Account: change password + edit profile ──
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [profName, setProfName] = useState("");
    const [profEmail, setProfEmail] = useState(typeof sessionStorage !== "undefined" ? (sessionStorage.getItem("samstore.admin.email") ?? "") : "");
  const [profMsg, setProfMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [profBusy, setProfBusy] = useState(false);

  const changePw = async () => {
    if (newPw.length < 8) { setPwMsg({ ok: false, text: "New password must be at least 8 characters." }); return; }
    setPwBusy(true); setPwMsg(null);
    try {
      const res = await fetch(`${API_URL}/auth/change-password`, {
        method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ email: profEmail, currentPassword: curPw, newPassword: newPw }),
      });
      const d = await res.json();
      if (!res.ok) { setPwMsg({ ok: false, text: d?.message ?? "Change failed" }); return; }
      setPwMsg({ ok: true, text: "Password changed successfully." });
      setCurPw(""); setNewPw("");
      if (typeof d?.token === "string") sessionStorage.setItem("samstore.admin.token", d.token);
    } catch {
      setPwMsg({ ok: false, text: "Network error — could not change password." });
    } finally { setPwBusy(false); }
  };

  const saveProfile = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profEmail)) { setProfMsg({ ok: false, text: "Enter a valid email." }); return; }
    setProfBusy(true); setProfMsg(null);
    try {
      const res = await fetch(`${API_URL}/admin/auth/profile`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ email: profEmail.trim(), name: profName.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok) { setProfMsg({ ok: false, text: d?.message ?? d?.errors?.join(", ") ?? "Save failed" }); return; }
      setProfMsg({ ok: true, text: "Profile updated." });
      sessionStorage.setItem("samstore.admin.email", d.email);
    } catch {
      setProfMsg({ ok: false, text: "Network error — could not save profile." });
    } finally { setProfBusy(false); }
  };

  return (
    <div>
      <h1 className="h4 mb-3">Store Settings</h1>
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      {saved && <div className="alert alert-success py-2 small">Settings saved.</div>}

      {data && (
        <>
          <div className="card mb-4">
            <div className="card-body">
              <h6 className="card-title">{data.name} <span className="badge text-bg-secondary ms-1">{data.status}</span></h6>
              <p className="small text-muted mb-1">
                Public link: <code>/public/{data.publicLink?.slug}</code>
              </p>
              <p className="small text-muted mb-0">
                Currency <strong>{data.currencyCode}</strong> · Timezone <strong>{data.timezone}</strong>
              </p>
            </div>
          </div>

          <form onSubmit={save} className="card">
            <div className="card-body">
              <div className="row g-3">
                <div className="col-md-6">
                  <div className="form-check form-switch">
                    <input className="form-check-input" type="checkbox" id="allowGuest" checked={allowGuest} onChange={(e) => setAllowGuest(e.target.checked)} />
                    <label className="form-check-label" htmlFor="allowGuest">Allow guest orders (public link)</label>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="form-check form-switch">
                    <input className="form-check-input" type="checkbox" id="paused" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
                    <label className="form-check-label" htmlFor="paused">Pause ordering (closes the store)</label>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="form-check form-switch">
                    <input className="form-check-input" type="checkbox" id="delivery" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} />
                    <label className="form-check-label" htmlFor="delivery">Delivery enabled</label>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="form-check form-switch">
                    <input className="form-check-input" type="checkbox" id="pickup" checked={pickupEnabled} onChange={(e) => setPickupEnabled(e.target.checked)} />
                    <label className="form-check-label" htmlFor="pickup">Pickup enabled</label>
                  </div>
                </div>
                <div className="col-md-4">
                  <label className="form-label small">Delivery fee (₱)</label>
                  <input className="form-control" type="number" step="0.01" min="0" value={form.deliveryFeePesos} onChange={(e) => setForm({ ...form, deliveryFeePesos: e.target.value })} />
                </div>
                <div className="col-md-4">
                  <label className="form-label small">Min order (₱)</label>
                  <input className="form-control" type="number" step="0.01" min="0" value={form.minOrderPesos} onChange={(e) => setForm({ ...form, minOrderPesos: e.target.value })} />
                </div>
                <div className="col-md-4">
                  <label className="form-label small">Order cutoff (HH:MM)</label>
                  <input className="form-control" type="time" value={form.orderCutoff} onChange={(e) => setForm({ ...form, orderCutoff: e.target.value })} />
                </div>
                <div className="col-md-4">
                  <label className="form-label small">Max open orders / customer</label>
                  <input className="form-control" type="number" min="1" value={form.maxOpenOrders} onChange={(e) => setForm({ ...form, maxOpenOrders: e.target.value })} />
                </div>
                <div className="col-md-8">
                                  <label className="form-label small">Closed-store message</label>
                                  <input className="form-control" value={form.closedStoreMessage} onChange={(e) => setForm({ ...form, closedStoreMessage: e.target.value })} placeholder="We're taking a break — back soon!" />
                                </div>
                              </div>

                              <hr className="my-3" />
                              <h6 className="fw-bold">POS / Receipt settings</h6>
                              <div className="row g-3 mt-1">
                                <div className="col-md-4">
                                  <label className="form-label small">Default utang credit limit (₱)</label>
                                  <input className="form-control" type="number" step="0.01" min="0" value={form.creditLimitPesos} onChange={(e) => setForm({ ...form, creditLimitPesos: e.target.value })} placeholder="0 = credit disabled" />
                                </div>
                                <div className="col-md-8">
                                  <div className="form-check form-switch">
                                    <input className="form-check-input" type="checkbox" id="vat" checked={showVat} onChange={(e) => setShowVat(e.target.checked)} />
                                    <label className="form-check-label" htmlFor="vat">Show VAT display-only label on receipts ("Prices VAT-inclusive, 12%")</label>
                                  </div>
                                </div>
                                <div className="col-md-6">
                                  <label className="form-label small">Receipt header text</label>
                                  <input className="form-control" value={form.receiptHeader} onChange={(e) => setForm({ ...form, receiptHeader: e.target.value })} placeholder="e.g. Salamat po! / Store address & phone" />
                                </div>
                                <div className="col-md-6">
                                  <label className="form-label small">Receipt footer text</label>
                                  <input className="form-control" value={form.receiptFooter} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} placeholder="e.g. No returns after 3 days" />
                                </div>
                              </div>

                              <button className="btn btn-primary mt-3" type="submit" disabled={saving}>
                                              {saving ? "Saving…" : "Save settings"}
                                            </button>
                                          </div>
                                        </form>

                                        {/* Account: edit profile + change password */}
                                        <div className="card mb-4">
                                          <div className="card-body">
                                            <h6 className="fw-bold"><i className="bi bi-person me-2"></i>My profile</h6>
                                            <label className="form-label small">Name</label>
                                            <input className="form-control" value={profName} onChange={(e) => setProfName(e.target.value)} placeholder="Your name" />
                                            <label className="form-label small mt-2">Email</label>
                                            <input className="form-control" type="email" value={profEmail} onChange={(e) => setProfEmail(e.target.value)} placeholder="you@store.com" />
                                            {profMsg && <div className={`alert ${profMsg.ok ? "alert-success" : "alert-danger"} py-2 small mt-2`}>{profMsg.text}</div>}
                                            <button className="btn btn-outline-primary mt-2" disabled={profBusy} onClick={saveProfile}>
                                              {profBusy ? "Saving…" : "Save profile"}
                                            </button>
                                          </div>
                                        </div>

                                        <div className="card mb-4">
                                          <div className="card-body">
                                            <h6 className="fw-bold"><i className="bi bi-shield-lock me-2"></i>Change password</h6>
                                            <label className="form-label small">Current password</label>
                                            <input className="form-control" type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
                                            <label className="form-label small mt-2">New password (min 8 characters)</label>
                                            <input className="form-control" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                                            {pwMsg && <div className={`alert ${pwMsg.ok ? "alert-success" : "alert-danger"} py-2 small mt-2`}>{pwMsg.text}</div>}
                                            <button className="btn btn-outline-secondary mt-2" disabled={pwBusy} onClick={changePw}>
                                              {pwBusy ? "Changing…" : "Change password"}
                                            </button>
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                );
}