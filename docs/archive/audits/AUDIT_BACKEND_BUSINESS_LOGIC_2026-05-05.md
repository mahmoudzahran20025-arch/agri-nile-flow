# Backend Business Logic Audit — 2026-05-05

## Scope
- Supplier payments and treasury mirror integrity
- Purchasing invoice payment account binding
- Inventory-to-GL linkage quality
- Equipment/fixed assets persistence footprint
- Production error telemetry (system_error_logs)

## Method
- Executed: execute_audit_backlog.js (remote D1 + live API probes)
- Ran focused SQL checks on remote D1: agri-nile-flow-data-lake
- Used read-only validation queries only

## Key Results

### 1) Supplier payment -> cash mirror
- Check: posted supplier_transactions (entry_type='م') without matching posted cash_transactions
- Result: 2 records
- IDs: 3312, 3026
- Notes:
  - Both are dated 2025-12-16, supplier_code 20100033, amount 3700
  - They look historical/backfill duplicates (created_at 2026-04-27 and 2026-05-01)

### 2) Purchasing /supplier-invoices/:id/pay financial account binding
- Check: cash rows likely from purchasing payment with null financial_account_id
- Result: 0
- Interpretation: Path 3 guard is effective in current data.

### 3) Inventory linkage blocker (from executable audit)
- Reported in AUD-001: 54 posted inventory rows without journal_entry_id
- Deep check:
  - gl_posting_status breakdown for those 54 rows: all = exempt_zero_value
  - real_unlinked_non_exempt = 0
- Interpretation: current gate is producing a false blocker by counting exempt zero-value rows as failures.

### 4) Equipment/fixed assets runtime footprint
- fixed_assets total rows: 0
- depreciation_schedules rows: 0
- Interpretation: schema is in place, but no live transactions yet have produced fixed assets in production data.

### 5) Top production SQL errors in last 7 days
- no such column: cc.name (94 + 65 + 58 + 38 + 24 occurrences)
- no such column: sdl.journal_entry_id (37 occurrences)
- no such column: l.created_at (30 occurrences)
- no such table: source_documents (22 occurrences)
- no such column: i.reorder_point (20 occurrences)

## Endpoints impacted (sample)
- /api/gl/reconciliation/source-documents -> no such column: sdl.journal_entry_id
- /api/gl/orphans -> no such column: l.created_at
- /api/gl/ledger/:account -> no such column: l.created_at and older cc.name variants
- /api/reports/cost-centers and /api/reports/season-summary -> cc.name (historical errors)

## Risk Rating
- High:
  - Reconciliation and orphan endpoints currently erroring in production due to schema/query mismatches.
- Medium:
  - 2 historical supplier payment records are still unmatched in cash mirror checks.
- Low:
  - Inventory linkage gate currently over-reports failures due to exempt zero-value rows.

## Recommended Next Actions
1. Patch GL reconciliation/orphans queries to use existing columns only, then smoke-test endpoints.
2. Update audit gate logic for AUD-001 to exclude inventory rows where gl_posting_status in ('exempt_zero_value','skipped_zero_value').
3. Backfill/repair the two supplier payment rows (IDs 3312, 3026) or mark them as accepted historical exceptions.
4. Run authenticated API smoke tests for:
   - /api/gl/reconciliation/source-documents
   - /api/gl/orphans
   - /api/gl/ledger/:account
5. Re-run execute_audit_backlog.js after fixes and regenerate daily report.


P1 FINDINGS (Architectural Violations)
P1-1: analytics.ts /reorder-alerts — Divide-by-Zero on lb.balance_qty
File: src/api/inventory/analytics.ts


ROUND(ac.consumed_qty * 100.0 / lb.balance_qty, 1) AS consumption_pct
Problem: WHERE lb.balance_qty > 0 filters the CTE, but SQLite evaluates consumption_pct after the JOIN. A race condition where balance drops to zero between CTE materialization and the outer query can produce a division by zero. More critically, balance_qty comes from inventory_movements.balance_qty (the running balance column), not the inventory_balances snapshot — it will be stale for any company using async posting mode.

Also: the reorder_point column referenced in the audit doc error (no such column: i.reorder_point) is in the items table — check whether the column exists in your schema migration. The current analytics.ts does NOT reference i.reorder_point, so that error is from a different (older) endpoint that no longer exists in the codebase. Status: resolved in current code.

Fix for divide-by-zero: Add NULLIF(lb.balance_qty, 0) in the denominator:


ROUND(ac.consumed_qty * 100.0 / NULLIF(lb.balance_qty, 0), 1) AS consumption_pct
P1-2: reconciliation.ts /source-documents — source_documents Table May Not Exist
File: src/api/gl/reconciliation.ts

Problem: The entire source-documents reconciliation endpoint queries source_documents, business_events, and source_document_links tables. The audit doc lists production error no such table: source_documents. Th
Impact: Every call to GET /gl/reconciliation/source-documents crashes in production. The /gl/integrity-audit page that links to this endpoint will show 500 errors.

Fix: Apply migrations 0027–0028 to production. No code change needed — the SQL is correct.

P1-3: reconciliation.ts — sdl.journal_entry_id Column Error
File: src/api/gl/reconciliation.ts

Problem: The query uses sdl.journal_entry_id where sdl is aliased from source_document_links. Production error no such column: sdl.journal_entry_id means either the column is named differently or the source_document_links migration hasn't been applied.

Fix: Verify the column name in migration 0028. If the column is je_id or similar, update the alias in the query. Apply the migration.

P2 FINDINGS (Logic Errors)
P2-1: upsertInventoryBalance — No Optimistic Lock (Race Condition)
File: src/lib/inventory_posting.ts

Problem: upsertInventoryBalance computes balQty/balVal by adding deltas to a previously-read balance, then writes it unconditionally via ON CONFLICT DO UPDATE. In Cloudflare Workers, concurrent requests for the same (company_id, item_code, warehouse) can produce:


Worker A reads balance = 100
Worker B reads balance = 100
Worker A writes balance = 100 + 50 = 150  ✓
Worker B writes balance = 100 + 30 = 130  ✗ (correct should be 180)
The readInventoryBalance self-heal mitigates this for reads, but the write path has no guard.

Fix: Add a version column check:


ON CONFLICT(company_id, item_code, warehouse) DO UPDATE SET
  balance_qty = excluded.balance_qty,
  ...
  WHERE inventory_balances.version = excluded.version - 1
Then check changes() — if 0 rows updated, the snapshot was stale, fall back to recompute-from-ledger. For D1's single-writer model this is lower risk than a traditional RDBMS, but still a real gap when outbox processes batches concurrently for different movements of the same item.

P2-2: treasury.ts — Partner Capital GL Entry Uses contraAccount Field That May Not Exist in recordCashMovement
File: src/api/treasury.ts


await FinanceCore.recordCashMovement(c.env.DB, {
  ...
  contraAccount: equityCode  // ← is this field in the schema?
})
Problem: recordCashMovement's TypeScript parameter type needs to accept contraAccount. If this field is not in the type definition, it is silently ignored at runtime and the GL entry posts to the default contra account (cash DR / revenue CR instead of cash DR / equity CR). This means partner capital injections hit the income statement instead of equity — a material misclassification.

Fix: Verify FinanceCore.recordCashMovement accepts and uses contraAccount. If not, use FinanceCore.resolvePartnerCapital directly (which already exists in treasury.ts line 282 for the PATCH case — apply same pattern to POST).

P2-3: analytics.ts /cost-by-field — Arabic-Only Movement Type Filter
File: src/api/inventory/analytics.ts


WHEN im.movement_type = 'صرف' THEN im.value_out
WHEN im.movement_type = 'اضافة' THEN im.value_in
Problem: After the governance.ts bug fix (Bug 1 in prior session), new movements use typed codes (GRN, ISSUE, TRANSFER_IN, etc.). The analytics endpoint still only matches Arabic literals, so all typed-code movements show zero cost in the field cost breakdown. Fields will appear to have no consumption costs for any movement posted after the governance fix.

Fix: Update both CASE expressions to also match typed codes:


WHEN im.movement_type IN ('صرف', 'ISSUE', 'COGS_ADJUSTMENT', 'TRANSFER_OUT', 'PRODUCTION_CONSUME') THEN im.value_out
WHEN im.movement_type IN ('اضافة', 'GRN', 'RETURN_CUSTOMER', 'ADJUSTMENT_PROFIT', 'TRANSFER_IN', 'PRODUCTION_OUTPUT') THEN im.value_in
P3 FINDINGS (Reliability / Edge Cases)
P3-1: integrity.ts — orphans Panel Naming Confusion
File: src/api/gl/integrity.ts

The /gl/orphans endpoint finds unbalanced entries (debit ≠ credit), not truly orphaned lines (lines with no parent entry). The HealthIntegrityPage subtitle says "Entries with unbalanced debit/credit" which is correct, but the endpoint name orphans conflicts with check #2 in /integrity-check which is called orphan_lines (lines with no parent entry). These are different things. Low risk but confusing during audits.

Fix: No code change needed, but consider renaming /gl/orphans to /gl/unbalanced-entries and updating web/src/api/gl.ts accordingly.

P3-2: processAllPendingOutbox — No Error Budget / Circuit Breaker
File: src/lib/process_outbox.ts

The cron handler catches and logs errors per company but continues iterating. A company with a corrupted outbox row that always throws will burn cron runs indefinitely. After 10 retries, jobs move to 'failed' status, but the cron worker has no alerting when failed count exceeds a threshold.

Fix: Low priority — add a Slack/email alert when failed > 0 in processAllPendingOutbox result aggregation.

P3-3: suppliers.ts — Fixed Asset Account Code Hardcoded
File: src/api/suppliers.ts


const assetAcct = '11030001' // Fixed equipment account
This ignores the posting_rules control account lookup for fixed_asset mapping key. If a company uses a different chart of accounts structure, all fixed asset purchases post to 11030001 regardless.

Covered by P0-1 fix — routing through FinanceCore will use resolveControlAccount properly.

Summary Table
ID	Severity	File	Issue	Fix
P0-1	P0	suppliers.ts:415	Fixed asset GL bypasses FinanceCore — no entry_number, no reconciliation linkage, hardcoded account	Replace with FinanceCore call
P0-2	P0	purchasing.ts:255	PO receive date hardcoded to today — PERIOD_LOCKED risk	Add received_date to schema, wire to modal
P0-3	P0	process_outbox.ts:140	processAllPendingOutbox misses stuck 'processing' companies	Add 'processing' to DISTINCT query
P1-1	P1	analytics.ts:87	Division by zero in consumption_pct	Use NULLIF(balance_qty, 0)
P1-2	P1	reconciliation.ts:38	source_documents table missing in production	Apply migrations 0027–0028
P1-3	P1	reconciliation.ts:32	sdl.journal_entry_id column name mismatch	Verify column name in migration, apply
P2-1	P2	inventory_posting.ts:150	Race condition in upsertInventoryBalance — concurrent writes lose delta	Add version optimistic lock check
P2-2	P2	treasury.ts:227	contraAccount field may be ignored in recordCashMovement — capital hits income not equity	Verify type, or use resolvePartnerCapital for POST
P2-3	P2	analytics.ts:23	Field cost analytics ignores typed movement codes (GRN, ISSUE, etc.) — shows zero cost	Add typed codes to CASE expressions
P3-1	P3	integrity.ts:249	/orphans endpoint name misleading — it finds unbalanced entries not orphan lines	Rename (optional)
P3-2	P3	process_outbox.ts:144	No alerting when outbox failed count exceeds threshold	Add alert hook
Immediate action required (today): P0-1, P0-2, P0-3, P2-3 — these are code fixes. P1-2 and P1-3 require applying pending migrations to production.

Shall I start fixing these now, beginning with P0-1 (suppliers.ts FinanceCore bypass) and P0-2 (PO receive hardcoded date)?









Inventory API Audit — src/api/inventory/ — All 9 Files
DIMENSION 1 — Posting System Compatibility
CRITICAL
D1-C1 · governance.ts:726 · CRITICAL
POST /gl-trace/:id/resolve with action='retry' inserts directly into inventory_posting_outbox without the idempotency_key column. Every other enqueueInventoryPostingOutbox call sets it. A missing idempotency_key violates the unique constraint and silently discards retries in some D1 versions.
Fix: Replace raw INSERT with enqueueInventoryPostingOutbox(db, companyId, 'inventory_movement', movId, payload).

HIGH
D1-H1 · movements.ts:331 · HIGH
recordCashMovement() fires for cash GRN purchases after the inventory movement is committed but before the GL outbox is processed. If recordCashMovement throws, the inventory row exists with no GL cash entry — cash/inventory desync with no compensating rollback.
Fix: Wrap both in a single db.batch() or call recordCashMovement inside the strict_sync GL block so both succeed or fail together.

D1-H2 · movements.ts:631 · HIGH
Same cash/GL desync as D1-H1 in POST /movements/batch — recordCashMovement fires after all inserts complete, independently of GL result.
Fix: Same pattern as D1-H1.

D1-H3 · adjustments.ts:172 · HIGH
Adjustment post uses Arabic-only movementType = 'اضافة' | 'صرف' literals (lines 172, 191–194) instead of typed codes. FinanceCore.resolveInventoryMovement and posting_engine both now expect typed codes (GRN/ISSUE). Arabic literals will hit the wrong GL branch (inbound vs outbound direction resolution may fail or use fallback).
Fix: Map: l.difference > 0 ? 'ADJUSTMENT_PROFIT' : 'ADJUSTMENT_LOSS' to match SUPPORTED_MOVEMENT_TYPES.

D1-H4 · adjustments.ts:176–179 · HIGH
Adjustment post reads balance with a raw SELECT ... FROM inventory_balances (line 176) instead of readInventoryBalance(). This bypasses the staleness self-heal — a stale snapshot will cause the wrong opening balance, wrong unit price, and therefore wrong GL value.
Fix: Replace with await readInventoryBalance(c.env.DB, company_id, l.item_code, warehouseName).

MEDIUM
D1-M1 · adjustments.ts:80 · MEDIUM
PUT /adjustments/:id/lines deletes then re-inserts adjustment lines with DELETE FROM inventory_adjustment_lines WHERE adjustment_id = ? (line 80) — no company_id filter on the DELETE. The adjustment_id is a primary key but the prior ownership check is company-isolated. Low exploitability but inconsistent pattern.
Fix: Add AND adjustment_id IN (SELECT id FROM inventory_adjustments WHERE company_id = ?) to DELETE, or rely on the adj.status check above it.

D1-M2 · governance.ts:727–735 · MEDIUM
POST /gl-trace/:id/resolve retry path uses ON CONFLICT(company_id, movement_id) DO UPDATE — but the outbox table's unique key is idempotency_key, not (company_id, movement_id). The conflict clause will silently insert a duplicate or fail depending on schema.
Fix: Use enqueueInventoryPostingOutbox which sets the correct idempotency_key.

DIMENSION 2 — Data Integrity
CRITICAL
D2-C1 · adjustments.ts:187–188 · CRITICAL
POST /adjustments/:id/post checks absQty > prevQty for outbound adjustments (current balance), but has no FUTURE_NEGATIVE_STOCK check. Posting a write-down adjustment today will corrupt all future movement running balances if there are future movements for that item.
Fix: Add the same MIN(balance_qty) lookahead query used in movements.ts:170–183.

D2-C2 · movements.ts:446 · CRITICAL
POST /movements/batch checks li.quantity > prevQty (current balance) but has no FUTURE_NEGATIVE_STOCK check for any outbound line. Single POST /movements does this check (lines 170–183); batch does not.
Fix: Add future-negative check for each outbound line before the lineResults.push call, same query as single-movement endpoint.

HIGH
D2-H1 · adjustments.ts:223–226 · HIGH
upsertInventoryBalance() is called without any expectedVersion / optimistic lock. The adjustment loops line-by-line with serial INSERTs — a concurrent adjustment post for the same item×warehouse will silently overwrite with a stale value.
Fix: Read current version before INSERT, pass as expectedVersion, check changes() === 0 and retry from ledger. (Also applies to all callers — see D2-H2 to D2-H4.)

D2-H2 · movements.ts:260 · HIGH
upsertInventoryBalance() in POST /movements (single) — no optimistic lock.
Fix: Same as D2-H1.

D2-H3 · movements.ts:553 · HIGH
upsertInventoryBalance() in POST /movements/batch — no optimistic lock. Batch is the highest-risk call site since it calls upsert in a loop after db.batch(insertStmts), so concurrent batches can interleave.
Fix: Same as D2-H1; additionally consider moving all upsertInventoryBalance calls inside the atomic db.batch().

D2-H4 · movements.ts:772–778 · HIGH
upsertInventoryBalance() in POST /movements/transfer — no optimistic lock. Two concurrent single-item transfers of the same item produce a race between the OUT and IN balance writes.
Fix: Same as D2-H1.

D2-H5 · movements.ts:911 · HIGH
transfer-batch reads srcBal inside the loop but the loop then batches all INSERTs in a single db.batch(stmts) at line 963. The balance snapshot for item i+1 was read before item i's TRANSFER_OUT was committed — so if two items transfer from the same warehouse, item i+1's balance read is stale (doesn't account for item i's deduction). This is inherent to pre-computing all balances before the batch write.
Fix: Either process items sequentially (one item per batch), or post-commit recompute balances from the ledger via readInventoryBalance for all affected items.

MEDIUM
D2-M1 · adjustments.ts:42–61 · MEDIUM
POST /adjustments (create draft) uses sequential individual INSERTs for header then lines, not db.batch(). The header can exist without lines if the process crashes between the two writes.
Fix: The lines are inserted with db.batch(lineStmts) (line 59) which is correct, but the header INSERT is sequential before it. No atomic wrapper. Acceptable since it's a draft, but worth noting.

D2-M2 · movements.ts:248–253 · MEDIUM
Single-movement post does the inventory_movements INSERT and the cascade UPDATE balance_qty in a db.batch() — good. But if the movement INSERT succeeds and the cascade UPDATE fails (D1 partial batch), the running balances in subsequent rows diverge. D1 batch() is not a transaction; it is a pipeline.
Fix: Document this known D1 limitation or use D1 batch() with PRAGMA journal_mode=WAL awareness. (Low fix priority since Cloudflare D1 processes batch statements sequentially in practice.)

DIMENSION 3 — Multi-Tenant Safety
CRITICAL
D3-C1 · balances.ts:169–177 · CRITICAL
GET /movement-types has no company_id filter. movement_types is a reference table, but if it becomes company-seeded in the future, this leaks all companies' movement types. More critically, the endpoint has no permissionGuard — any authenticated user (including from another company) can call it. Auth bypass.
Fix: Add permissionGuard('inventory', 'read') — already present on adjacent endpoints.

Note: movement_types is currently a shared reference table so data leakage is not immediate, but the missing auth guard is a CRITICAL pattern violation regardless.

HIGH
D3-H1 · adjustments.ts:131–133 · HIGH
POST /adjustments/:id/post queries warehouse name with SELECT name FROM warehouses WHERE id = ? (line 131) — no company_id filter. An attacker can supply a warehouse_id from a different company and the adjustment will post with that company's warehouse name and potentially the wrong GL posting setup.
Fix: Add AND company_id = ? to the warehouses lookup.

D3-H2 · adjustments.ts:135–137 · HIGH
SELECT * FROM inventory_adjustment_lines WHERE adjustment_id = ? (line 135) has no company_id filter. The adjustment_id came from the prior ownership check, but explicit company_id filters on all queries is mandatory in a multi-tenant system.
Fix: Add AND adjustment_id IN (SELECT id FROM inventory_adjustments WHERE company_id = ?) or join.

MEDIUM
D3-M1 · governance.ts:700–704 · MEDIUM
POST /gl-trace/:id/resolve queries inventory_movements WHERE company_id = ? AND id = ? — correctly isolated. However the subsequent outbox INSERT at line 727 does not re-check that movement_id belongs to company_id before inserting. A race between the ownership check and the INSERT (concurrent delete + re-insert) could allow cross-company outbox poisoning.
Fix: Add AND company_id = ? to the outbox INSERT WHERE clause (or use enqueueInventoryPostingOutbox which includes it).

DIMENSION 4 — API Completeness vs Posting System
HIGH
D4-H1 · adjustments.ts · HIGH — No period check on draft creation
POST /adjustments (create draft, line 27) enforces inventory lock date but has no getOpenPeriod check. An adjustment can be created for a closed GL period and will only fail at post-time (line 143). If users create many draft adjustments for a closed period, they pile up with no early warning.
Fix: Add getOpenPeriod check at draft creation, or at minimum a ? pre-flight warning in the response.

D4-H2 · movements.ts · HIGH — PRODUCTION_INPUT and PRODUCTION_OUTPUT have no specialized handler
SUPPORTED_MOVEMENT_TYPES includes PRODUCTION_INPUT / PRODUCTION_OUTPUT (lines 24–26) and resolveMovementDirection presumably handles them. But FinanceCore must distinguish production from purchase for correct GL (WIP DR vs Inventory DR). The generic resolveInventoryMovement path may not post WIP correctly for these types.
Fix: Confirm FinanceCore.resolveInventoryMovement handles PRODUCTION_INPUT/PRODUCTION_OUTPUT with WIP accounts, or add dedicated routing.

D4-H3 · movements.ts:910–911 · HIGH — transfer-batch division by zero
const avgPrice = srcBal.balance_value / srcBal.balance_qty (line 911) — no NULLIF guard. If balance_qty === 0 (item exists in snapshot with zero qty), produces Infinity or NaN, which D1 stores as NULL, silently zeroing the transfer value.
Fix: const avgPrice = srcBal.balance_qty > 0 ? srcBal.balance_value / srcBal.balance_qty : 0

MEDIUM
D4-M1 · movements.ts · MEDIUM — No RETURN_SUPPLIER GL handler path confirmed
RETURN_SUPPLIER is in SUPPORTED_MOVEMENT_TYPES. A supplier return should reverse AP (DR AP / CR Inventory) but the generic resolveInventoryMovement treats it as outbound (DR COGS / CR Inventory). No dedicated FinanceCore path exists for supplier returns.
Fix: Add RETURN_SUPPLIER to the inbound-with-credit-AP branch in FinanceCore.resolveInventoryMovement, or add a dedicated resolveSupplierReturn function.

D4-M2 · receipts.ts vs purchasing.ts · MEDIUM — Duplicate receive-PO endpoints
POST /inventory/receive-po/:po_id (receipts.ts) and POST /finance/purchasing/:id/receive (purchasing.ts) both call FinanceCore.processPOReceipt. No deduplication guard between them — posting the same PO through both paths creates double inventory movements.
Fix: Remove receipts.ts endpoint or add a PO-level idempotency check (e.g. po.status === 'received' blocks both endpoints consistently).

D4-M3 · governance.ts · MEDIUM — PATCH /posting-controls missing period-check
Changing locked_through_date to a past date reopens a locked inventory period with no confirmation, no GL-period check, and no audit log entry.
Fix: Add logAudit call on lock date change; consider requiring a reason field.

Final Count
Severity	Count	Files
CRITICAL	3	governance.ts (D1-C1), adjustments.ts (D2-C1), movements.ts (D2-C2)
HIGH	12	movements.ts (D1-H1, D1-H2, D2-H2, D2-H3, D2-H4, D2-H5, D4-H2, D4-H3), adjustments.ts (D1-H3, D1-H4, D3-H1, D3-H2)
MEDIUM	8	adjustments.ts (D1-M1, D2-M1, D4-H1), movements.ts (D1-M2, D2-M2, D4-M1, D4-M2), governance.ts (D1-M2, D3-M1, D4-M3)
3 CRITICAL, 12 HIGH, 8 MEDIUM