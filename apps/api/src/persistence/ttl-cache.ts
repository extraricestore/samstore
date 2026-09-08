// Tiny per-process TTL cache for read-mostly admin reads.
// Why: the app's Postgres is a remote managed instance (Supabase pooler) — every
// query costs ~100–300 ms of network RTT, so panels stacking several queries
// (products + stock, settings, customers, ledger list) take 1–2 s to load.
// Read-mostly catalog data is cached briefly (TTL 10–60 s) and invalidated on
// writes. NEVER wrap money-mutating reads (order lists, holds, balancing) —
// those stay uncached for correctness.
//
// Keys are store-scoped (tenancy: store A can never read store B's cache).

const store = new Map<string, { expiresAt: number; value: unknown }>();
const DEFAULT_TTL_MS = 10_000;

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

/** Caches `value` under `key` for `ttlMs` (default 10s). */
export function cacheSet(key: string, value: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
  store.set(key, { expiresAt: Date.now() + ttlMs, value });
}

/** Removes every cached entry whose key starts with `prefix` (e.g. "products", "customers"). */
export function cacheBust(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/** Builds a namespaced key: `${part[0]}:${part[1]}:...` — always start with the entry kind. */
export function cacheKey(...parts: string[]): string {
  return parts.join(":");
}