# SAM STORE — Operations Runbook (Module 11)

All commands run from the repo root (`D:\opencode project`) in git-bash unless noted.

## Servers

| Server | Port | Start | Stop |
|---|---|---|---|
| API (NestJS) | 4100 | `cd apps/api && PORT=4100 npm run start` | kill the real listener (below) |
| Web (Next prod) | 3000 | `cd apps/web && npm run start` | kill the real listener (below) |

Killing an `npm run start` session only kills the npm wrapper — the child (tsx/next) survives and keeps the port. Always find + tree-kill the real listener:

```bash
PID=$(netstat -ano | grep LISTEN | grep ":4100 " | awk '{print $NF}' | sort -u | head -1)
MSYS_NO_PATHCONV=1 taskkill /F /T /PID $PID
```

Never rebuild `.next` while a `next start` is serving it (stale-chunk client errors). Order: kill → `rm -rf apps/web/.next` → `npx next build` → start → verify `dash=200` + BUILD_ID match.

## Gates

```bash
npm run typecheck   # contracts + api + web
npm test            # sequential runner (scripts/run-tests.mjs) — NEVER the raw node --test
                    # (it runs files concurrently and exhausts the Supabase pool: pool_size 15)
npm run test:e2e    # Playwright critical-path suite (needs both servers up on :3000/:4100)
npm run build
npm run db:validate
```

E2E suite (`apps/api/e2e/`): API health + public-link access control, admin login →
dashboard, and the full customer journey (storefront → cart → 3-step delivery COD
checkout → order placed → claim token single-use 200/409/409 + garbage 401). Single
worker only. Run order matters (01 → 03) but each spec is self-contained; 03 is
idempotent across re-runs (it claims the fresh order it just placed).

## Database (remote Supabase Postgres — no local Docker)

- Migrations are applied with `npx prisma migrate deploy` (non-interactive). `migrate dev` is interactive (needs a TTY) — prefer `migrate diff --from-schema-datasource … --to-schema-datamodel … --script` + a manual `prisma/migrations/<ts>_<name>/migration.sql` + `migrate deploy` when automating.
- After any schema change: **stop the API first**, then `npx prisma generate` (the query-engine DLL is locked by a running API → `EPERM`).
- P3015 (migration dir without migration.sql) = a failed interactive run left a stray dir → delete it and re-run.
- The pooler has a 5s interactive-transaction start timeout and `pool_size: 15`: don't open many concurrent interactive transactions (this is why `npm test` is sequential and why the checkout row-lock approach was replaced by guarded single-statement UPDATEs).

## Health

```bash
curl http://localhost:4100/health        # liveness (no DB)
curl http://localhost:4100/health/ready  # readiness (SELECT 1; 503 when degraded)
```

## Stock reconciliation

The `StockMovement` ledger (Module 4) is the source of truth for every stock change since its introduction. Verify balances against it:

```bash
npx tsx scripts/reconcile-stock.ts             # dry-run: reports DRIFT per product
npx tsx scripts/reconcile-stock.ts --apply     # writes correction ADJUST movements + fixes balances
npx tsx scripts/reconcile-stock.ts --store <storeId>
```

Levels with no movements predate the ledger and are skipped (cannot be validated this way).

## Order status / fulfillment

- Fulfillment is the explicit `Order.fulfillmentType` enum (PICKUP/DELIVERY, Module 3) — never trust `deliveryType` (Prisma defaults it to `delivery`).
- Delivery orders must reach COMPLETED only via courier DELIVERED; pickup/POS via `complete-now`/POS complete. A delivery order forced to COMPLETED is rejected server-side.
- Claims are single-use and consumed atomically (`updateMany WHERE usedAt IS NULL`).

## Money invariants (do not regress)

- Integer minor units everywhere; server-authoritative totals; signatures required for credit/utang (validate `data:image/`, ≤2M chars).
- Void requires an unfulfilled, non-collected order; refunds are capped at the remaining captured amount; a CANCELLED order can never be voided/refunded again.
- Checkout is ONE transaction (order + stock reserve + cart + voucher + loyalty + credit) with guarded atomic UPDATEs for limits; the same idempotency key always returns the same order.

## Outbox (Module 9)

- Checkout enqueues `order.received`; the worker (started in `main.ts`, 5s poll) drains it to a `NotificationLog` row and marks PROCESSED (FAILED after 5 attempts with backoff).
- Check pending: `SELECT status, count(*) FROM "OutboxEvent" GROUP BY 1;` — a stuck PENDING with old `nextAttemptAt` means the worker isn't running (check the API process).

## Backup / restore / incident / rollback

- **Backup**: use the managed Postgres provider's snapshot/backup (Supabase dashboard / `pg_dump`). No local backups are configured — schedule a daily dump to an off-box location:
  `pg_dump "$DATABASE_URL" | gzip > backup-$(date +%F).sql.gz` (run from a machine with network access to the pooler; never log the connection string).
- **Restore**: create a fresh database, `pg_dump`-restore, point `DATABASE_URL` at it, `prisma migrate deploy` (all migrations replay), smoke-test `/health/ready`.
- **Migration rollback**: SAM STORE migrations are additive (expand → backfill → verify → contract). To roll back a bad forward migration: (1) keep the column/table but stop writing it, (2) backfill the old field from the new one, (3) drop the new constraint only after verification. Do NOT `migrate reset` against production.
- **Incident flow**: 1) `/health/ready` — if degraded, check the pool (5s timeout → reduce concurrent work, e.g. stop background jobs), 2) check outbox backlog and failed events (`lastError`), 3) run `reconcile-stock` dry-run, 4) check `OutboxEvent`/`StockMovement` for drift, 5) only after evidence, `--apply`.
- **Rollback of a deploy**: `git revert <bad-commit>` or checkout the previous `main`, rebuild web (kill → rm .next → build → start), restart API.

## Verification checklist after any change

1. `npm run typecheck` && `npm test` (sequential) && `npm run build`
2. `npm run db:validate`; `prisma migrate status` when schema changed
3. Live probes: `/health/ready` 200; dashboard 200; a real POS sale writes a `StockMovement` row
4. Cross-tenant: a membershipless user gets 403; store A can't read store B (M1 tests)
5. `git diff --check` and a secret/PII scan before pushing
