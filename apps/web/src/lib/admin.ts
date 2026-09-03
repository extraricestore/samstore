// Admin helpers — calls the protected admin API.
import { API_URL } from "../config";

/** Active store id from the session (set by the store switcher). */
export function getAdminStoreId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("samstore.admin.storeId");
}

export function setAdminStoreId(storeId: string) {
  try { sessionStorage.setItem("samstore.admin.storeId", storeId); } catch { /* ignore */ }
}

/** Auth + tenant headers for admin API calls. */
export function adminHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${getAdminToken()}` };
  const storeId = getAdminStoreId();
  if (storeId) headers["X-Store-Id"] = storeId;
  return headers;
}

export interface AdminOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalMinor: number;
  currencyCode: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
}

/** Loads the admin token from session storage (client-side only). */
export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("samstore.admin.token");
}

/** Fetches orders for the admin dashboard (demo: reads from API; auth via token). */
export async function fetchAdminOrders(token: string): Promise<AdminOrder[]> {
  const res = await fetch(`${API_URL}/admin/orders`, {
    headers: adminHeaders(),
  });
  if (!res.ok) throw new Error("Failed to load orders: " + res.status);
  const data = await res.json();
  return (data.orders ?? []).map((o: any) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    totalMinor: o.totalMinor,
    currencyCode: o.currencyCode,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    createdAt: o.createdAt,
  }));
}