"use client";

import { useEffect, useState } from "react";
import { API_URL } from "../config";

// Minimal customer account panel: register / login (email+password).
// Stores the customer JWT in localStorage so checkout can link orders + loyalty.

const TOKEN_KEY = "samstore.customer.token";

export function getCustomerToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearCustomerToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export function CustomerAccount() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loggedIn, setLoggedIn] = useState<string | null>(null);

  // Hydrate from a saved session on mount.
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
      setLoggedIn(payload.email ?? "customer");
    } catch {
      setLoggedIn("customer");
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/customer/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "register" ? { email, password, name } : { email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.errors?.join(", ") ?? data?.message ?? "Failed");
        return;
      }
      localStorage.setItem(TOKEN_KEY, data.token);
      setLoggedIn(data.customer?.email ?? email);
      setError(null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    clearCustomerToken();
    setLoggedIn(null);
  };

  if (loggedIn) {
    return (
      <div className="card card-body py-3 small">
        <div className="d-flex justify-content-between align-items-center">
          <span><i className="bi bi-person-check me-1 text-success"></i>Signed in as <strong>{loggedIn}</strong></span>
          <button className="btn btn-sm btn-outline-secondary" onClick={logout}>Log out</button>
        </div>
        <p className="text-muted mb-0 mt-2">Earn <strong>1 point per ₱1</strong> on delivered orders. Redeem 100 pts = ₱1 off.</p>
      </div>
    );
  }

  return (
    <div className="card card-body py-3">
      <ul className="nav nav-tabs mb-2">
        <li className="nav-item"><button className={`nav-link small ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>Log in</button></li>
        <li className="nav-item"><button className={`nav-link small ${mode === "register" ? "active" : ""}`} onClick={() => setMode("register")}>Register</button></li>
      </ul>
      <form onSubmit={submit}>
        {mode === "register" && (
          <div className="mb-2">
            <input className="form-control form-control-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="mb-2">
          <input className="form-control form-control-sm" type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="mb-2">
          <input className="form-control form-control-sm" type="password" placeholder="Password (min 8)" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="alert alert-danger py-1 small mb-2">{error}</div>}
        <button className="btn btn-primary btn-sm w-100" type="submit" disabled={loading}>
          {loading ? "…" : mode === "login" ? "Log in" : "Create account"}
        </button>
        <p className="text-muted mb-0 mt-2">Accounts earn loyalty points on delivered orders.</p>
      </form>
    </div>
  );
}