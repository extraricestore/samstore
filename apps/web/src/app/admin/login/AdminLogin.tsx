"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "../../../config";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? "Login failed");
        return;
      }
      // Store token for subsequent API calls (demo: sessionStorage).
      sessionStorage.setItem("samstore.admin.token", data.token);
      // P12: DELIVERY role → courier app; everyone else → dashboard.
      let role = "";
      try {
        const payload = JSON.parse(atob(data.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        role = payload.role ?? "";
      } catch { /* token parse failed — fall through to dashboard */ }
      router.push(role === "DELIVERY" ? "/admin/delivery" : "/admin/dashboard");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login">
      <div className="container d-flex align-items-center justify-content-center" style={{ minHeight: "100vh" }}>
        <div className="card shadow-sm p-4" style={{ width: "100%", maxWidth: 420 }}>
          <div className="text-center mb-4">
            <i className="bi bi-shop fs-1 text-primary"></i>
            <h4 className="mt-2 mb-0">Sam&apos;s Admin</h4>
            <p className="text-muted small">Sign in to manage your store</p>
          </div>
          {error && <div className="alert alert-danger py-2 small">{error}</div>}

          <div className="alert alert-light border small mb-3">
            <div className="fw-semibold small mb-1"><i className="bi bi-info-circle me-1"></i>Demo accounts — tap to fill</div>
            <div className="d-flex flex-wrap gap-1">
              {(  [
                ["Owner", "admin@samstore.test", "admin-pass-123"],
                ["Manager", "manager@samstore.test", "manager-pass-123"],
                ["Staff", "staff@samstore.test", "staff-pass-123"],
                ["Agent", "agent@samstore.test", "agent-pass-123"],
                ["Delivery", "delivery@samstore.test", "delivery-pass-123"],
              ] as [string, string, string][]).map(([label, em, pw]) => (
                <button
                  key={em}
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => { setEmail(em); setPassword(pw); }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-muted small mt-1">Passwords shown for local demo only.</div>
          </div>

          <form onSubmit={login}>
            <div className="mb-3">
              <label className="form-label small">Email</label>
              <input
                className="form-control"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@store.com"
              />
            </div>
            <div className="mb-3">
              <label className="form-label small">Password</label>
              <input
                className="form-control"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <button className="btn btn-primary w-100" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <hr className="my-4" />
          <p className="text-muted small mb-0 text-center">
            Don&apos;t have an account?{" "}
            <a href="/admin/register">Register a store owner</a>
          </p>
        </div>
      </div>
    </div>
  );
}