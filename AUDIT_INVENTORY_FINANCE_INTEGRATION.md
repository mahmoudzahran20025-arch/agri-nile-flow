# Audit Report: Inventory–Finance Integration

**Date:** 2026-05-03 | **Scope:** `src/api/inventory`, `src/lib/finance*`, outbox, posting engine

---

## 1. Strengths

- **Transactional Outbox is real and functional.** `inventory_posting_outbox` with `idempotency_key`, `enqueueInventoryPostingOutbox`, and `processInventoryPostingOutbox` worker.
- **Posting engine has a traceable cascade.** `posting_engine.ts` implements BPG×PPG×IPG resolution with `JournalBlueprint`, validation, and `posting_rule_resolutions` logging.
- **Source Document Bridge exists.** `source_documents` + `source_document_links` in `business_events.ts` enable cross-module reconciliation.
- **GL Preview prevents blind posting.** `POST /inventory/gl-preview` returns the exact blueprint before any write.
- **Health dashboards expose gaps.** `postingHealth` and `healthSummary` report missing rules per `(warehouse, IPG, PPG)`.
- **Lock dates & zero-value policy enforced.** `enforceInventoryLockDate` + `validateZeroValuePolicy` with role-based approval gating.
- **Audit logging wired in.** `logAudit` on every movement creation.
- **FinanceCore facade isolates inventory from GL internals.** Inventory calls `resolveInventoryMovement`, never `posting_engine.ts` directly.
- **Phase 0–4 migrations show architectural intent.** `movement_types`, `inventory_balances`, `inventory_transactions` tables designed correctly.

---

## 2. Weaknesses & Legacy Hotspots

### CRITICAL — Race Condition in Balance Updates
`inventory_balances` has a `version` column, but `upsertInventoryBalance` does **not** use optimistic locking. Two concurrent requests read the same balance, compute new values independently, and the second overwrites the first. Balance corruption is deterministic under concurrent load.

### HIGH — Hardcoded Arabic Strings as Business Logic
`inventory_movements` validation and direction logic uses `movement_type === 'اضافة'` and `=== 'صرف'`. The `mapToTransactionType` helper maps typed codes, but the core logic still checks Arabic strings. The `movement_types` table (in `0076_phase0_foundations.sql`) is **unstaged/unapplied**. A client sending `GRN` will pass the top-level mapper but fail deeper Arabic comparisons.

### HIGH — Cash Movement Side-Effect Inside Inventory API
When `movement_type === 'اضافة' && payment_method === 'cash'`, the inventory API directly calls `FinanceCore.recordCashMovement`. This breaks module isolation: inventory is writing treasury data. If cash posting fails, stock is already committed. This also bypasses the outbox pattern for the cash leg.

### HIGH — `strict_sync` Rollback is Fragile
If `FinanceCore.resolveInventoryMovement` throws in `strict_sync`, the code deletes the movement and manually reverts future rows' balances. This is not atomic in D1: if the delete succeeds but the balance reversion fails, the DB is inconsistent. The `inventory_balances` snapshot is **not** reverted in this path, and the `inventory_transactions` header is **not** deleted.

### MEDIUM — `inventory_movements` Still Acts as Both Line and Ledger
No dedicated `inventory_ledger_entries` table exists. Running balances live on the movement rows, making FIFO cost layers impossible and audit trails semantically muddy.

### MEDIUM — Transfer Batch Partial Failure Leaks Headers
In `transfer-batch`, the `inventory_transactions` header is created first, then items are validated in a loop. If item #3 fails stock validation, the header and first 2 items remain in the DB with a mismatched `line_count`.

### MEDIUM — Missing COA Validation in Posting Health
`postingHealth` checks if a rule exists for a combo, but does not verify the resolved accounts exist in `chart_of_accounts`, are active, and are not header accounts. A rule can be "green" but still fail at posting time.

### LOW — Outbox Pre-Flight Guard is Incomplete
`process_outbox.ts` checks `gl_posting_status = 'posted'` to skip reprocessing, but does not verify the `journal_entry_id` actually exists in `journal_entries`. A manual deletion of the GL row would leave the outbox permanently skipped.

---

## 3. Integration Quality Assessment

**Verdict: Healthy in principle, fragile in execution.**

The **outbox pattern** and **source document bridge** represent healthy module isolation. Inventory does not write GL lines directly; it queues an event. This is correct.

However, three patterns violate the boundary:
1. **`strict_sync`** calls `FinanceCore.resolveInventoryMovement` inside the inventory API request and rolls back on failure. This makes inventory hostage to finance health and D1's lack of true transactions.
2. **Cash movement side-effect** (`recordCashMovement` inside inventory) creates a direct coupling from inventory → treasury.
3. **`inventory_movements` dual role** as both document line and ledger entry means the "perpetual inventory ledger" concept is not physically realized; the GL bridge posts from movement rows, not from a clean ledger.

**Recommendation:** Treat `async_reliable` as the only production-viable mode. Deprecate `strict_sync` or implement it via the outbox with synchronous polling, not in-process GL creation.

---

## 4. Prioritized Recommendations

| # | Priority | Action | Phase |
|---|----------|--------|-------|
| 1 | **P0** | **Fix balance race condition.** Change `upsertInventoryBalance` to read `version`, compute `expectedVersion + 1`, and fail/retry if the row was modified between read and write. | Immediate |
| 2 | **P0** | **Remove Arabic-string business logic.** Apply `0076_phase0_foundations.sql`, replace all `=== 'اضافة'` / `=== 'صرف'` checks with `direction` lookups from `movement_types`. | Immediate |
| 3 | **P1** | **Extract cash movement from inventory API.** Remove `FinanceCore.recordCashMovement` from `movements.ts`. If a GRN is cash-paid, emit a business event or let the treasury module react to the inventory outbox. | Sprint 1 |
| 4 | **P1** | **Deprecate or harden `strict_sync`.** Either remove it (default to `async_reliable`) or reimplement it as "enqueue outbox + immediately call `processInventoryPostingOutbox` for that single message" so rollback is unnecessary. | Sprint 1 |
| 5 | **P1** | **Complete Phase 0–4 migrations.** Stage and apply `0076_phase0_foundations.sql` and `0077_phase4_transaction_headers.sql`. Backfill legacy `transaction_id` values. | Sprint 1 |
| 6 | **P2** | **Create `inventory_ledger_entries` table.** Extract the perpetual ledger from `inventory_movements`. Movements become document lines; ledger entries become write-once facts with `costing_batch_id` support. | Sprint 2 |
| 7 | **P2** | **Implement FIFO cost layer allocation.** Add `fifo_cost_layer_allocation` table linking OUT entries to consumed IN batches. Update balance snapshot logic to respect layers. | Sprint 2 |
| 8 | **P2** | **Fix transfer-batch partial failure.** Pre-validate all items' stock before creating the `inventory_transactions` header, or accumulate all inserts into a single `db.batch()` call. | Sprint 2 |
| 9 | **P2** | **Harden posting health check.** Extend `postingHealth` to call `validateAccounts` on resolved accounts for each combo, flagging inactive/missing/header accounts as red. | Sprint 2 |
| 10 | **P3** | **Add GL-level idempotency.** Add `UNIQUE(company_id, ref_type, ref_id)` on `journal_entries` (or a pre-insert check in `postFromBusinessEvent`) so outbox reprocessing cannot create duplicate GL lines even if the pre-flight guard is bypassed. | Sprint 3 |
