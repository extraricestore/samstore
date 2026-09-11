# SAM STORE — Progress Log

Updated: 2026-09-11 · **Project hardening Modules 1–11 ALL COMPLETE** · Active model: `deepseek/deepseek-v4-flash-0731` (openrouter)

## Project hardening — Modules 5–11 (run together, all ✅, pushed)

| Mod | Summary | Commit |
|---|---|---|
| **M5 atomic checkout** | `OrderRepository.createAtomic` — order+items+history+claim+stock RESERVE+cart CONVERTED+voucher+loyalty+credit in ONE transaction; checkout now actually reserves stock; concurrent same-key → P2002 → same order returned | `5d20eac` |
| **M6 voucher/loyalty/credit concurrency** | Guarded single-statement UPDATEs (voucher `usedCount`, loyalty balance, credit limit) — no cross-transaction locks (pooler-safe); over-limit → clean conflict; `CreditService.recordPurchase` idempotent | `e2b2069` |
| **M7 void/refund hardening** | Double-void rejected (stock restored once); one refund per order; refunds capped at remaining captured | `7f31ef4` |
| **M8 unified fulfillment** | All delivery checks read the explicit `fulfillmentType` (single `isDeliveryOrder`); admin list/fulfillment facet filter on the enum | `0e68b4b` |
| **M9 outbox worker** | `OutboxWorker` drains PENDING → PROCESSED (order.received → NotificationLog) with retries/backoff/FAILED; checkout enqueues after commit; started in main.ts | `301d135` |
| **M10 a11y** | Pay/Delivery modals: `role=dialog`+`aria-modal`+`aria-labelledby`+labeled close; Escape closes any open modal | `7be4ab2` |
| **M11 ops** | `/health` + `/health/ready`; `scripts/reconcile-stock.ts` (dry-run + `--apply`); `docs/runbooks.md` | `ecc8ef2` |

## Project hardening — Module 4: stock reservation & movement engine

| Item | Status |
|---|---|
| New `domain/movements.ts` — `deductStock`/`restoreStock`/`recordMovement` helpers: every stock-level change records an append-only **StockMovement** row (delta sign, type, order link, actor, `balanceAfter`) inside the same transaction | ✅ |
| Wired into ALL stock mutations: POS sell/hold/preorder/complete (CONSUME), hold-void/cancel (RELEASE), item-edit delta (RELEASE+CONSUME), payments void (VOID_RESTORE), purchases receiving (RECEIPT), warehouse setStock + product-edit stock (ADJUST), transfer complete (TRANSFER_OUT/IN) | ✅ |
| Ledger invariant tests: signs, balanceAfter, `initial + Σdelta == current onHand` reconciliation | ✅ |
| POS/payments test cleanup updated for the new StockMovement FK (delete movements before product) | ✅ |

## Project hardening — Module 3: database integrity foundation

| Item | Status |
|---|---|
| **Tenant-consistent composite FKs** — `@@unique([storeId,id])` on Order/Product/Purchase/StoreCustomer/Voucher/StockLevel + composite `(storeId, parentId)` FKs on OrderItem, OrderStatusHistory, OrderClaimToken, ProductImage, StockLevel, CartItem, PurchaseItem, LoyaltyEntry→StoreCustomer, CreditEntry→StoreCustomer, VoucherRedemption→Voucher | ✅ migration `20260911033617_module3_integrity_foundation` |
| **Pre-migration reconciliation** — 12 cross-tenant mismatch checks all `0` before tightening; backfill verified after (105 orders, 0 violations) | ✅ |
| **Explicit fulfillment** — new `Order.fulfillmentType` enum (PICKUP/DELIVERY), backfilled from the address signal; written at checkout (by deliveryType), POS creation (PICKUP), delivery conversion (DELIVERY) | ✅ |
| **`StockMovement`** model (append-only stock movement ledger: RESERVE/RELEASE/CONSUME/ADJUST/RECEIPT/TRANSFER, balanceAfter, order ref) — schema support for Module 4 | ✅ |
| **`OutboxEvent`** model (transactional outbox: PENDING/PROCESSED/FAILED, attempts, nextAttemptAt, payload) — schema support for Module 9 | ✅ |
| Composite-FK test proves a cross-tenant child insert now fails (P2003) | ✅ |

Known remaining gap (documented): nullable-parent refs (Payment.orderId, VoucherRedemption.orderId, LoyaltyEntry.orderId, CreditEntry.orderId, OrderItem.productId) keep single-column FKs — raw composite constraints would trigger Prisma drift-detection on future `migrate dev`, so they were intentionally not added; covered by app-level tenant scoping until a drift-free approach exists.

## Project hardening — Module 2: public access & API edge security

| Item | Status |
|---|---|
| **Public store link now requires slug + high-entropy token** (new `public/public-store.service.ts`); missing/wrong/revoked token → 404 (no slug/token enumeration) | ✅ |
| Storefront passes `?token=` (`[slug]/page.tsx`); Store Link panel builds tokenized links/QR, adds **Regenerate link** + **Revoke link** (owner/manager), revoked banner | ✅ |
| New `POST /admin/store-link/rotate` + `/revoke` (MANAGE) → `rotateStoreLinkToken`/`revokeStoreLink` (token rotation marks `rotatedAt` + reactivates; revoke marks `REVOKED`+`revokedAt`) | ✅ |
| **Claim-token consumption is atomic** — conditional `updateMany WHERE usedAt IS NULL`; concurrent claims → exactly one success, one conflict (concurrency test) | ✅ |
| Edge middleware in `main.ts`: prod config validation (fail boot w/o strong `JWT_SECRET`/`CLAIM_SIGNING_SECRET`/`DATABASE_URL`), `5mb` body cap, security headers, `enableShutdownHooks`, **rate limiting** on public/auth surface (`security/rate-limit.ts`, in-process, no new deps) | ✅ |

Tests: `public-store.service.test.ts` (5) + `order-lookup.service.test.ts` (3, incl. concurrent single-use).

## Project hardening — Module 1: tenant authorization & registration closure (✅, 210 tests)

| Item | Status |
|---|---|
| Public `/auth/register` no longer accepts `storeId` or `role` — creates a bare `STORE_OWNER` user with **no** membership and no `storeId` JWT claim (defense-in-depth test included) | ✅ |
| **Demo-store fallback removed** — no active membership ⇒ **403 denied** (was: silently routed to `cmtifdks2000094ic1j9w8th7`) | ✅ |
| New `apps/api/src/auth/tenant-context.ts` — `resolveTenant()`: per-store ACTIVE membership role is the authorization source (not the global JWT role); platform admin is an explicit bypass requiring a store target; inbound `X-Store-Id` must be an ACTIVE membership | ✅ |
| Migrated **8 controllers** to `resolveTenant` (`admin`, `payments`, `credit`, `pos`, `expenses`, `inventory`, `purchases`, `reports`, `delivery`) — removed 9 duplicated per-controller `resolveStore`/`DEMO_STORE_ID` blocks + global `ADMIN_ROLES`/`MANAGE_ROLES` consts | ✅ |
| Order transitions & customer-approval audit now record the **membership role** (`ctx.role`), not the global token role | ✅ |
| Owner onboarding = invite/admin-created only (operator decision 2026-09-11) | ✅ |
| Gate fix: new `scripts/run-tests.mjs` runs test files **sequentially** — node `--test` ran ~20 DB files concurrently and saturated the Supabase pooler (`pool_size: 15`, `FATAL: max clients reached`); now deterministic 210/210 | ✅ |

Live probes (all passed): register with smuggled `storeId`+`role:"PLATFORM_ADMIN"` → 201 with role `STORE_OWNER`, no store claim; `/admin/me` → storeId null; `/admin/stores/mine` → 0 stores; `/admin/orders` with demo-store header → **403**; without header → **403**.

## UI/UX upgrade — Modules U1–U8 (all ✅)
| # | Module | Status |
|---|--------|--------|
| U1 | Admin shell: grouped left sidebar (Sell/Manage/Store/System) + mobile drawer, user menu, no-reload store switch | ✅ (`7faa52a`) |
| U2 | Role-scoped nav — NAV_BY_ROLE from LIVE permission probes; tabs exactly match backend (staff/agent no more 403 dead-ends); roleCan write/voidRefund/profit gates | ✅ (`7faa52a`) |
| U3 | Overview KPI landing (today's sales, awaiting, out-for-delivery, low stock, utang + 7d chart) — default tab | ✅ (`7faa52a`) |
| U4 | Storefront search + category chips + sold-out states | ✅ (`a94cf02`) |
| U5 | 3-step checkout (Contact/Review/Pay), Delivery/Pickup toggle (Order.deliveryType; pickup = no fee/no address), Pay-on-credit for approved, Tracking-card success (auto-load + copy/share) | ✅ (`a94cf02`, E2E: pickup 12000/pickup, credit→utang 17000) |
| U6 | Customer account dashboard: GET /auth/customer/me (loyalty/credit/orders), My orders + track, saved-contact prefill; FIX: courier DELIVERED now awards loyalty (+170 pts verified) | ✅ (`54ddc3e`) |
| U7 | Courier app: logout, tel:/maps deep links, items summary, schedule sorting, Recent section (GET /delivery/recent) | ✅ (`44dc144`) |
| U8 | Consistency: toasts (POS/orders/expenses/purchases/settings/utang), confirm-before-delete, table-responsive, order-detail modal, demo-login quick-fill panel | ✅ (`c2e2483`) |

## Orders workflow — Modules W1–W3 (all ✅, 150 tests)
| # | Module | Status |
|---|--------|--------|
| W1 | Backend: PATCH /admin/orders/:id/items (stock-delta edit RECEIVED/CONFIRMED/ON_HOLD), POST send-for-delivery (one-tap → OUT_FOR_DELIVERY, delivery only), POST complete-now (pickup → COMPLETED; delivery 409) | ✅ (`d66d56e`, E2E) |
| W2 | Orders tabs: Pending=RECEIVED · On Process=CONFIRMED/PREPARING/READY/ON_HOLD · **For Delivery**=OUT_FOR_DELIVERY · Completed · Void; per-row delivery/pickup analysis + routing actions; Edit for pending | ✅ (`6cf2ab3`) |
| W3 | Full workflow E2E: pending→confirm→on process→for delivery, pickup→complete-now, stock-delta edit (all live) | ✅ (this commit) |

## Peddlr upgrade — Modules P1–P12 (all ✅, 148 tests)

| # | Module | Status | Tests + E2E |
|---|--------|--------|-------------|
| P1 | POS counter sales (cash/credit, COMPLETED status, Order.source, atomic stock) | ✅ | 126 + live E2E |
| P2 | Payments, receipts, voids & refunds (Payment table, printable receipt w/ VAT label) | ✅ | 131 + live E2E |
| P3 | Credit (utang) ledger (approve, limits, POS+online credit, settle, Utang panel) | ✅ | 136 + live E2E |
| P4 | Expenses (6 categories, CRUD, feeds reports) | ✅ | 143 + live E2E |
| P5 | Purchases & replenishment (adds stock, updates cost, low-stock one-tap) | ✅ | 143 + live E2E |
| P6 | Inventory upgrade (legacy warehouse-less stock migrated, filters + value at cost) | ✅ | 144 + live E2E |
| P7 | Product list upgrade (search/SKU/category/price/status filters + sort) | ✅ | 144 + live E2E |
| P8 | Store link upgrade (accent/banner/share/logo, QR + copy-link, storefront branding) | ✅ | 144 + live E2E |
| P9 | Customer list upgrade (search/filter, profile modal, CSV export) | ✅ | 144 + live E2E |
| P10 | Reports (profit summary w/ honest COGS, payment split, utang aging, CSV; decision #9 role gate) | ✅ | 146 + live E2E |
| P11 | POS settings (receipt header/footer, VAT toggle, default utang limit) | ✅ | 146 + live E2E |
| P12 | DELIVERY role (courier app, sees all OUT_FOR_DELIVERY, mark delivered/failed) | ✅ | 148 + live E2E |

Pipeline: `70bc211` (P1) → `b0d4f07` (P2+P3) → `9a741b5` (P4+P5) → `1fdfdfe` (P6) → `624b4b1` (P7) → `80e66b1` (P8) → `ee63e06` (P9) → `080ebce` (P10) → `6fe8617` (P11) → P12 (this commit). All modules verified with real typecheck / test / live-E2E output.

## Peddlr upgrade — notes from the build
- **Legacy stock migration (decision #8)**: warehouse-less StockLevel rows moved into each store's default warehouse; verified before (Sam's 4 rows/142, Store Two 1 row/10) and after (0 warehouse-less, totals preserved 253/10).
- **Decision #9 enforced server-side**: `/admin/reports/profit` → OWNER+MANAGER only (staff verified 403); `/admin/reports/sales` → all admins incl. staff/agents.
- **Decision #2**: VAT is display-only — toggleable label + header/footer text on receipts.
- **COGS honesty**: profit summary reports `cogsNote` when units sold have no purchase cost on record (counted at ₱0).
- Remaining skeleton sections below are historical (Modules 1–15 completed earlier).

## Module status

| # | Module | Status | Model used | Fallback fired? | Tests | Known defects | Next task |
|---|--------|--------|-----------|-----------------|-------|---------------|-----------|
| 0 | Setup: analysis, v2 prompt, AGENTS.md, progress.md | ✅ Done | deepseek-v4-flash-0731 | No | n/a | — | — |
| 1 | Thin slice | ✅ **DONE (gate passed live)** | deepseek-v4-flash-0731 | No | **59/59 + E2E** | none known | Next: Module 2 (auth/tenancy hardening) |
| 2.5 Admin dashboard UI | ✅ Done | deepseek-v4-flash-0731 | No | — | — | — |
| 3 Product mgmt (admin CRUD + stock, tenant) | ✅ Done | deepseek-v4-flash-0731 | No | **92/92 + E2E** | — | — |
| 4 Order status transitions (state machine + audit) | ✅ Done | deepseek-v4-flash-0731 | No | **92/92 + E2E** | — | — |
| 5 Store settings (pause, fees, min order, cutoff) | ✅ Done | deepseek-v4-flash-0731 | No | **92/92 + E2E** | — | — |
| 6 Messenger adapter (interface + suppressed provider + webhook verify, NO live calls) | ✅ Done | deepseek-v4-flash-0731 | No | **101/101** | — | Blocked on operator: Facebook App/Page tokens/HTTPS |
| 7 Deployment readiness (README, deploy guide, prod build) | ✅ Done | deepseek-v4-flash-0731 | No | **101/101** | — | Operator: Vercel/Render login |
| 8 Guest order claim/tracking (single-use link + storefront tracker) | ✅ Done | deepseek-v4-flash-0731 | No | **101/101 + E2E** | — | — |
| 9 Vouchers (admin CRUD, limit/min/expiry rules, apply at checkout) | ✅ Done | deepseek-v4-flash-0731 | No | **107/107 + E2E** | — | — |
| 10 Multi-store (platform admin, store creation, owner assignment, tenant via membership + X-Store-Id) | ✅ Done | deepseek-v4-flash-0731 | No | **111/111 + E2E (STORE2-000001)** | — | — |
| 11 Customer accounts + loyalty (earn on delivery, redeem at checkout, ledger) | ✅ Done | deepseek-v4-flash-0731 | No | **111/111 + E2E (200 pts, ₱2 off)** | — | — |
| 12 Analytics dashboard (KPIs, daily revenue, status funnel, top products, vouchers, low-stock) | ✅ Done | deepseek-v4-flash-0731 | No | **111/111 + live** | — | — |
| 13 Inventory hardening (7-day cart expiry, abandoned sweep, maintenance stats) | ✅ Done | deepseek-v4-flash-0731 | No | **113/113 + live** | — | — |
| 14 Notifications (templates, Messenger via adapter suppressed w/o PSID, SMS/email recorded, audit log) | ✅ Done | deepseek-v4-flash-0731 | No | **117/117 + live** | — | — |
| 15 Multi-warehouse (per-warehouse stock, transfer workflow request→approve→complete, role-gated) | ✅ Done | deepseek-v4-flash-0731 | No | **121/121 + E2E** | — | — |

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