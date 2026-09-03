# SAM STORE — Progress Log

Updated: 2026-09-01 (Module 1 loop 1) · Active model: `deepseek/deepseek-v4-flash-0731` (openrouter) · Budget ceiling: $100+

## Module status

| # | Module | Status | Model used | Fallback fired? | Tests | Known defects | Next task |
|---|--------|--------|-----------|-----------------|-------|---------------|-----------|
| 0 | Setup: analysis, v2 prompt, AGENTS.md, progress.md | ✅ Done | deepseek-v4-flash-0731 | No | n/a | — | — |
| 1 | Thin slice | ✅ **DONE (gate passed live)** | deepseek-v4-flash-0731 | No | **59/59 + E2E** | none known | Next: Module 2 (auth/tenancy hardening) |

## Module 1 — thin slice COMPLETE ✅

**Full gate verified live 2026-09-01:** guest opens `localhost:3000/sam-store` → browses 3 seeded products (Kape Barako, Turon, Bibingka) → adds to cart (drawer, qty +/-, localStorage) → COD checkout via Next proxy → NestJS → Prisma → Supabase Postgres → **order `SAMSTO-000002`, ₱370.00, claim token returned**. HTTP 201. Retry-safe.

**Shipped this loop:**
- `apps/web` — Next.js 15 App Router + React 19 + **Bootstrap 5.3** (no Tailwind): `[slug]/page.tsx` (server), `Storefront`, `ProductCard`, `CartDrawer` (offcanvas), `CheckoutForm`; `/api/checkout` server-side proxy
- `apps/api` — `PublicStoreController` (`GET /public/stores/:slug` → store + active products w/ available qty)
- Migration `20260903005827_cart_item_cascade` (CartItem cascade delete)
- Seed resets demo cart (delete + recreate OPEN); `.gitignore` += `*.tsbuildinfo`

**Connections:** Supabase project `yeklfbggabxydnzfyorb` (region **ap-southeast-2**, session pooler :5432, IPv4 pinned via `hostaddr` — IPv6-only direct host was unreachable; transaction pooler :6543 can't run Prisma prepared statements).

**Pushed to GitHub:** `extraricestore/samstore` @ `823d641` (main tracks origin/main).

## Module status

## Module 1 — loop 2 completed (all verified, real output)

1. **NestJS HTTP layer** — `POST /public/checkout` wired via explicit `CHECKOUT_SERVICE` DI token (class-token DI fails under NodeNext/ESM; documented). Bootstrap via `tsx src/main.ts`.
2. **Checkout orchestration** (`src/checkout/checkout.service.ts`) — validation → idempotency-first → cart/OPEN → store ACTIVE/paused → re-price → totals → min-order → store-scoped sequence → order + snapshot → claim token → cart CONVERTED.
3. **Claim-token domain** — HMAC-signed single-use tokens; token now **persisted** so an idempotent retry after a lost response returns the SAME token (was: empty string — bug found by smoke test).
4. **Real HTTP statuses** — controller now throws `HttpException` (was: 201 for everything, status only in body — bug found by smoke test).
5. **In-memory repositories** behind interfaces — Prisma implementations swap in without service changes. `SEED_DEMO=true` seeds a demo store/product/cart for local smoke tests.
6. **Live HTTP smoke test** (real curl, port 4100): 201 + order PHP 290.00 + claim token → same-key retry returns SAME order + SAME token → converted-cart 409 → invalid input 422. ✅
7. Schema gained `Order.cartToken` (binds idempotent retries to the cart — prevents claim-token leak via key reuse).

Commits: `32dce58` (loop 2).

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