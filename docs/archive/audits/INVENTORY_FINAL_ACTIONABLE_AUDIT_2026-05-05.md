# Final Actionable Audit — Inventory Module
**Date:** 2026-05-05 | **Scope:** Live code state (HEAD) vs May 3rd P0 report vs May 5th deep audit

---

## Executive: What's Fixed vs What's Still Broken

| Issue Source | Bug | Status | Data Integrity Risk |
|-------------|-----|--------|---------------------|
| May 3 P0 #1 | 58 ghost-posted movements + outbox idle | **Code FIXED, data STALE** — cron wired, needs manual run | **HIGH** (8% of GL links missing) |
| May 3 P0 #2 | Arabic strings block typed API (`GRN`/`ISSUE`) | **PARTIALLY FIXED** — API accepts both, but `movement_types` table is dead code | MEDIUM |
| May 3 P0 #3 | Race condition in `upsertInventoryBalance` | **STILL OPEN** — no `expectedVersion` param | **HIGH** (silent balance corruption under concurrency) |
| May 3 P1 #4 | Transfer-batch partial failure leaks headers | **STILL OPEN** — header created before validation loop | MEDIUM |
| May 5 BUG #2 | Transfer-batch missing `upsertInventoryBalance` | **STILL OPEN** — snapshot never updated after transfer-batch | **HIGH** (stale balances) |
| May 5 BUG #4 | Analytics `reorder-alerts` divide-by-zero | **STILL OPEN** — `lb.balance_qty` not guarded | **HIGH** (query crash) |
| May 3 P1 #5 | `strict_sync` non-atomic rollback | **FIXED** — now marks `failed` + outbox instead of DELETE | — |

---

## 1. Database State Verification (Schema + Evidence)

### 1.1 `inventory_balances` Snapshot Table

```sql
-- Migration: 0084_phase0_foundations.sql (lines 42-53) + 0078_balance_rebuild_and_gl_backfill.sql
-- Status: EXISTS and POPULATED (confirmed by readInventoryBalance using it)
```

**Current code behavior:**
- `readInventoryBalance()` at `src/lib/inventory_posting.ts:94-141` reads from snapshot first, falls back to ledger SUM if `is_stale = 1`.
- `upsertInventoryBalance()` at `src/lib/inventory_posting.ts:150-171` writes snapshot but **blindly increments `version` without checking expected value**.

**Verdict:** Schema is correct. Race condition is in the write logic, not the schema.

---

### 1.2 `inventory_posting_outbox`

```sql
-- Migration: 0071_inventory_posting_controls_and_outbox.sql
-- Table: EXISTS
-- Idempotency index: EXISTS (0084, line 82-83)
```

**Current code behavior:**
- `processAllPendingOutbox(db)` at `src/lib/process_outbox.ts:137-151` IS wired into cron at `src/index.ts:167-172`.
- Pre-flight guard at `process_outbox.ts:53-65` correctly detects ghost-posted items (`gl_posting_status = 'posted' AND journal_entry_id IS NULL`) and re-processes them.

**Why 58 items still have `attempts = 0`:**
- The cron comment says `0 22 * * *` (10pm UTC = ~midnight Cairo) — if it hasn't fired yet since the 0078 backfill, attempts stay at 0.
- **OR** the cron is deployed but the `scheduled()` export isn't actually registered in wrangler.toml.

**Verdict:** Code is correct. Live data is stale because the worker hasn't executed. Run it manually once.

---

### 1.3 `movement_types` Reference Table

```sql
-- Migration: 0084_phase0_foundations.sql (lines 12-34)
-- Status: EXISTS, SEEDED with 10 codes
```

**Current code behavior:**
- `movements.ts:19-26` defines a hardcoded `SUPPORTED_MOVEMENT_TYPES` Set with Arabic + typed strings.
- `movements.ts:32-49` defines `mapToTransactionType()` with hardcoded mapping.
- **NOWHERE** in `movements.ts` does the code query `movement_types` table.

**Verdict:** Table is dead code. The "typed API" works by accident because of the hardcoded Set, not because of the reference table.

---

## 2. May 3rd P0 Bugs — Detailed Verdict

### P0 #1: 58 Ghost-Posted Movements + Idle Outbox

| Aspect | Verdict | Evidence |
|--------|---------|----------|
| Cron handler wired? | **FIXED** | `src/index.ts:167-172` calls `processAllPendingOutbox(env.DB)` |
| Outbox pre-flight detects ghosts? | **FIXED** | `process_outbox.ts:53-57` skips only if `journal_entry_id IS NOT NULL` |
| Ghost items still in DB? | **STILL BROKEN (DATA)** | 58 pending, 0 attempts per May 3rd query |

**Action needed:** Trigger outbox worker manually once. After that, monitor:
```sql
SELECT COUNT(*) FROM inventory_posting_outbox WHERE status = 'pending';
-- Target: 0
```

---

### P0 #2: Hardcoded Arabic Strings

| Aspect | Verdict | Evidence |
|--------|---------|----------|
| API accepts typed codes? | **FIXED** | `SUPPORTED_MOVEMENT_TYPES` includes `GRN`, `ISSUE`, etc. |
| `resolveMovementDirection()` handles both? | **FIXED** | `posting_engine.ts` uses direction map |
| Code uses `movement_types` table? | **STILL BROKEN** | `movements.ts:19-26` hardcodes Set; never queries DB |

**Action needed:** Replace hardcoded Set with DB lookup, or drop the table. Keeping both is technical debt.

---

### P0 #3: Balance Race Condition

| Aspect | Verdict | Evidence |
|--------|---------|----------|
| `version` column exists? | **FIXED (schema)** | `0084_phase0_foundations.sql:89` added it |
| `readInventoryBalance()` returns version? | **STILL BROKEN** | `src/lib/inventory_posting.ts:100-108` returns `{balance_qty, balance_value}` only — no `version` |
| `upsertInventoryBalance()` checks version? | **STILL BROKEN** | `src/lib/inventory_posting.ts:159-170` blindly increments; no `expectedVersion` param |

**Impact:** Two concurrent `POST /movements/batch` calls for the same item+warehouse read the same balance, both compute new balances, and the second `upsert` overwrites the first. The `inventory_movements` running totals also diverge.

**Action needed:** Add optimistic locking (see Fix List below).

---

## 3. May 5th Bugs Cross-Reference

### BUG #2: Transfer-Batch Missing `upsertInventoryBalance`

**Confirmed STILL OPEN.**

```typescript
// src/api/inventory/movements.ts:911-972
for (let i = 0; i < b.items.length; i++) {
  // ... read srcBal, validate, build INSERT stmts ...
  stmts.push(INSERT_TRANSFER_OUT)
  stmts.push(INSERT_TRANSFER_IN)
}

await c.env.DB.batch(stmts)  // line 972

// ❌ MISSING: upsertInventoryBalance() for both warehouses
// The next read via readInventoryBalance() will recompute from ledger
// because the snapshot was never updated.
```

**Impact:** After every transfer-batch, `inventory_balances` is stale for all transferred items until the next `readInventoryBalance()` call triggers auto-heal. During that window, stock checks use stale data.

---

### BUG #4: Analytics Divide-by-Zero

**Confirmed STILL OPEN.**

```sql
-- src/api/inventory/analytics.ts:87
ROUND(ac.consumed_qty * 100.0 / lb.balance_qty, 1) AS consumption_pct
--                              ^^^^^^^^^^^^^^
-- If balance_qty = 0, this crashes the query.
```

Also confirmed: `last_balance` CTE at `analytics.ts:64-70` uses `MAX(id)` instead of `MAX(movement_date, id)`:
```sql
SELECT MAX(id) FROM inventory_movements WHERE item_code = im.item_code
-- Should be: ORDER BY movement_date DESC, id DESC LIMIT 1
```

---

## 4. Final Prioritized Fix List (Ordered by Data Integrity Risk)

### 🔴 P0 — Fix Today (Data Corruption Risk)

| # | File | Line(s) | Fix | Minutes |
|---|------|---------|-----|---------|
| 1 | `src/lib/inventory_posting.ts` | 94-108, 150-171 | **Add optimistic locking to balance updates.** Return `version` from `readInventoryBalance`. Add `expectedVersion` param to `upsertInventoryBalance`. On conflict, return 409 and let client retry. | 45 |
| 2 | `src/api/inventory/movements.ts` | 972 | **Add `upsertInventoryBalance` loop after transfer-batch `batch(stmts)`** for every `(item_code, from_warehouse)` and `(item_code, to_warehouse)`. | 20 |
| 3 | `src/api/inventory/analytics.ts` | 87 | **Replace `/ lb.balance_qty` with `/ NULLIF(lb.balance_qty, 0)`** in consumption_pct. | 2 |
| 4 | `src/api/inventory/analytics.ts` | 67-70 | **Replace `MAX(id)` CTE with `ORDER BY movement_date DESC, id DESC LIMIT 1`** for true last balance. | 10 |

### 🟠 P1 — Fix This Week (Operational Risk)

| # | File | Line(s) | Fix | Minutes |
|---|------|---------|-----|---------|
| 5 | `src/api/inventory/movements.ts` | 899-908 | **Move `inventory_transactions` header creation AFTER the validation loop** in transfer-batch. Pre-validate all items first, collect insufficient-stock errors, return 409 with array. Only then create header + batch inserts. | 30 |
| 6 | `src/api/inventory/movements.ts` | 423-437 | **Add `FUTURE_NEGATIVE_STOCK` check inside batch loop** (mirror single-POST logic at lines 170-184). | 30 |
| 7 | `src/api/inventory/adjustments.ts` | ~187 | **Add `FUTURE_NEGATIVE_STOCK` check** in adjustment post loop. | 30 |
| 8 | `src/api/inventory/governance.ts` | 179 | **Fix `bind(company_id, ...binds)` → `bind(...binds)`** in items-master count query (company_id duplicated). | 5 |
| 9 | `src/api/inventory/movements.ts` | 19-26 | **Replace hardcoded `SUPPORTED_MOVEMENT_TYPES` Set with DB query** to `movement_types` table, or add comment explaining why hardcoded is kept. | 20 |

### 🟡 P2 — Fix Next Sprint (Hygiene)

| # | File | Line(s) | Fix | Minutes |
|---|------|---------|-----|---------|
| 10 | `src/api/inventory/movements.ts` | 331-343 | **Move `recordCashMovement` call to after GL posting success** (not before), or wrap in same try-catch so cash doesn't commit when GL fails. | 20 |
| 11 | `src/api/inventory/movements.ts` | 208, 407, 722, 894 | **Replace `Math.random()` local_id generation with `crypto.randomUUID()`**. | 15 |
| 12 | `web/src/components/forms/AddInventoryBatchModal.tsx` | 394 | **Add `if (!l.item_code)` validation before `Number(l.item_code)`**. | 5 |
| 13 | `web/src/pages/inventory/AdjustmentDetailPage.tsx` | 45 | **Add duplicate `item_code` check in `saveLinesMutation`**. | 10 |

---

## 5. Immediate Actions (Next 2 Hours)

### 5.1 Run Outbox Worker Manually

```bash
# If you have wrangler access:
npx wrangler d1 execute agri-nile-flow-data-lake --command="SELECT COUNT(*) FROM inventory_posting_outbox WHERE status = 'pending';"

# Then trigger the worker endpoint (if exposed):
curl -X POST https://your-api.agri-nile-flow-lake.pages.dev/api/inventory/posting-outbox/process \
  -H "Authorization: Bearer <admin_token>"
```

**Verify after run:**
```sql
SELECT status, COUNT(*) FROM inventory_posting_outbox GROUP BY status;
-- Target: only 'done' rows (or 0 rows if cleaned up)

SELECT COUNT(*) FROM inventory_movements 
WHERE gl_posting_status = 'posted' AND journal_entry_id IS NULL;
-- Target: 0
```

### 5.2 Verify Cron is Deployed

Check `wrangler.toml` for:
```toml
[triggers]
crons = ["0 22 * * *"]
```

If missing, add it and run:
```bash
npx wrangler deploy
```

### 5.3 Verify `ENABLE_POSTING_ENGINE` Env Var

The May 3rd report noted `ENABLE_POSTING_ENGINE` was a dead comment. Check live env:
```bash
npx wrangler secret list
```

`process_outbox.ts` does NOT check this env var — it runs unconditionally. If you intended a kill-switch, add the check.

---

## 6. One-Line Summary

**The architecture is fixed. Three data-integrity bugs are live in code: (1) balance race condition, (2) transfer-batch missing snapshot update, (3) analytics divide-by-zero. Fix these three and run the outbox worker, and the module moves from C to A-.**
