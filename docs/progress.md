# SAM STORE — Progress Log

Updated: 2026-09-01 · Active model: `deepseek/deepseek-v4-flash-0731` (openrouter) · Budget ceiling: $100+

## Module status

| # | Module | Status | Model used | Fallback fired? | Tests | Known defects | Next task |
|---|--------|--------|-----------|-----------------|-------|---------------|-----------|
| 0 | Setup: analysis, v2 prompt, AGENTS.md, progress.md | ✅ Done | deepseek-v4-flash-0731 | No | n/a | — | — |
| 1 | Thin slice: scaffolding, tenancy, catalog, cart, guest COD checkout | ⏸ Not started | — | — | — | — | Awaiting CONTINUE |

## Decisions locked (do not re-litigate)

- Managed cloud Postgres + Redis; no local Docker.
- Paid Primary: `deepseek/deepseek-v4-flash-0731` → `z-ai/glm-5.3-flash` → `z-ai/glm-5.2:free`.
- Messenger = adapter-only until operator supplies Facebook App + tokens + HTTPS webhook.
- Thin Slice first: one store, public link, catalog, guest cart, COD checkout, cross-tenant auth test.
- Delivery Order 1–16 (master prompt) is authoritative over the old Stages 0–10.

## Open questions (blocked on operator)

1. Region / currency / timezone / locale — none specified in any source doc.
2. Payment gateway — depends on #1.
3. Object storage bucket (S3-compatible) — needed later, not for slice.
4. Domain + HTTPS — required before Messenger webhook.
5. Facebook App / developer account — Page exists, App does not.

## Model / budget ledger

| When | Model | Tokens (in/out) | Cost | Note |
|------|-------|-----------------|------|------|
| 2026-09-01 | deepseek-v4-flash-0731 | ~2M / ~0.2M (est.) | ~$0.25 (est.) | Setup/analysis session |

Routine build target: ~$1 thin slice · ~$5 full build · premium reviews on operator instruction only.