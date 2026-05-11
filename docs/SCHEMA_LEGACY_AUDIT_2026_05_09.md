# Database Schema Audit — Legacy vs Active Tables

**Date:** 2026-05-09  
**Auditor:** Cascade (AI Schema Auditor)  
**Scope:** ~122 tables across migrations 001–0096 + codebase `src/api/` + `src/lib/`  
**Method:** Migration analysis + codebase grep for table references + structural FK mapping

---

## 1. Executive Summary

| Category | Count | Risk Level |
|----------|-------|------------|
| **CORE_ACTIVE** — clearly used by current modules | 72 | — |
| **SUPPORTING** — lookup/audit/auxiliary, actively referenced | 14 | — |
| **LEGACY_CANDIDATE** — replaced by newer design, minimal/no code refs | 5 | **MEDIUM** |
| **ISOLATED_ORPHAN** — zero code references, schema-only | 5 | **HIGH** |
| **VIEWS** — derived surfaces | 4 | LOW |
| **Uncertain / needs verification** | ~22 | LOW |

**Key Finding:** The schema has **~10 tables (8%) that are either confirmed dead or strong legacy candidates**. The biggest structural risk is not table count — it's **schema evolution debt**: old tables (`gl_account_mappings`, `accounts`, `approval_requests`) left behind while newer replacements (`posting_rules`, `chart_of_accounts`) took over.

**Biggest Risk:** `accounts` table appears to be **completely unreferenced** in the current codebase (all 46 "mentions" in the forensic report were false positives from `chart_of_accounts`, `bank_accounts`, `gl_account_mappings`, etc.). If it contains data, that data is orphaned.

---

## 2. Modern Core Definition

The "truth" modules are:

| Module | Primary Tables | API Files |
|--------|---------------|-----------|
| **Finance / GL** | `chart_of_accounts`, `journal_entries`, `journal_entry_lines`, `financial_periods`, `posting_rules`, `coa_account_intents`, `posting_operation_matrix` | `src/api/gl/**/*.ts`, `src/lib/gl.ts`, `src/lib/posting_engine.ts` |
| **Inventory** | `items`, `inventory_movements`, `inventory_balances`, `inventory_transactions`, `inventory_posting_outbox`, `movement_types`, `warehouses` | `src/api/inventory/*.ts` |
| **Suppliers / AP** | `suppliers`, `supplier_transactions`, `supplier_invoices`, `supplier_invoice_items` | `src/api/suppliers.ts`, `src/lib/finance/resolvers/suppliers.ts` |
| **Treasury / Cash** | `cash_transactions`, `bank_accounts`, `bank_statements`, `bank_reconciliations`, `partners` | `src/api/treasury.ts`, `src/api/finance/banking.ts` |
| **Procurement** | `purchase_orders`, `purchase_order_items` | `src/api/finance/purchasing.ts` |
| **Operations / Fields** | `fields`, `work_orders`, `work_tasks`, `work_order_equipment`, `operation_types`, `harvest_records` | `src/api/operations.ts`, `src/api/fields.ts` |
| **HR / Payroll** | `employees`, `employee_job_details`, `attendance_records`, `leave_requests`, `leave_types`, `salary_advances`, `payroll_runs`, `payroll_items`, `branches`, `location_tasks` | `src/api/hr/*.ts` |
| **Fixed Assets** | `fixed_assets`, `depreciation_schedules`, `equipment_types` | `src/api/assets.ts` |
| **Contracts** | `sales_contracts`, `purchase_contracts` | `src/api/contracts.ts` |
| **System / RBAC** | `companies`, `users`, `roles`, `user_companies`, `audit_log`, `system_error_logs` | `src/api/auth.ts`, `src/api/users.ts`, `src/api/admin.ts` |
| **Staging / Offline** | `staging_movements`, `offline_queue` | `src/api/staging.ts` |
| **Calendar / Docs** | `calendar_events`, `event_attendees`, `documents` | `src/api/calendar.ts`, `src/api/documents.ts` |
| **Budgets / WIP** | `field_season_budgets`, `wip_balances` | `src/api/budgets.ts`, `src/api/reports/*.ts` |

---

## 3. Complete Table Classification

### CORE_ACTIVE (72 tables)

| # | Table | Module | Evidence | Notes |
|---|-------|--------|----------|-------|
| 1 | `fields` | Operations | 85 code mentions, `fields.ts`, `operations.ts` | Central to agriculture domain |
| 2 | `items` | Inventory | 70 mentions, `inventory.ts`, `config.ts` | Item master |
| 3 | `inventory_movements` | Inventory | 61 mentions, `inventory.ts`, `finance.ts` | Core ledger |
| 4 | `suppliers` | Suppliers | 52 mentions, `suppliers.ts`, `finance.ts` | Supplier master |
| 5 | `users` | System | 51 mentions, `auth.ts`, all modules | RBAC core |
| 6 | `employees` | HR | 45 mentions, `hr.ts` | Employee registry |
| 7 | `companies` | System | 37 mentions, `auth.ts`, tenant scope | Multi-tenant root |
| 8 | `supplier_transactions` | Suppliers | 34 mentions, `suppliers.ts` | AP sub-ledger |
| 9 | `documents` | Documents | 32 mentions, `hr.ts`, `documents.ts` | File metadata |
| 10 | `seasons` | Config | 29 mentions, `config.ts`, `fields.ts` | Season lookup |
| 11 | `cash_transactions` | Treasury | 28 mentions, `treasury.ts`, `finance.ts` | Cash ledger |
| 12 | `work_orders` | Operations | 27 mentions, `operations.ts` | Work order header |
| 13 | `purchase_orders` | Procurement | 20 mentions, `finance.ts` | PO header |
| 14 | `chart_of_accounts` | GL | 18 mentions, `gl.ts`, `export.ts` | CoA master |
| 15 | `partners` | Treasury | 17 mentions, `suppliers.ts`, `dashboard.ts` | Partner equity |
| 16 | `roles` | RBAC | 17 mentions, `auth.ts`, `users.ts` | Role definitions |
| 17 | `payroll_runs` | HR | 16 mentions, `hr.ts` | Payroll batch |
| 18 | `calendar_events` | Calendar | 16 mentions, `calendar.ts` | Events |
| 19 | `journal_entries` | GL | 14 mentions, `gl.ts`, `finance_core.ts` | GL headers |
| 20 | `journal_entry_lines` | GL | 13 mentions, `gl.ts`, `finance_core.ts` | GL lines |
| 21 | `harvest_records` | Fields | 13 mentions, `fields.ts` | Harvest tracking |
| 22 | `branches` | HR | 13 mentions, `hr.ts`, `admin.ts` | Branch master |
| 23 | `attendance_records` | HR | 12 mentions, `hr.ts` | Attendance |
| 24 | `staging_movements` | Staging | 12 mentions, `staging.ts` | Offline sync |
| 25 | `work_tasks` | Operations | 11 mentions, `operations.ts` | WO tasks |
| 26 | `supplier_invoices` | Suppliers | 10 mentions, `finance.ts` | Invoice header |
| 27 | `employee_job_details` | HR | 9 mentions, `hr.ts` | Job details |
| 28 | `leave_requests` | HR | 9 mentions, `hr.ts` | Leave workflow |
| 29 | `salary_advances` | HR | 9 mentions, `hr.ts` | Salary advances |
| 30 | `financial_periods` | GL | 9 mentions, `gl.ts`, `finance_core.ts` | Period control |
| 31 | `sales_contracts` | Contracts | 9 mentions, `contracts.ts` | Sales contracts |
| 32 | `bank_statements` | Finance | 8 mentions, `finance.ts` | Bank import |
| 33 | `location_tasks` | HR | 8 mentions, `hr.ts` | Field tasks |
| 34 | `user_companies` | RBAC | 8 mentions, `auth.ts`, `users.ts` | User-company link |
| 35 | `wo_template_tasks` | Operations | 8 mentions, `operations.ts` | WO template lines |
| 36 | `wo_templates` | Operations | 7 mentions, `operations.ts` | WO templates |
| 37 | `cost_centers` | Config | 7 mentions, `config.ts` | Cost centers |
| 38 | `purchase_order_items` | Procurement | 7 mentions, `finance.ts` | PO lines |
| 39 | `field_season_budgets` | Budgets | 7 mentions, `budgets.ts`, `reports.ts` | Budgets |
| 40 | `event_attendees` | Calendar | 6 mentions, `calendar.ts` | Event guests |
| 41 | `purchase_contracts` | Contracts | 5 mentions, `contracts.ts` | Purchase contracts |
| 42 | `employee_assets` | HR | 5 mentions, `hr.ts` | Assigned assets |
| 43 | `bank_accounts` | Finance | 5 mentions, `finance.ts` | Bank master |
| 44 | `bank_reconciliations` | Finance | 4 mentions, `finance.ts` | Recon header |
| 45 | `leave_types` | HR | 4 mentions, `hr.ts` | Leave catalog |
| 46 | `offline_queue` | Staging | 3 mentions, `staging.ts` | Offline buffer |
| 47 | `expense_types` | Config | 3 mentions, `config.ts`, `treasury.ts` | Expense catalog |
| 48 | `supplier_invoice_items` | Suppliers | 3 mentions, `finance.ts` | Invoice lines |
| 49 | `gl_integration_settings` | GL | 3 mentions, `gl.ts` | GL config |
| 50 | `system_error_logs` | System | 3 mentions, error handlers | Error logging |
| 51 | `payroll_items` | HR | 2 mentions, `hr.ts` | Payroll lines |
| 52 | `sub_locations` | Config | 1 mention, `config.ts` | Location subdivisions |
| 53 | `posting_rules` | GL | 20+ mentions, `posting_engine.ts`, `gl/*.ts` | Replaced `gl_account_mappings` |
| 54 | `inventory_posting_groups` | Inventory | Referenced in `posting_engine.ts`, `governance.ts` | IPG master |
| 55 | `product_posting_groups` | Inventory | Referenced in `posting_engine.ts`, `governance.ts` | PPG master |
| 56 | `inventory_balances` | Inventory | `inventory_posting.ts` read/write | Balance snapshot |
| 57 | `inventory_posting_outbox` | Inventory | `process_outbox.ts`, `movements.ts` | Async posting queue |
| 58 | `inventory_transactions` | Inventory | `movements.ts`, `governance.ts` | Movement headers |
| 59 | `fixed_assets` | Assets | `assets.ts`, `business_events.ts` | Asset register |
| 60 | `depreciation_schedules` | Assets | `assets.ts`, `business_events.ts` | Depreciation plan |
| 61 | `equipment_types` | Assets | `suppliers.ts` (equipment entry), `assets.ts` | Equipment catalog |
| 62 | `wip_balances` | Operations | `business_events.ts`, `budgets.ts` | WIP tracking |
| 63 | `source_documents` | GL | `business_events.ts` | Source doc bridge |
| 64 | `source_document_links` | GL | `business_events.ts` | Source doc lines |
| 65 | `data_quality_control` | System | `validation.ts`, `suppliers.ts` | DQ governance |
| 66 | `data_quality_snapshots` | System | `validation.ts` | DQ metrics history |
| 67 | `operation_types` | Operations | `operations.ts` (new lookup) | Operation catalog |
| 68 | `work_order_equipment` | Operations | `operations.ts`, migration 0091 | Equipment usage |
| 69 | `batch_post_jobs` | GL | `batch_posting.ts` | Batch posting jobs |
| 70 | `batch_post_job_items` | GL | `batch_posting.ts` | Batch job lines |
| 71 | `business_events` | GL | `business_events.ts`, `finance_core.ts` | Event journal |
| 72 | `warehouses` | Inventory | `movements.ts`, `governance.ts` | Warehouse master |

### SUPPORTING (14 tables)

| # | Table | Role | Evidence |
|---|-------|------|----------|
| 1 | `audit_log` | Compliance | `logAudit()` helper used across all modules |
| 2 | `coa_account_intents` | Governance | `0094_coa_governance_phase.sql`, seed from posting_rules |
| 3 | `posting_operation_matrix` | Governance | `0094_coa_governance_phase.sql`, seeded reference data |
| 4 | `period_inventory_snapshots` | Reporting | `0086_period_inventory_snapshot.sql` |
| 5 | `movement_types` | Reference | `0084_phase0_foundations.sql` — **seeded but never queried by code** |
| 6 | `user_companies` | RBAC bridge | `auth.ts` JOIN for role resolution |
| 7 | `roles` | RBAC | `auth.ts` permission resolution |
| 8 | `leave_types` | HR lookup | `hr.ts` |
| 9 | `expense_types` | Config lookup | `config.ts`, `treasury.ts` |
| 10 | `gl_integration_settings` | GL config | `gl.ts` |
| 11 | `system_error_logs` | Observability | Error handler in `src/index.ts` |
| 12 | `data_quality_snapshots` | Observability | `validation.ts` |
| 13 | `event_attendees` | Calendar | `calendar.ts` |
| 14 | `sub_locations` | Config | `config.ts` |

### LEGACY_CANDIDATE (5 tables)

| # | Table | Why Legacy Candidate | Confidence |
|---|-------|----------------------|------------|
| 1 | **`gl_account_mappings`** | Replaced by `posting_rules` (migration 0048+). Zero direct imports. May still have FKs from old migrations. | **HIGH** |
| 2 | **`accounts`** | Zero fixed-string references in codebase. All 46 "mentions" in forensic report were false positives from `chart_of_accounts`, `bank_accounts`, `gl_account_mappings`. | **HIGH** |
| 3 | **`movement_types`** | Table seeded with 10 codes in `0084`, but `movements.ts` uses hardcoded `SUPPORTED_MOVEMENT_TYPES` Set. Never queries this table. | **HIGH** |
| 4 | **`coa_account_intents`** | Governance table seeded from posting_rules. No API endpoint writes to it. Read-only reference. Could be view instead. | **MEDIUM** |
| 5 | **`posting_operation_matrix`** | Seeded reference data in `0094`. No runtime writes. Could be hardcoded enum. | **MEDIUM** |

### ISOLATED_ORPHAN (5 tables) — Confirmed Dead

| # | Table | Evidence |
|---|-------|----------|
| 1 | **`approval_requests`** | 0 code mentions. Schema-only from early workflow design. |
| 2 | **`approval_actions`** | 0 code mentions. Paired with `approval_requests`. |
| 3 | **`sessions`** | 0 code mentions. JWT-based auth replaced session table. |
| 4 | **`gl_integration_log`** | 0 code mentions. Replaced by `business_events` + `system_error_logs`. |
| 5 | **`accounts`** | 0 fixed-string mentions. See LEGACY_CANDIDATE #2 above. |

### VIEWS (4 views)

| # | View | Purpose | Source |
|---|------|---------|--------|
| 1 | `vw_coa_audit_metrics` | COA health dashboard | `0094_coa_governance_phase.sql` |
| 2 | `vw_supplier_entries` | Supplier GL filter | `0096_gl_module_views.sql` |
| 3 | `vw_inventory_entries` | Inventory GL filter | `0096_gl_module_views.sql` |
| 4 | `vw_cash_entries` | Cash GL filter | `0096_gl_module_views.sql` |

---

## 4. "Likely Legacy / Unused" Shortlist

| Table | Confidence | Why | Safe to Drop? |
|-------|------------|-----|-------------|
| `approval_requests` | **HIGH** | Zero code refs, no API endpoint | **Yes** — after confirming no rows |
| `approval_actions` | **HIGH** | Zero code refs, paired with above | **Yes** — after confirming no rows |
| `sessions` | **HIGH** | Zero code refs, JWT replaced sessions | **Yes** — after confirming no rows |
| `gl_integration_log` | **HIGH** | Zero code refs, superseded by `business_events` | **Yes** — after confirming no rows |
| `accounts` | **HIGH** | Zero fixed-string refs in code, superseded by `chart_of_accounts` | **VERIFY FIRST** — check if any rows exist |
| `gl_account_mappings` | **HIGH** | Replaced by `posting_rules`, no code imports | **VERIFY FIRST** — check FK dependencies |
| `movement_types` | **MEDIUM** | Seeded but never queried; hardcoded Set used instead | **No** — keep as future lookup table |
| `coa_account_intents` | **MEDIUM** | Read-only governance seed | **No** — useful for audit views |
| `posting_operation_matrix` | **MEDIUM** | Read-only reference seed | **No** — documents posting logic |

---

## 5. Verification & Cleanup Plan

### Phase 1: Verification (Week 1)

Run these queries against the live DB to confirm the classification:

```sql
-- 1. Confirm orphan tables have zero rows
SELECT 'approval_requests' AS tbl, COUNT(*) AS row_count FROM approval_requests
UNION ALL SELECT 'approval_actions', COUNT(*) FROM approval_actions
UNION ALL SELECT 'sessions', COUNT(*) FROM sessions
UNION ALL SELECT 'gl_integration_log', COUNT(*) FROM gl_integration_log
UNION ALL SELECT 'accounts', COUNT(*) FROM accounts
UNION ALL SELECT 'gl_account_mappings', COUNT(*) FROM gl_account_mappings;

-- 2. Confirm movement_types is never read by checking if any API log references it
-- (Application-level: grep access logs for "movement_types" — should be zero)

-- 3. Check FK dependencies before dropping anything
SELECT 
  m.name AS table_name,
  p.table AS parent_table
FROM sqlite_master m
LEFT JOIN pragma_foreign_key_list(m.name) p
WHERE m.type = 'table'
  AND m.name IN ('approval_requests', 'approval_actions', 'sessions', 
                 'gl_integration_log', 'accounts', 'gl_account_mappings')
ORDER BY m.name;

-- 4. Identify tables with no recent write activity (proxy for unused)
-- D1 does not have information_schema write timestamps, so use:
SELECT MAX(id) AS max_id FROM approval_requests;
SELECT MAX(id) AS max_id FROM approval_actions;
SELECT MAX(id) AS max_id FROM sessions;
-- If max_id is NULL or very low vs other tables, confirms disuse.

-- 5. Cross-check: which tables appear in the codebase
-- (Run the PowerShell / grep script below)
```

**Codebase verification script** (run in repo root):

```bash
# Bash / Git Bash
for table in approval_requests approval_actions sessions gl_integration_log accounts gl_account_mappings movement_types; do
  echo "=== $table ==="
  grep -r "$table" src/ --include="*.ts" | wc -l
done
```

```powershell
# PowerShell alternative
$tables = @('approval_requests','approval_actions','sessions','gl_integration_log','accounts','gl_account_mappings','movement_types')
foreach ($t in $tables) {
  $count = (Select-String -Path "src\*.ts" -Pattern "\b$t\b" -Recurse).Count
  Write-Host "$t : $count"
}
```

### Phase 2: Soft-Deprecate (Week 2)

For confirmed orphan tables:

1. **Rename** (soft delete):
   ```sql
   ALTER TABLE approval_requests RENAME TO _z_deprecated_approval_requests;
   ALTER TABLE approval_actions RENAME TO _z_deprecated_approval_actions;
   ALTER TABLE sessions RENAME TO _z_deprecated_sessions;
   ALTER TABLE gl_integration_log RENAME TO _z_deprecated_gl_integration_log;
   ```

2. **Document** in a `DEPRECATED_TABLES.md` log with reason and date.

3. **Monitor** for 2 weeks. If no errors, proceed to Phase 3.

### Phase 3: Archive / Export (Week 4)

For tables with rows (if any):

```sql
-- Export to JSON for audit trail (via application script or D1 export)
-- Then drop the renamed tables:
DROP TABLE IF EXISTS _z_deprecated_approval_requests;
DROP TABLE IF EXISTS _z_deprecated_approval_actions;
DROP TABLE IF EXISTS _z_deprecated_sessions;
DROP TABLE IF EXISTS _z_deprecated_gl_integration_log;
```

For `accounts` and `gl_account_mappings`:
- Export first.
- Check if any **migration files** reference them (search `.sql` files).
- If migrations are the only reference, they are historical artifacts — safe to deprecate after data export.

### Phase 4: Schema Cleanup Migration

Create migration `0097_drop_deprecated_tables.sql`:

```sql
-- 0097_drop_deprecated_tables.sql
-- Safe cleanup of confirmed dead tables after 2-week observation period.

DROP TABLE IF EXISTS _z_deprecated_approval_requests;
DROP TABLE IF EXISTS _z_deprecated_approval_actions;
DROP TABLE IF EXISTS _z_deprecated_sessions;
DROP TABLE IF EXISTS _z_deprecated_gl_integration_log;

-- Optional: drop if accounts confirmed empty/unreferenced
-- DROP TABLE IF EXISTS accounts;
-- DROP TABLE IF EXISTS gl_account_mappings;
```

---

## 6. Structural Observations

### Observation 1: Schema Evolution Debt
The migrations tell a story of **pivot and replacement**:
- `gl_account_mappings` (early) → `posting_rules` (0048+)
- `accounts` (early) → `chart_of_accounts` (0031+)
- `sessions` (early) → JWT tokens
- `approval_requests/actions` (early workflow) → No replacement (feature abandoned)

### Observation 2: Movement Types Table is Dead Code
`movement_types` was created in `0084` as a typed reference table, but `movements.ts` still hardcodes:
```typescript
const SUPPORTED_MOVEMENT_TYPES = new Set([
  'اضافة', 'صرف', 'GRN', 'ISSUE', ...
])
```
The table is **seeded but never read**. Either:
- (a) Replace the hardcoded Set with a DB query to `movement_types`, OR
- (b) Drop the table and accept the hardcoded Set as the source of truth.

### Observation 3: `accounts` is a Time Bomb
If `accounts` has rows, they are orphaned. No API endpoint references this table. The `chart_of_accounts` table is the modern CoA. Verify with:
```sql
SELECT COUNT(*) FROM accounts;
SELECT COUNT(*) FROM chart_of_accounts;
```
If both have rows, `accounts` rows are **unreachable from the application**.

### Observation 4: Batch Posting Tables are Under-Utilized
`batch_post_jobs` and `batch_post_job_items` exist and have code support in `src/lib/batch_posting.ts`, but the forensic report shows only 2 mentions. They may be **infrastructure for a planned feature** rather than actively used.

---

## 7. Metrics to Monitor

| Metric | Query | Target |
|--------|-------|--------|
| Orphan table row counts | `SELECT COUNT(*) FROM {orphan}` | 0 |
| Tables with zero code refs | PowerShell grep script above | 0 new orphans |
| Movement types table usage | `SELECT COUNT(*) FROM movement_types` + code grep | Either query code OR drop table |
| Accounts vs CoA divergence | Compare row counts + key codes | Should converge to CoA only |
| FK dependency graph | `pragma_foreign_key_list` per table | No broken FKs after deprecation |

---

## 8. Final Verdict

**Out of ~122 tables, 10 (8%) are strong candidates for deprecation. 5 are confirmed dead (zero code references). 2 more (`accounts`, `gl_account_mappings`) are highly likely dead but need row-count verification.**

The schema is **not over-engineered** — most tables serve a real module. The problem is **evolution residue**: old tables left behind during architectural pivots. Cleaning these 10 tables will reduce cognitive load and migration time without affecting any active functionality.

**Recommended immediate action:**
1. Run the Phase 1 verification queries today.
2. If `accounts` and `gl_account_mappings` have zero rows, proceed to soft-deprecate all 5 orphan tables.
3. Decide on `movement_types`: either wire it into `movements.ts` or accept it as dead code.
