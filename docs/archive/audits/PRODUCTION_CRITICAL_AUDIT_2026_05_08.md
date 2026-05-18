# Production-Critical Audit Report
**Date:** 2026-05-08
**Scope:** Strict reality-based review of financial and stock integrity risks only
**Method:** Code-level verification of concurrency paths, atomicity gaps, and silent failures

---

## 1. CRITICAL FAILURES (can cause financial or stock corruption)

### C-01: Inventory TOCTOU Negative Stock
- **Status:** ACTUAL
- **Location:** `src/api/inventory/movements.ts` lines 163-181 (single ISSUE), 383-420 (batch)
- **Pattern:** `readInventoryBalance()` → check `prevQty >= quantity` → separate `INSERT`
- **Reproduction condition:** Two concurrent outbound requests for same `(item_code, warehouse)`.
  - Request A reads balance = 100, checks 100 >= 50, proceeds to insert.
  - Request B reads balance = 100 (before A commits), checks 100 >= 50, proceeds to insert.
  - Both insert -50. Ledger shows total -100. Snapshot shows -100.
- **Financial impact:** Stock ledger shows negative quantities. Subsequent GL valuations use negative balances. Physical count vs. ledger diverges permanently.
- **Root cause:** No atomic `UPDATE inventory_balances SET balance_qty = balance_qty - ? WHERE balance_qty >= ?` guard. SQLite on D1 has no row-level locking between read and write across separate statements.

### C-02: Cash Mirror Silent Failure on GRN
- **Status:** ACTUAL
- **Location:** `src/api/inventory/movements.ts` lines 283-306 (single), 539-561 (batch)
- **Pattern:** Inventory movement INSERT succeeds, then `FinanceCore.recordCashMovement()` wrapped in try/catch. On failure, error is logged and swallowed.
- **Reproduction condition:** GRN with `payment_method === 'cash'` where cash insert fails due to:
  - Closed financial period for cash (period check inside `prepareCashMovement`)
  - Missing control account mapping (`resolveControlAccount` throws)
  - D1 transient error
- **Financial impact:** Inventory shows stock received. Treasury shows no cash outflow. Supplier balance (if mirrored) may also be missing. Three-way reconciliation (Inventory / Treasury / Supplier) breaks permanently.
- **User visibility:** None. API returns `success: true` for inventory. Error only in logs.

### C-03: D1 Batch Partial Commit in Transfers
- **Status:** ACTUAL
- **Location:** `src/api/inventory/movements.ts` lines 487 (single movement batch), 833 (transfer batch)
- **Pattern:** `await db.batch(stmts)` where `stmts` includes:
  - For transfers: OUT movement INSERT + IN movement INSERT
  - For movements: movement INSERT + balance snapshot upsert
- **Reproduction condition:** D1 `batch()` sends statements in a single HTTP request but does NOT guarantee atomic rollback. If statement N fails, statements 1..N-1 may already be committed by SQLite.
  - Transfer OUT commits, Transfer IN fails (e.g., `to_warehouse` constraint violation). Stock removed from source, never arrives at destination.
  - Movement INSERT commits, balance snapshot upsert fails. Ledger and snapshot diverge.
- **Financial impact:** Unexplained stock loss (phantom shrinkage). Inventory balance snapshot no longer matches ledger SUM.

### C-04: Running Balance Race in Cash and Supplier Ledgers
- **Status:** ACTUAL
- **Location:** `src/lib/finance/cash_movement.ts` lines 61-77, `src/api/suppliers.ts` lines 38-96
- **Pattern:**
  1. `SELECT running_balance FROM ... ORDER BY date DESC, id DESC LIMIT 1`
  2. Compute `newBalance = prevBalance + delta`
  3. `UPDATE ... SET running_balance = running_balance + ? WHERE ...` (shift later rows)
  4. `INSERT ...` (new row with `newBalance`)
- **Reproduction condition:** Two concurrent cash transactions on same `financial_account_id`.
  - A reads 1000, computes 900, inserts 900.
  - B reads 1000 (before A's INSERT), computes 900, inserts 900.
  - Later rows shifted by both deltas = 800. But the two new rows both show 900.
  - Running balance chain is inconsistent.
- **Financial impact:** Cash ledger running totals become mathematically inconsistent with transaction sums. Bank reconciliation impossible without full recompute.
- **Same pattern applies to supplier `balance_no_checks` / `balance_with_checks`.**

---

## 2. HIGH RISK UNDER LOAD (race conditions, SQLite limitations)

### H-01: GL Journal Header Without Lines
- **Status:** ACTUAL
- **Location:** `src/lib/gl.ts` lines 58-81
- **Pattern:** `postAutoEntry` inserts journal entry header (gets `entryId`), then `db.batch(lineStmts)`.
- **Reproduction condition:** D1 `batch()` for lines fails mid-way (constraint violation on one line, or transient error). Header row remains. Lines partially inserted or missing.
- **Impact:** Unbalanced journal entry exists in `journal_entries` table. Trial balance and financial reports become incorrect. `is_posted=1` flag makes it appear valid.
- **Severity:** High under load. Rare under low volume.

### H-02: Transfer Batch Divide-by-Zero
- **Status:** ACTUAL
- **Location:** `src/api/inventory/movements.ts` line ~781 (batch transfer)
- **Pattern:** `avgPrice = srcBal.balance_value / srcBal.balance_qty` with no zero guard. Single transfer at line 609 HAS `if (srcBal.balance_qty > 0)`; batch transfer omits it.
- **Reproduction condition:** Transfer batch includes item from warehouse with `balance_qty = 0` (possible from prior data correction, or edge case after concurrent transfer).
- **Impact:** `avgPrice` = Infinity or NaN. Propagates to `value_out`, `value_in`, and eventually GL posting. Corrupts financial valuation.
- **Severity:** High. Deterministic crash or data corruption on specific input.

### H-03: Inventory Outbox Never Processed
- **Status:** THEORETICAL
- **Location:** `src/lib/inventory_posting.ts` lines 66-82
- **Pattern:** `enqueueInventoryPostingOutbox` writes `(company_id, event_type, movement_id)` to `inventory_posting_outbox` with `status='pending'`. GL posting is async.
- **Reproduction condition:** Outbox processor (cron/worker) fails permanently or is not deployed.
- **Impact:** Inventory movements have `gl_posting_status='pending'` forever. No GL entries created. Inventory and GL diverge. Detectable via pending queue, but not auto-resolved.
- **Mitigation:** Outbox queue is observable. Not silent corruption, but traceability break.

---

## 3. DESIGN DEBT (non-blocking, no financial impact)

### D-01: Client-Side Pagination Filters
- `SupplierListPage` and `InventoryMovementsPage` compute KPIs and filters on `data?.data` (current page of 100 rows).
- **Impact:** UX inaccuracy only. Does not affect stored data or backend calculations.

### D-02: Permission DB Query Per Request
- `auth.ts` `hasPermission` queries `role_permissions` JOIN on every guarded request.
- **Impact:** Performance overhead. Not a financial or integrity risk.

### D-03: Hardcoded Movement Direction Set
- `src/lib/posting_engine.ts` `resolveMovementDirection` uses hardcoded `IN_CODES` Set.
- **Impact:** Only matters when adding new movement types. Current types are covered.

### D-04: Frontend NaN Validation
- `Number(form.code) <= 0` pattern in several modals.
- **Actual risk:** Minimal. JSON serialization converts NaN to null. Backend falsy checks (`!li.quantity`) catch null. Treasury uses Zod validation. Direct API attack vector is not relevant for standard production usage.

---

## 4. FALSE POSITIVES (overstated risks in previous audits)

### F-01: BIZ-01 "Batch stock check fails mid-way leaving partial inserts"
- **Reality:** Stock checks at `movements.ts:383-420` abort with `return c.json(..., 409)` BEFORE any `stmts.push()`. No partial inserts from stock rejection.
- **Real issue:** D1 `batch()` atomicity (C-03), not stock check logic.

### F-02: POST-04 "journal_entry_id not cleared on re-post"
- **Reality:** The re-post endpoint (`suppliers.ts:711`) only processes rows with `status = 'draft'`. Drafts by definition have no `journal_entry_id`. The CREATE flow rolls back to draft on GL failure, but the transaction was new and had no prior `journal_entry_id`.

### F-03: R-05 "warehousesSetup dead code is critical"
- **Reality:** Dead code in `web/src/api/inventory.ts:12-13` is unused. No financial or operational impact.

---

## 5. MINIMAL SAFE CORE (production-stable per-request logic)

The following components are correct under single-request execution and form the stable core of the system:

1. **Authentication & Authorization** (`auth.ts`)
   - JWT sign/verify with Web Crypto PBKDF2 and HMAC-SHA256.
   - `requireCompany` correctly scopes all queries by `company_id` from JWT.
   - `permissionGuard` and `roleGuard` correctly reject unauthorized access.

2. **Treasury Direct Posting** (`treasury.ts` POST /transactions)
   - Zod schema validation (`transactionSchema`) correctly enforces types and positive amount.
   - `prepareCashMovement` correctly computes running balance and delta shifts per-request.
   - GL posting via `resolveCashLedger` is correct per-request.

3. **Supplier Transaction Creation** (`suppliers.ts` POST /)
   - Validation of `code`, `name`, `credit_limit` is correct.
   - Asset creation linking (`createdAssetId`) and GL posting logic is correct per-request.
   - `_fullRebalanceSupplierBalances` correctly recalculates the entire chain.

4. **GL Posting Engine** (`gl.ts`)
   - `getOpenPeriod` correctly enforces period closure.
   - `postAutoEntry` correctly validates debit=credit before insert.
   - Per-request, header and lines are consistent.

5. **Business Events Idempotency** (`business_events.ts`)
   - `INSERT OR IGNORE` on outbox prevents duplicate queue entries.
   - `UNIQUE` constraint catch correctly returns existing `journal_entry_id` on duplicate event.
   - Posting rule trace logging is correct.

6. **Inventory Balance Healing** (`readInventoryBalance`)
   - Falls back from stale snapshot to `SUM(qty_in) - SUM(qty_out)` from ledger.
   - `upsertInventoryBalance` correctly writes authoritative values.
   - Per-request, snapshot matches ledger.

---

## 6. Conclusion

**There are 4 CRITICAL failures and 3 HIGH risks.** All critical issues stem from the same root cause: **D1 SQLite lacks true multi-statement transactions and row-level locking**, and the code performs read-then-write sequences across separate statements.

**Recommended immediate actions:**
1. **C-01 (TOCTOU):** Add an `UPDATE inventory_balances SET balance_qty = balance_qty - ? WHERE balance_qty >= ?` atomic guard before movement insert. Abort if `changes() = 0`.
2. **C-02 (Cash mirror):** Do not swallow cash mirror failure. Return a warning in the API response or rollback the inventory movement.
3. **C-03 (Batch atomicity):** Implement compensating deletion logic: if any statement in a transfer batch fails, explicitly DELETE the already-committed rows using the known `transaction_id` or `local_id`.
4. **C-04 (Running balance race):** Serialize concurrent updates on the same account/supplier via a deterministic queue key, or switch to an `INSERT`-only ledger with balance computed at read time.
5. **H-02 (Divide by zero):** Add `srcBal.balance_qty > 0 ? srcBal.balance_value / srcBal.balance_qty : 0` guard in batch transfer loop.
