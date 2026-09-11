// Shared helpers for the critical-path E2E suite.
import { APIRequestContext } from "@playwright/test";

export const API = "http://localhost:4100";
export const ADMIN_EMAIL = "admin@samstore.test";
export const ADMIN_PASSWORD = "admin-pass-123"; // seeded demo credential (prisma/seed.ts)

/** POST /auth/login → returns { token, ... } */
export async function apiLogin(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (res.status() < 200 || res.status() >= 300) {
      throw new Error(`login failed: HTTP ${res.status()} ${(await res.text()).slice(0, 200)}`);
    }
  const body = await res.json();
  const token = body.token ?? body.value?.token ?? body.data?.token;
  if (!token) throw new Error(`login response had no token: ${JSON.stringify(body).slice(0, 200)}`);
  return token;
}

export interface PublicLink {
  slug: string;
  token: string;
  status: string;
}

/** GET /admin/settings with tenant headers → public link (slug + token). */
export async function fetchPublicLink(request: APIRequestContext): Promise<PublicLink> {
  const token = await apiLogin(request);
  const res = await request.get(`${API}/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status() !== 200) throw new Error(`settings failed: HTTP ${res.status()}`);
  const body = await res.json();
  const link = body?.publicLink ?? body?.value?.publicLink;
  if (!link) throw new Error(`settings had no publicLink: ${JSON.stringify(body).slice(0, 200)}`);
  return link as PublicLink;
}

export async function apiJson<T>(request: APIRequestContext, path: string, init?: Parameters<APIRequestContext["get"]>[1]): Promise<{ status: number; body: T }> {
  const res = await request.get(`${API}${path}`, init);
  return { status: res.status(), body: (await res.json()) as T };
}