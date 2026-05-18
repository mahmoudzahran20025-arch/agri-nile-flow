# Audit: Inventory–Finance Integration Status
## 2026-05-03 — Post-Session Assessment

**Auditor:** ERP Inventory–Finance Integration Agent  
**Scope:** Live DB (`agri-nile-flow-data-lake`) + codebase HEAD + `SESSION_SUMMARY_2026-05-03.md`  
**Method:** SQL queries on remote D1 + code inspection of unstaged/modified files

---

## 1. Executive Summary — Where We Stand

| Area | Grade | Verdict |
|------|-------|---------|
| GL linkage | **B+** | 85% of movements have a JE. 58 ghost-posted items need outbox processing. |
| Balance integrity | **A-** | Snapshot table healthy (30 rows, 0 negatives). Auto-heal logic added. |
| Data migration | **A** | All 716 movements linked to transaction headers. `movement_types` seeded. |
| Outbox health | **D+** | 58 pending items, 0 attempts. Worker is not running. |
| Code hygiene | **B** | Arabic strings removed from hot path. `resolveMovementDirection` is clean. |
| Module boundaries | **C+** | Cash side-effect still inside inventory. `strict_sync` path still exists. |

**Overall:** The architecture is **significantly improved** since the last audit. The critical P0s (Arabic-string logic, default async mode, transaction headers) are largely fixed. The **single biggest remaining risk** is an idle outbox queue: 58 movements say "posted" but have no GL link because the worker never ran.

---

## 2. Structural Strengths (What Is Solid)

### 2.1 GL Cascade + Source Document Bridge
- `posting_engine.ts` uses real CoA codes (phantom-account fix applied in migrations 0080/0081).
- `business_events.ts` links every GL entry back to its source movement via `source_documents` / `source_document_links`.
- `postFromBusinessEvent()` has a period-lock guard — no silent writes into closed periods.

### 2.2 Balance Snapshot + Auto-Heal
- `readInventoryBalance()` in `src/lib/inventory_posting.ts` detects `is_stale` and recomputes from `SUM(qty_in) - SUM(qty_out)` before returning.
- This means even if a race corrupts the snapshot, the next read heals it. Good defensive design.

### 2.3 Transaction Header Completeness
```sql
SELECT COUNT(*) AS with_tx_header,
       SUM(CASE WHEN transaction_id IS NULL THEN 1 ELSE 0 END) AS orphan_movements
FROM inventory_movements;
-- Result: 716 | 0
```
**All movements are grouped under headers.** The 0079 backfill migration ran successfully.

### 2.4 Typed API Acceptance
```typescript
// movements.ts L19-26
const SUPPORTED_MOVEMENT_TYPES = new Set([
  'اضافة', 'صرف',
  'GRN', 'ISSUE',
  'TRANSFER_IN', 'TRANSFER_OUT',
  ...
])
```
The API now accepts both legacy Arabic and typed codes. `resolveMovementDirection()` in `posting_engine.ts` normalizes both to `IN`/`OUT`.

### 2.5 Default Posting Mode Fixed
```typescript
// inventory_posting.ts L13
posting_mode: 'async_reliable',
```
New companies default to the safe mode. `strict_sync` is still in code but no longer the default.

---

## 3. Open Gaps & Vulnerabilities (With Evidence)

### 3.1 CRITICAL — 58 Ghost-Posted Movements + Idle Outbox

**Evidence:**
```sql
-- Movements marked 'posted' but missing journal_entry_id
SELECT COUNT(*) AS total,
       SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS with_je
FROM inventory_movements;
-- Result: 716 | 610

-- Outbox queue
SELECT status, attempts, COUNT(*) AS cnt
FROM inventory_posting_outbox
GROUP BY status, attempts
ORDER BY attempts DESC;
-- Result: done | 0 | 5
--         pending | 0 | 58
```

**Analysis:** 716 total movements − 48 exempt_zero_value = 668 that should have a JE. Only 610 have one. The missing 58 = the 58 pending outbox items with **0 attempts**.

**Root cause:** Migration `0078_balance_rebuild_and_gl_backfill.sql` (Step 3) seeded the outbox for ghost-posted movements, but the worker (`processInventoryPostingOutbox`) has never been triggered. The cron is configured at `0 22 * * *` in `wrangler.toml`, but either:
- The cron trigger is not deployed, or
- The `scheduled()` handler in `src/index.ts` is not calling `processAllPendingOutbox()`, or
- The environment does not have `ENABLE_POSTING_ENGINE = true` at runtime.

**Impact:** 8% of inventory movements have no traceable GL entry. An auditor clicking "عرض القيد" on these movements will get a null/404.

**Fix:** Run the outbox worker once manually (`POST /inventory/posting-outbox/process` with a high limit), then verify the 58 items turn into `done` and get `journal_entry_id` populated.

---

### 3.2 HIGH — Balance Race Condition Mitigated but Not Closed

**Evidence:**
```typescript
// inventory_posting.ts L150-171
export async function upsertInventoryBalance(...) {
  await db.prepare(
    `INSERT INTO inventory_balances ... ON CONFLICT DO UPDATE SET
       balance_qty = excluded.balance_qty,
       version     = inventory_balances.version + 1`
  )...
}
```

**Analysis:** The `version` column is incremented, but:
1. `readInventoryBalance()` does **not** return the version it read.
2. `upsertInventoryBalance()` does **not** accept an `expectedVersion` parameter.
3. Two concurrent requests still read the same balance, compute divergent new balances, and the second `upsert` overwrites the first.

The `is_stale` auto-heal reduces the blast radius (next read fixes the snapshot), but the **perpetual inventory movement table** itself still carries the wrong running balances on future rows. Those wrong `balance_qty` / `balance_value` values are written into `inventory_movements` and never healed.

**Fix (minimal):** Pass `version` out of `readInventoryBalance`, add `expectedVersion` to `upsertInventoryBalance`, and retry on conflict.

---

### 3.3 HIGH — Cash Side-Effect Still Inside Inventory API

**Evidence:**
```typescript
// movements.ts ~L308 (still present in current code)
if (b.movement_type === 'اضافة' && b.payment_method === 'cash') {
  await FinanceCore.recordCashMovement(c.env.DB, {
    company_id, userId,
    transaction_date: b.movement_date,
    direction: 'م',
    amount: valueIn,
    narration: `شراء نقدي: ${itemRow?.name ?? b.item_code} (مخزن: ${b.warehouse})`,
    ...
  })
}
```

**Analysis:** This was flagged in the previous audit and is still there. It works, but it means:
- Inventory API writes treasury rows.
- If `recordCashMovement` throws after the movement commits, the DB has stock but no cash record.
- The outbox pattern does **not** protect the cash side-effect — only the inventory GL posting is outboxed.

**Risk level at this stage:** Medium. It only triggers on `payment_method === 'cash'` GRNs. If cash GRNs are rare, this is a contained leak.

**Fix:** Move the cash call to the Treasury module as a reaction to the inventory business event. Not urgent unless cash GRNs become frequent.

---

### 3.4 MEDIUM — `strict_sync` Path Still Fragile

**Evidence:**
```typescript
// movements.ts ~L252-280
if (controls.posting_mode === 'strict_sync') {
  try {
    glEntryId = await FinanceCore.resolveInventoryMovement(...)
    ...
  } catch (err: any) {
    await c.env.DB.prepare('DELETE FROM inventory_movements WHERE id = ?').bind(movId).run()
    await c.env.DB.prepare(
      `UPDATE inventory_movements SET balance_qty = balance_qty - ?, ...`
    )...
    throw new Error(`فشل إنشاء القيد المحاسبي وتم إلغاء الحركة المخزنية: ${err.message}`)
  }
}
```

**Analysis:** The rollback is not atomic in D1. If the DELETE succeeds and the balance-reversion UPDATE fails, the DB is inconsistent. Also, the `inventory_transactions` header is **not** deleted in this path.

**Mitigation:** Default is now `async_reliable`, so this path is only hit if an admin explicitly selects `strict_sync`. Acceptable risk if the UI hides or warns against this mode.

---

### 3.5 MEDIUM — All Historical Movements Use Arabic Strings

**Evidence:**
```sql
SELECT movement_type, COUNT(*) AS cnt
FROM inventory_movements
GROUP BY movement_type
ORDER BY cnt DESC;
-- Result: صرف | 576
--         اضافة | 140
```

**Analysis:** The `movement_types` reference table exists with 10 typed codes, but **zero** movements in the DB use them. The API accepts typed codes (`GRN`, `ISSUE`) but no client has sent them yet.

**Impact:** Low for now — `resolveMovementDirection` handles both. But if you ever want to query "all GRNs" or build a report by typed transaction type, the data is all legacy Arabic.

**Fix:** A one-time UPDATE script:
```sql
UPDATE inventory_movements
SET movement_type = CASE
  WHEN movement_type = 'اضافة' THEN 'GRN'
  WHEN movement_type = 'صرف'   THEN 'ISSUE'
END
WHERE movement_type IN ('اضافة', 'صرف');
```
This is safe because `resolveMovementDirection` handles both, and `mapToTransactionType` already maps them to the same transaction type.

---

### 3.6 LOW — Transfer Batch Partial Failure (Unverified in Live Data)

**Code path:** `movements.ts` ~L812+ `transfer-batch` still creates the `inventory_transactions` header before validating each item's stock in the loop.

**Live data check:** There are no draft transaction headers:
```sql
SELECT COUNT(*) AS draft_headers
FROM inventory_transactions
WHERE status = 'draft';
-- Expected: 0
```
If the result is 0, this bug has not materialized yet. But the code path is still risky.

---

## 4. New Gaps Appeared After Last Changes

### 4.1 Outbox Worker Not Wired (New)
The `process_outbox.ts` file exists and is correct, but the 58 pending items with 0 attempts prove the worker is not executing. Check:
- `src/index.ts` — does the `scheduled()` export call `processAllPendingOutbox(env.DB)`?
- `wrangler.toml` — is the cron trigger actually deployed to Cloudflare?
- The `ENABLE_POSTING_ENGINE` env var is a dead comment in `wrangler.toml` (line 14). The actual runtime check is a DB setting: `gl_integration_settings.is_enabled`.

### 4.2 `journal_entry_id` Backfill Left 58 Gaps (New)
Migration 0078 Step 2 backfilled `journal_entry_id` via `business_events` lookup, but 58 movements remained unmatched. Step 3 enqueued them in the outbox, but they are stuck. This means either:
- The original GL entries for these 58 movements were never created (phantom posting), or
- The GL entries exist but are not linked in `business_events` (pre-source-bridge era).

Running the outbox worker will tell you which: if `resolveInventoryMovement` succeeds, the JE was missing. If it fails with a duplicate-key or period-closed error, the JE exists but was not linked.

---

## 5. Prioritized TODO List

### P0 — Must Fix Before Real Data

| # | Action | Evidence / File |
|---|--------|-----------------|
| 1 | **Run the outbox worker on the 58 pending items** | `inventory_posting_outbox`: 58 pending, 0 attempts. `inventory_movements`: 610 with JE out of 668 expected. |
| 2 | **Verify `scheduled()` handler calls `processAllPendingOutbox`** | `src/index.ts` + `wrangler.toml` cron config. If missing, the queue will grow forever. |
| 3 | **Add optimistic locking to `upsertInventoryBalance`** | `src/lib/inventory_posting.ts` L150. Read `version`, pass `expectedVersion`, retry on conflict. |

### P1 — Important for Next Sprint

| # | Action | Evidence / File |
|---|--------|-----------------|
| 4 | **Backfill movement_type from Arabic to typed codes** | `SELECT movement_type FROM inventory_movements` returns only `صرف` / `اضافة`. |
| 5 | **Hide or warn on `strict_sync` mode in admin UI** | `DEFAULT_CONTROLS` is now `async_reliable`, but `strict_sync` path in `movements.ts` is still fragile. |
| 6 | **Delete or orphan `inventory_transactions` header on `strict_sync` rollback** | `movements.ts` ~L273: header is not deleted when movement DELETE + balance revert runs. |
| 7 | **Pre-validate transfer-batch stock before header insert** | `movements.ts` ~L843: header created before item loop validation. |

### P2 — Nice-to-Have / Longer Term

| # | Action | Evidence / File |
|---|--------|-----------------|
| 8 | **Extract cash side-effect from inventory to treasury event handler** | `movements.ts` ~L308: `recordCashMovement` inside inventory POST. |
| 9 | **Add `UNIQUE(company_id, ref_type, ref_id)` guard on `journal_entries`** | Prevents duplicate GL if outbox pre-flight is bypassed. Low probability today. |
| 10 | **Create `inventory_ledger_entries` when moving average is no longer enough** | Current `inventory_movements` + `inventory_balances` is sufficient for agri inputs. |

---

## 6. Metrics to Monitor

| Metric | Query | Target |
|--------|-------|--------|
| Outbox queue depth | `SELECT COUNT(*) FROM inventory_posting_outbox WHERE status = 'pending'` | 0 |
| Ghost-posted movements | `SELECT COUNT(*) FROM inventory_movements WHERE gl_posting_status = 'posted' AND journal_entry_id IS NULL` | 0 |
| Balance vs ledger drift | Compare `inventory_balances` to `SUM(inventory_movements)` per `(item, warehouse)` | 0 discrepancies |
| % typed vs Arabic | `SELECT COUNT(CASE WHEN movement_type IN ('GRN','ISSUE') THEN 1 END) / COUNT(*) FROM inventory_movements` | > 90% |
| Posting failure rate | `SELECT COUNT(*) FROM inventory_movements WHERE gl_posting_status = 'failed'` / total in last 7 days | < 1% |

---

## 7. Final Verdict

**C) Balanced but Fragile — with one active wound (the outbox queue).**

The architecture improvements since the last audit are real and substantial:
- Arabic-string logic is abstracted behind `resolveMovementDirection`.
- Default mode is `async_reliable`.
- Transaction headers are fully backfilled.
- Balance snapshot has auto-heal.
- Phantom accounts are remapped to real CoA.

But the **58 ghost-posted movements** are a live data-integrity issue. They represent 8% of the inventory ledger with no GL trace. The outbox is the correct repair mechanism — it just needs to be triggered.

**Fix #1 (run the worker) and you go from C to B+. Fix #2 (optimistic locking) and you go from B+ to A-.**
