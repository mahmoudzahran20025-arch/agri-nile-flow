# Enterprise Blueprints

## Scope
This document defines two enterprise-grade design blueprints required for functional completeness:
1. Fixed Assets lifecycle and depreciation scheduler.
2. Batch/Lot traceability with FEFO governance.

---

## Blueprint A: Fixed Assets

### A1. Objectives
- Register every capital asset by company with full audit trail.
- Support capitalization, transfer, impairment, revaluation, and disposal.
- Automate monthly depreciation posting into GL with period controls.
- Provide reconciliation views from asset register to GL balances.

### A2. Domain Model
Core tables (multi-tenant by company_id):
- fixed_assets
  - id, company_id, asset_code, asset_name, asset_class_id, branch_id, center_code
  - acquisition_date, in_service_date, acquisition_cost, residual_value
  - useful_life_months, depreciation_method, status
  - gl_asset_account, gl_dep_expense_account, gl_accum_dep_account
  - created_by, updated_by, created_at, updated_at
- fixed_asset_classes
  - id, company_id, code, name, default_useful_life_months, default_dep_method
  - default_gl_asset_account, default_gl_dep_expense_account, default_gl_accum_dep_account
- fixed_asset_events
  - id, company_id, asset_id, event_type, event_date, amount, notes, payload_json, created_by
  - event_type: ACQUIRE, CAPITALIZE, TRANSFER, IMPAIR, REVALUE_UP, REVALUE_DOWN, DISPOSE, RESTORE
- fixed_asset_depreciation_schedule
  - id, company_id, asset_id, period_id, period_start, period_end
  - depreciation_amount, posted_journal_entry_id, status, run_id
- fixed_asset_depreciation_runs
  - id, company_id, period_id, started_at, completed_at, status, created_by
  - status: draft, posted, failed, rolled_back

Indexes (high priority):
- fixed_assets(company_id, asset_code) unique
- fixed_assets(company_id, status, in_service_date)
- fixed_asset_events(company_id, asset_id, event_date)
- fixed_asset_depreciation_schedule(company_id, period_id, status)

### A3. Lifecycle States
- draft: created, not capitalized.
- active: in service, depreciating.
- suspended: temporarily inactive, no depreciation.
- disposed: removed from service.

Allowed transitions:
- draft -> active
- active -> suspended
- suspended -> active
- active -> disposed
- suspended -> disposed

### A4. Depreciation Engine
Monthly close flow:
1. Load open period by company and month.
2. Select eligible assets (status=active, in_service_date <= period_end).
3. Compute depreciation by method:
   - Straight-line: (cost - residual) / useful_life_months
   - Declining-balance: opening_nbv * rate
   - Units-of-production (optional extension): period_usage * rate_per_unit
4. Round by currency policy, accumulate remainder on final period.
5. Create schedule rows with deterministic run_id.
6. Post GL atomic batch per asset-group or class-group:
   - Dr depreciation expense
   - Cr accumulated depreciation
7. Store posted journal_entry_id; mark schedule posted.
8. Emit audit event DEPRECIATION_POSTED.

Idempotency:
- Unique key on (company_id, asset_id, period_id).
- Rerun with same run_id performs no duplicate posting.

### A5. Disposal Accounting
On disposal date:
1. Freeze further depreciation.
2. Compute NBV = acquisition_cost + capitalized_additions - accumulated_depreciation - impairments.
3. Compare proceeds vs NBV.
4. Post GL entries:
   - Remove asset cost and accumulated depreciation.
   - Record cash/receivable proceeds.
   - Record gain/loss on disposal.
5. Mark asset status disposed.

### A6. API Contracts
Routes (all guarded by auth + roleGuard + finance permissions):
- POST /api/assets
- PATCH /api/assets/:id
- GET /api/assets
- POST /api/assets/:id/events
- POST /api/assets/depreciation/run
- POST /api/assets/depreciation/:runId/post
- POST /api/assets/:id/dispose
- GET /api/assets/reports/reconciliation

### A7. Controls
- Hard period lock: no posting into closed periods.
- Mapping completeness checks before posting.
- Currency precision and rounding policy per company.
- Soft-delete forbidden; status transitions only.
- Full event-sourcing style timeline via fixed_asset_events.

---

## Blueprint B: Batch Tracking + FEFO

### B1. Objectives
- Track inventory by lot/batch from inbound to outbound.
- Enforce FEFO (First-Expire-First-Out) for perishable items.
- Enable forward and backward traceability for quality recalls.
- Integrate lot movement values with inventory and GL.

### B2. Domain Model
Core tables (company_id required):
- item_lots
  - id, company_id, item_code, lot_no, supplier_code, source_doc_type, source_doc_id
  - received_date, expiry_date, production_date
  - qty_received, qty_available, unit_cost, total_cost
  - quality_status, quarantine_flag, warehouse, created_by, created_at
- lot_movements
  - id, company_id, lot_id, movement_date, movement_type, qty_in, qty_out
  - unit_cost, value_in, value_out, ref_type, ref_id, warehouse, created_by
- lot_allocations
  - id, company_id, outbound_ref_type, outbound_ref_id, lot_id, qty_allocated
  - allocation_strategy, created_at
- lot_quality_events
  - id, company_id, lot_id, event_type, event_date, notes, created_by
  - event_type: PASS, HOLD, RELEASE, REJECT, RECALL

Indexes (high priority):
- item_lots(company_id, item_code, expiry_date, qty_available)
- item_lots(company_id, lot_no)
- lot_allocations(company_id, outbound_ref_type, outbound_ref_id)
- lot_movements(company_id, lot_id, movement_date)

### B3. FEFO Allocation Algorithm
Preconditions:
- item is batch-tracked.
- lot has quality_status=PASS and quarantine_flag=0.
- qty_available > 0.

Selection order:
1. Earliest expiry_date ascending.
2. Then earliest received_date.
3. Then smallest lot id for deterministic ties.

Allocation flow:
1. Start transaction.
2. Read candidate lots using strict company_id + item_code + warehouse.
3. Allocate required quantity across lots in FEFO order.
4. Insert lot_allocations rows.
5. Update qty_available on each lot.
6. Insert lot_movements for each split.
7. Commit or rollback fully.

Failure behavior:
- If total qty_available is insufficient, abort without partial allocation.

### B4. Traceability Queries
Backward trace (sale -> lots -> inbound docs):
- outbound document -> lot_allocations -> item_lots(source_doc_type/source_doc_id).

Forward trace (lot -> all outbound consumers):
- item_lots -> lot_allocations -> outbound refs (sales, transfers, issues).

Recall workflow:
1. Mark lot_quality_events RECALL.
2. Block new allocations for recalled lot.
3. Generate impacted outbound references list.
4. Trigger operational notifications and hold transactions.

### B5. GL Integration
Inbound lot receipt:
- Dr Inventory
- Cr GRNI/AP (per PO flow)

Outbound lot issue:
- Dr COGS/expense
- Cr Inventory

Lot adjustments (expiry write-off, shrinkage):
- Dr Inventory Loss
- Cr Inventory

All postings reference lot_id in ref payload for audit traceability.

### B6. API Contracts
- POST /api/inventory/lots/receive
- GET /api/inventory/lots
- POST /api/inventory/lots/:id/quality
- POST /api/inventory/lots/allocate
- GET /api/inventory/lots/:id/trace
- POST /api/inventory/lots/:id/recall

### B7. Controls
- No negative lot balance allowed.
- Company isolation on every lot join and allocation write.
- FEFO exception requires explicit override reason and elevated role.
- Quarantine lots cannot be allocated.

---

## Rollout Plan (Both Blueprints)
1. Phase 1: Schema + indexes + read APIs.
2. Phase 2: Posting engines with idempotency keys.
3. Phase 3: UI workflows and exception handling.
4. Phase 4: Reconciliation dashboards and alerting.
5. Phase 5: Controlled pilot per company, then full rollout.
