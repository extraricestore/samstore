// Lightweight in-process rate limiter for the PUBLIC/auth surface (Module 2).
// No external dependency: a per-key sliding window Map, store-scoped where a
// store is known, keyed by IP otherwise. This protects registration, login,
// checkout, cart mutation, public store lookup, and claim endpoints from
// brute-force / abuse until a managed Redis limiter is deployed.
//
// IMPORTANT: this is a per-process limiter — with multiple API instances the
// effective limit is per instance. It is intentionally NOT applied to the admin
// surface (staff dashboards are few users on a trusted network) beyond auth.

export interface RateLimitOptions {
  /** Max requests allowed in `windowMs`. */
  limit: number;
  windowMs: number;
  /** Optional key prefix so different route groups get independent budgets. */
  prefix: string;
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export function resetRateLimitersForTest(): void {
  buckets.clear();
}

/**
 * Returns true when the request is allowed, false when it exceeds the budget.
 */
export function rateLimitOk(key: string, opts: RateLimitOptions): boolean {
  const now = Date.now();
  const fullKey = `${opts.prefix}:${key}`;
  let b = buckets.get(fullKey);
  if (!b || now >= b.resetAt) {
    b = { count: 1, resetAt: now + opts.windowMs };
    buckets.set(fullKey, b);
    return true;
  }
  b.count += 1;
  if (b.count > opts.limit) {
    return false;
  }
  return true;
}

/** Build a request key from IP + (when present) store slug/token. */
export function clientKey(ip: string | undefined, extra?: string): string {
  const base = ip ?? "unknown";
  return extra ? `${base}:${extra}` : base;
}
