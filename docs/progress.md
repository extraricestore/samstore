# SAM STORE — Progress Log

Updated: 2026-09-01 (Module 1 loop 1) · Active model: `deepseek/deepseek-v4-flash-0731` (openrouter) · Budget ceiling: $100+

## Module status

| # | Module | Status | Model used | Fallback fired? | Tests | Known defects | Next task |
|---|--------|--------|-----------|-----------------|-------|---------------|-----------|
| 0 | Setup: analysis, v2 prompt, AGENTS.md, progress.md | ✅ Done | deepseek-v4-flash-0731 | No | n/a | — | — |
| 1 | Thin slice foundations | 🚧 In progress | deepseek-v4-flash-0731 | No | **41/41 pass** | see below | NestJS wiring + migrations + storefront (blocked on DATABASE_URL) |

## Module 1 — completed this loop (all verified, real output)

1. **Monorepo** (npm workspaces): `apps/api` (NestJS — wiring next loop), `packages/contracts`, `prisma/`, `docs/`, root scripts. Commits: `3dffdb2`, `bf13c4c`.
2. **Prisma schema** — full thin-slice entity set; `store_id` on **every** store-owned table (tenancy day one). `npx prisma validate` ✅, `prisma generate` ✅. Includes roles scaffolding (`PlatformUser`, `StoreMembership`, `StoreCustomer`) per the 6-actor model.
3. **`@sam-store/contracts`** — shared DTOs, `PaymentMethod`, `OrderStatus` consts. Typecheck ✅.
4. **Domain core** (`apps/api/src/domain/`, pure functions, no DB):
   - `pricing.ts` — integer-minor-unit totals; rejects negative/fractional money, negative totals
   - `cart.ts` — revalidation (price changes applied + reported; inactive/vanished products dropped; empty cart rejected)
   - `idempotency.ts` — SHA-256 canonical checkout keys (retry-safe, no duplicate orders)
   - `tenant.ts` — `assertStoreAccess`; cross-tenant denial
   - `checkout-validation.ts` — server-side COD-only validation
   - `order-number.ts` — store-scoped human order numbers (SAMSTO-000001)
5. **41 unit tests** via `node --import tsx --test` — **41 pass, 0 fail** (one fix made: empty-cart invariant moved into domain).

## Known defects / notes

- `.env` exists with **placeholder** DATABASE_URL (gitignored) so `prisma validate/generate` can resolve — **do not run migrations against it**.
- npx 12 security gate: approved install scripts for `prisma`, `@prisma/client`, `@prisma/engines`, `esbuild` (official packages).
- Stray legacy landing page (`index.html`, `assets/`) untracked + gitignored, per module plan.
- Prisma CLI works; engine binaries downloaded after script approval.

## Blocked — needs operator input (blocking Module 1 completion)

| # | Item | Blocks |
|---|------|--------|
| B1 | **Managed Postgres connection string** (Neon/Supabase) | `prisma migrate dev`, integration tests, API runtime |
| B2 | **Managed Redis URL** (Upstash) | public-link rate limiting, sessions |
| B3 | **Region / currency / timezone / locale** | store settings defaults, money formatting, delivery rules |
| B4 | Payment gateway, object storage, domain/HTTPS | later modules only |

## Decisions locked (do not re-litigate)

- Managed cloud Postgres + Redis; no local Docker.
- Paid Primary: `deepseek/deepseek-v4-flash-0731` → `z-ai/glm-5.3-flash` → `z-ai/glm-5.2:free`.
- Messenger = adapter-only until operator supplies Facebook App + tokens + HTTPS webhook.
- Thin Slice first; Delivery Order 1–16 authoritative.
- Stack confirmed from source docs: **Next.js + NestJS + Prisma/Postgres + Redis + Bootstrap 5.3**.
- Money = integer minor units everywhere. Tenancy from first migration.

## Model / budget ledger

| When | Model | Tokens (in/out) | Cost | Note |
|------|-------|-----------------|------|------|
| 2026-09-01 earlier | deepseek-v4-flash-0731 | ~2M / ~0.2M (est.) | ~$0.25 (est.) | Setup/analysis |
| 2026-09-01 Module 1 loop 1 | deepseek-v4-flash-0731 | ~0.9M / ~0.1M (est.) | ~$0.08 (est.) | Scaffold + domain + tests |