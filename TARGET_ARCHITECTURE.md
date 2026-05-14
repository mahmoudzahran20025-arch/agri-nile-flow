# TARGET ARCHITECTURE
## Agri-Nile Flow ERP — Operations-First SaaS Platform
### Controlled Architectural Refactor Plan

**Document Authority:** Principal ERP Architect + Senior Financial Systems Engineer
**Date:** 2026-05-14
**Status:** PHASES A–E COMPLETE — REFACTOR CLOSED 2026-05-14 ✓
**Supersedes:** SAAS_REFACTORING_MASTER_PLAN.md (plan level) — this document is the engineering-level contract

---

## PART 1 — DOMAIN CONTRACTS

### 1.1 Authoritative Source Per Transaction Type

Every transaction in the system has exactly one authoritative source. No exceptions.

| Transaction Type          | Arabic                   | Authoritative Source Table      | GL Owner            | Sub-Ledger Owner          |
|---------------------------|--------------------------|---------------------------------|---------------------|---------------------------|
| Inventory Receipt         | استلام مخزن (GRN)        | `inventory_movements`           | outbox → GL         | `inventory_balances`      |
| Inventory Issue           | صرف مخزن (ISSUE)         | `inventory_movements`           | outbox → GL         | `inventory_balances`      |
| Supplier Invoice          | فاتورة مورد              | `supplier_transactions`         | sync → GL           | `supplier_ap_ledger` (new)|
| Supplier Payment          | سداد مورد                | `supplier_transactions`         | sync → GL           | `supplier_ap_ledger` (new)|
| Cash Expense              | مصروف نقدي               | `cash_transactions`             | sync → GL           | none (GL is authoritative)|
| Equity Injection          | حقن رأس مال              | `cash_transactions`             | sync → GL           | `partners`                |
| Work Order Cost           | تكلفة أمر عمل            | `work_orders` / `work_tasks`    | sync → GL on COSTED | `work_orders.total_cost`  |
| Equipment Rental          | ميكنة مستأجرة            | `supplier_transactions`         | sync → GL           | `supplier_ap_ledger`      |
| Depreciation              | إهلاك                    | `fixed_assets` / schedule       | sync → GL (monthly) | `depreciation_schedules`  |
| Harvest Revenue           | إيراد حصاد               | `harvest_records`               | sync → GL           | none                      |
| WIP Carry-Forward         | أعمال تحت التنفيذ        | `wip_balances`                  | sync → GL           | `wip_balances`            |
| Payroll                   | مرتبات                   | `payroll_runs`                  | sync → GL           | `employees`               |

**Rule:** If a business event is not represented in the authoritative source table first, it does not exist. The GL is always derived — never the origin.

---

### 1.2 Ownership Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 0 — MASTER DATA (Never touched by posting flows)         │
│  chart_of_accounts, posting_rules, service_types,               │
│  supplier_service_map, unit_types, items, fields, seasons,      │
│  cost_centers, business_posting_groups, product_posting_groups  │
└─────────────────────────────────────────────────────────────────┘
            ↓ Read-only by all operational layers
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — OPERATIONAL EVENTS (Source of Truth)                 │
│  inventory_movements, supplier_transactions,                     │
│  cash_transactions, work_orders, work_tasks,                    │
│  work_order_equipment, harvest_records                          │
│                                                                 │
│  OWNERSHIP: Domain API modules (suppliers.ts, movements.ts,     │
│  treasury.ts, operations.ts)                                    │
│  RULE: Only these modules write to these tables.                │
└─────────────────────────────────────────────────────────────────┘
            ↓ Consumed by posting pipeline only
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2 — POSTING PIPELINE (Read + Write GL only)              │
│  inventory_posting_outbox → batch_posting                       │
│  FinanceCore resolvers → postFromBusinessEvent                  │
│  posting_engine.ts (pure resolution, no writes)                 │
│                                                                 │
│  OWNERSHIP: src/lib/finance/, src/lib/posting_engine.ts         │
│  RULE: This layer reads Layer 1, writes Layer 3 only.           │
└─────────────────────────────────────────────────────────────────┘
            ↓ Writes to
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3 — FINANCIAL LEDGER (Immutable after posting)           │
│  journal_entries, journal_entry_lines, business_events          │
│                                                                 │
│  OWNERSHIP: postFromBusinessEvent() exclusively                 │
│  RULE: No API module writes here directly. Ever.                │
│  RULE: Reversals create NEW entries; never mutate posted rows.  │
└─────────────────────────────────────────────────────────────────┘
            ↓ Aggregated by
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4 — SUB-LEDGERS & REPORTING VIEWS                        │
│  inventory_balances, supplier_ap_ledger (new),                  │
│  wip_balances, cost_summaries (materialized)                    │
│                                                                 │
│  OWNERSHIP: Derived/maintained by posting pipeline              │
│  RULE: Never the source of truth. Always re-derivable.          │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1.3 Posting Responsibility

| Event Source           | Posts Synchronously?    | Posts via Outbox?   | Who Calls Posting          |
|------------------------|-------------------------|---------------------|----------------------------|
| Supplier invoice/pay   | YES — FinanceCore       | NO                  | suppliers.ts               |
| Cash transaction       | YES — FinanceCore       | NO                  | treasury.ts                |
| Inventory GRN/ISSUE    | NO                      | YES — outbox        | movements.ts → outbox      |
| Work Order COSTED      | YES — FinanceCore       | NO                  | operations.ts              |
| Depreciation (monthly) | YES — FinanceCore       | NO                  | GL batch job               |
| Harvest                | YES — FinanceCore       | NO                  | fields API                 |
| WIP carry-forward      | YES — FinanceCore       | NO                  | GL batch job               |
| Payroll                | YES — FinanceCore       | NO                  | hr/payroll.ts              |

**Target Rule:** The sync/async split for inventory is intentional and correct.
Inventory volumes are high and Cloudflare D1 has per-request statement limits.
The outbox pattern for inventory is KEEP. All other domain events are SYNC.

---

### 1.4 Settlement Responsibility

Settlement = the act of marking an open liability as matched/closed.

| Liability Type         | Open State                        | Settlement Trigger              | Settling Table              |
|------------------------|-----------------------------------|---------------------------------|-----------------------------|
| Supplier AP            | `supplier_transactions.is_matched=0` entry_type=invoice | Payment with `matched_payment_id` set | `supplier_transactions` (self-referential) |
| Inventory AP (GRN)     | GRN with cash_payment=false       | Supplier invoice referencing GRN | `supplier_transactions.invoice_ref` → GRN |
| Work Order open cost   | `work_orders.status != 'costed'`  | WO status transition to COSTED  | `work_orders.total_cost`    |
| Cash advance           | `contract_advances.status='open'` | Deduction from next payment     | `contract_advances`         |

---

## PART 2 — REFACTOR MAP

### 2.1 Module Disposition

#### KEEP (no structural changes)

| Module / File                        | Reason                                                           |
|--------------------------------------|------------------------------------------------------------------|
| `src/lib/posting_engine.ts`          | Correct cascade resolution. Production-grade. No changes.        |
| `src/lib/finance/` (all resolvers)   | Well-structured. Clean separation. Keep all resolver functions.  |
| `src/lib/inventory_posting.ts`       | Outbox pattern is architecturally correct for inventory volumes. |
| `src/lib/batch_posting.ts`           | Clean job infrastructure. Extend, don't replace.                 |
| `src/api/gl/hardening.ts`            | Maker-checker is correct. Keep as-is.                            |
| `src/api/gl/integrity.ts`            | Keep. Health checks must not be modified during refactor.        |
| `migrations/0100_*` (service_types)  | Service taxonomy is final. Keep seeded data.                     |
| `migrations/0108_*` (COGS + AP aging)| Correct schema additions. The columns are the right shape.       |

#### REFACTOR (correct the design, keep the intent)

| Module / File                     | Current Problem                                        | Target State                                                           |
|-----------------------------------|--------------------------------------------------------|------------------------------------------------------------------------|
| `src/api/suppliers.ts`            | 3 concerns in one file: CRUD, invoice posting, asset creation | Split into: `suppliers/master.ts`, `suppliers/invoices.ts`, `suppliers/payments.ts` |
| `src/api/inventory/movements.ts`  | normalizeIsoDate() duplicated; balance read/write logic duplicated | Extract `src/lib/date_utils.ts`; movements becomes thin orchestrator  |
| `src/api/treasury.ts`             | Partner capital logic mixed with cash transaction logic | Split `treasury/cash.ts` + `treasury/equity.ts`                       |
| `src/api/operations.ts`           | Equipment posting inline during WO equipment creation creates partial-state risk | Posting ONLY on WO status=COSTED transition; equipment records are always draft-cost until then |
| `src/lib/finance_core.ts`         | `recordCashMovement` aliased to `prepareCashMovement` — naming confusion | Remove alias. Callers use `prepareCashMovement` explicitly.            |
| `supplier_transactions` table     | AP aging columns added but no enforcement logic built  | Add `supplier_ap_ledger` view (derived); build match endpoint          |

#### REPLACE (keep the table, rebuild the API/logic)

| Module / File                     | Current Problem                                        | Replacement                                                            |
|-----------------------------------|--------------------------------------------------------|------------------------------------------------------------------------|
| `src/api/operations.ts` equipment posting path | `resolveWorkOrderLabor()` called on every equipment add — creates orphan GL entries if WO is later cancelled | Replace with: post GL only on WO→COSTED; equipment costs accumulate as `pending_gl_amount` not journal entries |
| Cash mirror for inventory GRN     | Cash mirror called in movements.ts then GL queued to outbox — atomicity gap: GL may post after cash mirror succeeds | Replace: cash_transactions written by outbox processor after GL posted, not before |

#### DEPRECATE (freeze, no new features, migrate callers)

| Module / File                     | Why Deprecated                                         | Migration Path                                                         |
|-----------------------------------|--------------------------------------------------------|------------------------------------------------------------------------|
| `src/lib/gl.ts`                   | Appears to be legacy GL write functions pre-FinanceCore | All callers must route through FinanceCore; gl.ts frozen               |
| `src/lib/finance_core.ts.legacy.backup` | Explicit legacy backup file                       | Delete after migration validation complete                             |
| `expense_types` table             | Replaced by `service_types` + `supplier_service_map`  | Freeze: no new records. Read-only fallback during transition.          |
| Direct `work_order_equipment.journal_entry_id` inline assignment | Equipment-level GL is wrong grain | GL at WO level only, not equipment line level                          |

#### DELETE (safe to remove, no migration needed)

| Artifact                          | Why Safe to Delete                                     |
|-----------------------------------|--------------------------------------------------------|
| `scripts/execute_posting_job_v2.js` | Replaced by batch_posting.ts infrastructure           |
| `scripts/write_test_*.ps1` (5 files) | Test scripts with no production path                |
| All `final_reseed_v*.sql` (v1–v5)  | Superseded by canonical reseed plan                   |
| `safe_wipe.sql`, `op_wipe.sql`, `phase1_wipe.sql`, `final_wipe.sql` | One-time wipe scripts, executed or superseded |
| `*.js` audit scripts at root level | Ad-hoc audit tools; replaced by daily_finance_health.ts |
| `src/lib/finance_core.ts.legacy.backup` | After migration validated                          |

---

## PART 3 — OPERATIONAL LIFECYCLE DEFINITIONS

### 3.1 Inventory Receipt Lifecycle (GRN)

```
STATE MACHINE:
  [Source Document]
       ↓ API call: POST /api/inventory/movements (movement_type='GRN')
  [DRAFT]
    • inventory_movements row inserted (gl_posting_status='pending')
    • inventory_balances updated immediately (synchronous)
    • REQUIRED: supplier_code, document_number, item_code, qty, unit_price
    • OPTIONAL: work_order_id, center_code, batch_number
       ↓ Outbox enqueued (idempotency_key = 'inventory_movement:{id}')
  [POSTED]
    • inventory_posting_outbox consumed by batch processor
    • posting_engine resolves: IPG × PPG → inventory_account (1407.x)
    •                          BPG × PPG → purchases_account (2120.x)
    • GL: DR inventory_account / CR purchases_account (AP)
    • gl_posting_status = 'posted', journal_entry_id set
       ↓ (optional, if cash purchase)
  [CASH_SETTLED]
    • cash_transactions written by outbox processor AFTER GL posted
    • GL: DR purchases_account (2120) / CR cash (1401)
    • This collapses the AP immediately for cash GRNs

FAILURE STATE: gl_posting_status = 'failed'
  • inventory_balances UNCHANGED (already correct from DRAFT)
  • Retry by batch processor (max 3 attempts)
  • After max attempts: alert + manual review required
  • Balance is never rolled back — GL failure is a GL problem, not a stock problem

DIMENSION REQUIREMENTS (enforced at API):
  • company_id: MANDATORY
  • item_code: MANDATORY
  • warehouse: MANDATORY
  • movement_date: MANDATORY, must not be future, must not be before lock date
  • supplier_code: MANDATORY for GRN
  • document_number: MANDATORY for GRN
  • qty_in: MANDATORY > 0
  • unit_price: MANDATORY > 0 (zero requires zero_value_reason + role approval)
  • season_id: MANDATORY for posted GRNs
  • center_code: OPTIONAL (inherited from warehouse default if absent)
  • batch_number: OPTIONAL now, MANDATORY when PPG in (FERT, CHEM, SEED) — Phase 3 enforcement
```

---

### 3.2 Inventory Issue Lifecycle (ISSUE / تصريف)

```
STATE MACHINE:
  [Field Consumption Decision]
       ↓ API call: POST /api/inventory/movements (movement_type='ISSUE')
  [VALIDATION]
    • Balance check: qty_out ≤ available balance at (item_code, warehouse)
    • Future balance check: no downstream movement violated
    • REQUIRED: field_id, season_id, service_type_code, center_code, statement_text
    • REQUIRED: item_code, warehouse, qty_out, movement_date
       ↓ if valid
  [DRAFT]
    • inventory_movements row inserted (gl_posting_status='pending')
    • inventory_balances DECREMENTED immediately (synchronous)
       ↓ Outbox enqueued
  [POSTED]
    • posting_engine resolves: IPG × PPG → inventory_account (credit: 1407.x)
    •                          PPG → cogs_account (debit: 5130.x)
    • GL: DR cogs_account / CR inventory_account
    • gl_posting_status = 'posted', journal_entry_id set
    • Dimensions carried to GL line: field_id, season_id, center_code

FAILURE STATE: gl_posting_status = 'failed'
  • Balance already decremented — stock is correct
  • GL failure creates suspense; batch retry resolves
  • If unresolvable: manual correction via reversal + repost

DIMENSION REQUIREMENTS (enforced at API — these are NON-NEGOTIABLE for ISSUE):
  • field_id: MANDATORY
  • season_id: MANDATORY
  • service_type_code: MANDATORY (determines which crop/operation the cost attaches to)
  • center_code: MANDATORY (cost center for reporting)
  • statement_text: MANDATORY (min 3 chars, no system tags)
  • batch_number: MANDATORY when PPG in (FERT, CHEM, SEED) — regulatory traceability

COGS ROUTING (via posting_engine cascade):
  PPG=FERT  → DR 51300005 (أسمدة) / CR 14070101
  PPG=CHEM  → DR 51300006 (مبيدات) / CR 14070102
  PPG=SEED  → DR 51300007 (تقاوي) / CR 14070103
  PPG=EQUIP_CONS → DR 51300009 (قطع غيار) / CR 14070105
  PPG=MISC  → DR 51300010 (متنوعة) / CR 14070106
```

---

### 3.3 Supplier AP Lifecycle

```
STATE MACHINE:
  [External Invoice Received]
       ↓ API call: POST /api/suppliers/:code/transactions (entry_type='invoice')
  [AP OPEN]
    • supplier_transactions row inserted (entry_type='invoice', is_matched=0)
    • REQUIRED: supplier_code, service_type_code, amount, document_number,
                document_date, due_date, season_id, center_code
    • supplier authorized for service_type via supplier_service_map
    • GL: DR expense_account (via BPG×PPG) / CR ap_account (via supplier_service_map)
    • journal_entry_id set synchronously
       ↓ (optionally)
  [PARTIALLY MATCHED]
    • One or more supplier_transactions (entry_type='payment') reference this invoice
    • via matched_payment_id FK
    • Remaining open balance tracked via supplier_ap_ledger view
       ↓
  [FULLY MATCHED]
    • SUM(payments.amount) = invoice.amount
    • supplier_transactions.is_matched = 1 on both sides
    • AP aging shows this invoice as cleared

PAYMENT POSTING:
  [Supplier Payment]
       ↓ API call: POST /api/suppliers/:code/transactions (entry_type='payment')
  [SETTLEMENT]
    • REQUIRED: matched_payment_id (must reference an open invoice)
    • REQUIRED: financial_account_id (cash or bank account)
    • GL: DR ap_account / CR cash/bank_account
    • Cash mirror: cash_transactions written synchronously
    • If cash mirror fails → GL entry voided → payment row stays as draft

MULTI-SERVICE SUPPLIER RULE (شركة عرفة, جهاز مستقبل مصر):
  • service_type_code is MANDATORY for every transaction
  • GL account resolved from supplier_service_map.default_ap_account_code
    WHERE supplier_code = X AND service_type_code = Y
  • If no service_type_code: BLOCKED — error returned, not default assumed

DIMENSION REQUIREMENTS:
  • supplier_code: MANDATORY
  • service_type_code: MANDATORY
  • season_id: MANDATORY
  • center_code: MANDATORY for operational services (SRV_MECH, SRV_LABOR, SRV_SUPERVISION)
  • document_number: MANDATORY for invoices
  • due_date: MANDATORY for invoices (AP aging cannot function without this)
  • quantity + unit_type: MANDATORY for SRV_MECH (hours), SRV_LABOR (workers)
```

---

### 3.4 Supplier Cash Settlement Lifecycle

```
RULE: Cash settlement of a supplier AP is NOT a separate event type.
It is a supplier_transactions payment (entry_type='payment') that:
  1. References matched_payment_id → open invoice
  2. Has financial_account_id set to cash account (1401.x)
  3. Triggers GL: DR ap_account / CR 1401
  4. Triggers cash_transactions mirror for treasury tracking

DIRECT CASH PURCHASE (GRN without prior AP):
  • GRN with payment_method='cash'
  • inventory_movements records the GRN
  • Outbox processor creates:
    GL Entry 1: DR inventory_account / CR cash_clearing_account
    GL Entry 2: DR cash_clearing_account / CR cash_account  (collapsed in same transaction)
  • No AP is created — this is a single-step event
  • cash_transactions record written after GL posted (not before)

PAYMENT FLOW INVARIANT:
  • Cash never moves in GL before an operational event exists
  • AP is always created by an invoice event, not by a payment event
  • Payments reduce AP; they do not create it
```

---

### 3.5 Work Order Execution Lifecycle

```
STATUS MACHINE (enforced by ALLOWED_TRANSITIONS in operations.ts):
  DRAFT → ACTIVE → IN_PROGRESS → COSTED → COMPLETED | CANCELLED

[DRAFT]
  • WO created: field_id, season_id, center_code set
  • operation_id set (idempotency guard — unique per WO)
  • NO GL entries created

[ACTIVE]
  • WO activated: resources can be assigned
  • work_tasks added (labor, materials planning)
  • work_order_equipment added (equipment planning)
  • All costs are PLANNED, not posted
  • NO GL entries created

[IN_PROGRESS]
  • Execution begins
  • Actual quantities updated on work_tasks
  • Equipment actual hours updated
  • Still NO GL entries (costs are still operational records only)

[COSTED]  ← THE ONLY POSTING TRIGGER
  • PATCH /orders/:id/status {status: 'costed'}
  • System sums: work_tasks (labor cost) + work_order_equipment (equipment cost)
  • FinanceCore.resolveWorkOrderLabor() called ONCE
  • Single GL entry created covering all WO costs
  • work_orders.total_cost set; work_orders.journal_entry_id set
  • Equipment records: journal_entry_id is set ON THE WO LEVEL, not per-equipment row
  ← CRITICAL CHANGE FROM CURRENT: remove inline equipment posting

[COMPLETED]
  • Operational closure
  • No new GL entries
  • Linked supplier invoices should all be matched

[CANCELLED]
  • If WO was in COSTED state: GL reversal created automatically
  • All work_tasks and work_order_equipment records preserved (audit trail)
  • Status transition to CANCELLED creates compensating GL entry

DIMENSION REQUIREMENTS:
  • field_id: MANDATORY
  • season_id: MANDATORY
  • center_code: MANDATORY (inherited from field if not set)
  • operation_id: MANDATORY, UNIQUE (idempotency)
  • service_type_code: MANDATORY on work_tasks
```

---

### 3.6 Posting Lifecycle

```
POSTING PIPELINE INVARIANTS:
  1. Every posted GL entry has exactly one source (business_event or direct postFromBusinessEvent)
  2. Every GL entry is balanced: SUM(debit_lines) = SUM(credit_lines)
  3. Every GL line has: account_code, amount, description
  4. Every GL entry has: event_type, source_module, source_id, event_date, company_id
  5. No GL entry has a date in the future (enforced at creation)
  6. No GL entry is mutated after posting. Corrections use reversals.
  7. account_code must exist in chart_of_accounts (is_active=1, is_header=0)

POSTING FAILURE PROTOCOL:
  Sync postings (supplier, cash, WO):
    • Transaction rolls back
    • Source document stays in 'draft' state
    • Error returned to API caller
    • NO partial GL state is possible

  Async postings (inventory via outbox):
    • inventory_movements committed (stock balance is correct)
    • GL failure → gl_posting_status='failed'
    • Batch processor retries up to 3 times
    • After 3 failures: status='failed_permanent', alert fired
    • Inventory balance is NEVER rolled back due to GL failure
    • Manual resolution: admin creates compensating manual entry referencing failed movement_id

IDEMPOTENCY:
  • Outbox uses idempotency_key = '{event_type}:{movement_id}'
  • INSERT OR IGNORE on outbox — second enqueue is a no-op
  • postFromBusinessEvent checks business_events for duplicate (source_module + source_id + event_type) before inserting
  • WO costing: operation_id unique constraint prevents double-costing
```

---

## PART 4 — DATA INTEGRITY RULES

### 4.1 Duplicate Prevention

| Scenario                              | Prevention Mechanism                                   | Enforcement Layer     |
|---------------------------------------|--------------------------------------------------------|-----------------------|
| Double-posting an inventory movement  | `inventory_posting_outbox.idempotency_key` UNIQUE      | Database constraint   |
| Double-costing a work order           | `work_orders.operation_id` UNIQUE per (company, field, season) | Database constraint |
| Double AP invoice                     | `supplier_transactions` (company, supplier, document_number, document_date) UNIQUE | API validation + DB constraint |
| Double journal entry for same event   | `business_events` (source_module, source_id, event_type) checked before insert | Application logic     |
| Double depreciation for same period   | `depreciation_schedules` (asset_id, year, month) UNIQUE | Database constraint   |

### 4.2 Idempotency Contracts

Every write operation must be safe to retry without creating duplicate financial records.

| Operation                             | Idempotency Key                            | Behavior on Repeat        |
|---------------------------------------|--------------------------------------------|---------------------------|
| POST inventory movement               | External: caller provides document_number  | Reject duplicate (API)    |
| Enqueue outbox                        | `inventory_movement:{id}`                  | INSERT OR IGNORE (no-op)  |
| Post WO to COSTED                     | `operation_id` unique constraint           | 409 Conflict returned     |
| Supplier invoice                      | `(supplier_code, document_number, doc_date)` | 409 Conflict returned   |
| Monthly depreciation                  | `(asset_id, year, month)` checked first    | Skip if exists            |
| Harvest GL posting                    | DELETE prior entries then repost (idempotent re-run) | Safe to re-run    |
| WIP carry-forward                     | Check `wip_balances` before posting        | Skip if exists            |

### 4.3 Posting Guarantees

1. **Completeness:** Every operational event that changes asset, liability, equity, revenue, or expense MUST produce a GL entry. No silent skips.
2. **Accuracy:** GL entry amount = source document amount. No rounding beyond 2 decimal places.
3. **Timeliness:** Sync events post within the same HTTP request. Async (inventory) events post within 15 minutes (outbox sweep interval).
4. **Auditability:** Every GL entry traces back to source via `journal_entries.ref_type` + `journal_entries.ref_id`.
5. **Reversibility:** Every posted entry can be reversed by creating a compensating entry. The original entry is never mutated.

### 4.4 Reconciliation Boundaries

```
BOUNDARY 1 — Inventory Sub-Ledger vs GL
  inventory_balances.balance_value (per item/warehouse)
  MUST equal
  SUM(chart_of_accounts where code LIKE '1407%' and is_header=0).balance
  FREQUENCY: Daily automated check (daily_finance_health.ts)

BOUNDARY 2 — Supplier AP Sub-Ledger vs GL
  supplier_ap_ledger.open_balance (per supplier, per service class)
  MUST equal
  chart_of_accounts.balance for corresponding 2120.x account
  FREQUENCY: Daily automated check

BOUNDARY 3 — Cash vs GL
  SUM(cash_transactions) by financial_account_id
  MUST equal
  chart_of_accounts.balance for corresponding 1401.x account
  FREQUENCY: Daily automated check

BOUNDARY 4 — GL itself (trial balance)
  SUM(journal_entry_lines.debit) = SUM(journal_entry_lines.credit)
  WHERE company_id = X AND posted_at IS NOT NULL
  FREQUENCY: Every posting event (real-time assertion in postFromBusinessEvent)
```

### 4.5 Dimension Requirements (Non-Negotiable)

Every posted operational record MUST carry these dimensions. NULL is not acceptable for posted state.

| Dimension        | GRN | ISSUE | Supplier Invoice | Cash Expense | Work Order |
|------------------|-----|-------|-----------------|--------------|------------|
| `company_id`     | ✓   | ✓     | ✓               | ✓            | ✓          |
| `season_id`      | ✓   | ✓     | ✓               | ✓            | ✓          |
| `center_code`    | —   | ✓     | ✓               | ✓            | ✓          |
| `field_id`       | —   | ✓     | —               | —            | ✓          |
| `service_type_code` | —| ✓     | ✓               | ✓            | ✓ (per task)|
| `supplier_code`  | ✓   | —     | ✓               | —            | —          |
| `document_number`| ✓   | —     | ✓               | —            | —          |
| `due_date`       | —   | —     | ✓               | —            | —          |
| `quantity + unit`| —   | ✓     | ✓ (SRV_MECH/LABOR)| —          | ✓ (equipment)|

Legend: ✓ = MANDATORY, — = Not applicable for this type

---

## PART 5 — DATA MIGRATION STRATEGY

### 5.1 Data Classification

#### SAFE TO MIGRATE AS-IS

| Data                                            | Reason                                              |
|-------------------------------------------------|-----------------------------------------------------|
| `chart_of_accounts` (all)                       | Clean. No structural changes planned.               |
| `posting_rules` (all, up to 0108)               | Clean. PPG-level COGS accounts correctly defined.   |
| `service_types` (all 6)                         | Final taxonomy. Canonical.                          |
| `supplier_service_map` (all 11 mappings)        | Correct after 0107 reclassification.                |
| `suppliers` master data                         | Clean after BPG backfill (0100_week2).              |
| `fields` (with area_feddan to be added)         | Clean. Add area_feddan column and backfill.         |
| `seasons` (all)                                 | Clean.                                              |
| `cost_centers` (all)                            | Clean.                                              |
| `items` (all 4,830+)                            | Requires PPG backfill audit before migration.       |
| `business_posting_groups` / `product_posting_groups` | Clean.                                       |
| `cash_transactions` (posted, non-future)        | Safe. journal_entry_id populated.                   |
| `journal_entries` + `journal_entry_lines`       | Safe. Already posted. Read-only from here.          |

#### REQUIRES TRANSFORMATION BEFORE MIGRATION

| Data                                            | Problem                                             | Transformation Required                          |
|-------------------------------------------------|-----------------------------------------------------|--------------------------------------------------|
| `supplier_transactions` (posted, non-future)    | `is_matched=0` on all; `due_date` NULL on old rows  | Set `due_date` from `transaction_date + 30d` as estimate; mark as `due_date_estimated=1` |
| `supplier_transactions` (invoice_ref NULL)      | AP aging cannot function                            | Backfill `invoice_ref` from `document_number` where available |
| `inventory_movements` (PPG NULL)                | COGS routing broken                                 | Backfill `prod_posting_group_code` on item from item category + name heuristics |
| `work_order_equipment` with inline journal_entry_id | Per-equipment GL entries exist; should be WO-level | Audit: if WO is COSTED, WO-level entry exists — mark equipment entries as superseded |

#### UNSAFE TO MIGRATE — MUST ARCHIVE ONLY

| Data                                            | Reason                                              | Action                                           |
|-------------------------------------------------|-----------------------------------------------------|--------------------------------------------------|
| 52 future-blocked rows                          | KEEP_BLOCKED policy — cannot post                   | Archive in `_archived_blocked_movements` table; remove from active query paths |
| `expense_types` table records                   | Replaced by service_types; ambiguous mapping        | Archive; map to service_type_code manually; do not auto-migrate |
| Any `gl_posting_status='failed_permanent'`      | GL state is wrong; source data may be corrupted     | Audit individually; do not auto-repost           |
| Raw JSON source files                           | Source truth, not operational data                  | Read-only reference; never import directly       |

#### DO NOT MIGRATE — DELETE AFTER VALIDATION

| Data                                            | Reason                                              |
|-------------------------------------------------|-----------------------------------------------------|
| `inventory_posting_outbox` rows with status='done' | Already processed; no value                    |
| `batch_post_job_items` with status='completed'  | Already processed                                   |
| All root-level `.js` audit scripts              | Replaced by structured health checks                |
| All `final_reseed_v*.sql` scripts               | One-time scripts, executed                          |

---

## PART 6 — TARGET ARCHITECTURE MAP

### 6.1 Target Module Structure

```
src/
├── api/
│   ├── suppliers/
│   │   ├── master.ts          [REFACTOR from suppliers.ts — CRUD only]
│   │   ├── invoices.ts        [REFACTOR from suppliers.ts — invoice posting]
│   │   ├── payments.ts        [REFACTOR from suppliers.ts — payment + matching]
│   │   └── index.ts           [Router aggregator]
│   ├── inventory/
│   │   ├── movements.ts       [REFACTOR — thin orchestrator; extract date_utils]
│   │   ├── receipts.ts        [KEEP — GRN-specific enrichment]
│   │   ├── issues.ts          [NEW — ISSUE/تصريف dedicated endpoint]
│   │   ├── items.ts           [KEEP]
│   │   ├── balances.ts        [KEEP]
│   │   ├── analytics.ts       [KEEP]
│   │   └── governance.ts      [KEEP]
│   ├── treasury/
│   │   ├── cash.ts            [REFACTOR from treasury.ts]
│   │   ├── equity.ts          [REFACTOR from treasury.ts — partner capital]
│   │   └── index.ts
│   ├── operations/
│   │   ├── work_orders.ts     [REFACTOR from operations.ts — remove inline equipment posting]
│   │   ├── templates.ts       [KEEP — WO templates]
│   │   └── index.ts
│   ├── gl/                    [KEEP ALL — no changes]
│   ├── hr/                    [KEEP ALL — no changes]
│   ├── reports/               [KEEP — extend with AP aging, cost/feddan]
│   ├── schema/
│   │   └── forms.ts           [NEW — /api/schema/forms/:service_type endpoint]
│   └── [all other root .ts]   [KEEP]
│
├── lib/
│   ├── posting_engine.ts      [KEEP — no changes]
│   ├── finance_core.ts        [REFACTOR — remove alias, clean exports]
│   ├── finance/               [KEEP ALL resolvers]
│   ├── inventory_posting.ts   [KEEP]
│   ├── batch_posting.ts       [KEEP]
│   ├── date_utils.ts          [NEW — extract from movements.ts + suppliers.ts]
│   ├── dimension_validator.ts [NEW — centralize dimension enforcement]
│   ├── gl.ts                  [DEPRECATE — freeze, no new callers]
│   ├── hardening.ts           [KEEP]
│   ├── audit.ts               [KEEP]
│   └── daily_finance_health.ts [KEEP — extend with AP aging check]
│
└── [frontend — unchanged structurally]
```

### 6.2 New Tables Required (Migrations 0109+)

**Status: Phase A EXECUTED 2026-05-14**

| Migration | Status | Table / Change                                 | Purpose                                                    |
|-----------|--------|------------------------------------------------|------------------------------------------------------------|
| 0109 ✅   | DONE   | `supplier_ap_ledger` VIEW + `due_date_estimated`, `statement_text`, `field_id`, `quantity`, `unit_type` on `supplier_transactions` | AP aging view + missing dimension columns |
| 0110 ✅   | DONE   | `CREATE TABLE unit_types` + `form_templates` + `form_fields` + seed data for all 6 service types | Schema-driven form engine foundation |
| 0111 ✅   | DONE   | `items.area_per_feddan`, `items.cogs_account_override` + `item_ppg_audit` VIEW + `item_ppg_inferred` VIEW | COGS routing safety net + inference scaffold |
| 0112 ✅   | DONE   | `CREATE TABLE _archived_blocked_movements` + archive INSERT for 52 future-blocked rows + Phase B backfill advisory queries (commented) | Archive + Phase B scaffolding |

**Note:** `fields.area_feddan` already exists (migration 004 — auto-computed from geopolygon).
Phase A plan entry A1 was superseded by this discovery.

### 6.3 New API Endpoints Required

| Endpoint                                    | Purpose                                              | Owner Module           |
|---------------------------------------------|------------------------------------------------------|------------------------|
| `POST /api/inventory/issues`                | Dedicated ISSUE (تصريف) endpoint with full dimension enforcement | `inventory/issues.ts` |
| `POST /api/suppliers/:code/match-payment`   | Match payment to open invoice; set is_matched        | `suppliers/payments.ts`|
| `GET /api/suppliers/:code/ap-aging`         | Open AP balance aged by invoice date                 | `suppliers/payments.ts`|
| `GET /api/schema/forms/:service_type`       | Return dynamic form JSON for given service_type_code | `schema/forms.ts`      |
| `GET /api/reports/cost-per-feddan`          | Cost per feddan per pivot per season                 | `reports/cost-centers.ts` |
| `GET /api/reports/supplier-ap-summary`      | Total AP by supplier and service class               | `reports/suppliers.ts` |

---

## PART 7 — MIGRATION EXECUTION STRATEGY

### 7.1 Phase Sequence (Non-Negotiable Order)

```
PHASE A — Schema Hardening (zero risk, additive only) ✅ EXECUTED 2026-05-14
  A1. ✅ Migration 0109: supplier_ap_ledger VIEW + AP dimension columns on supplier_transactions
        (area_feddan already existed on fields — no new migration needed)
  A2. ✅ Migration 0110: unit_types + form_templates + form_fields + 6-service seed data
  A3. ✅ Migration 0111: items.area_per_feddan + cogs_account_override + item_ppg_audit VIEW
                         + item_ppg_inferred VIEW (Phase B scaffold)
  A4. ✅ Migration 0112: _archived_blocked_movements + 52-row archive INSERT
                         + Phase B backfill advisory queries (commented, operator-run)

  GATE: All migrations applied, no errors. Daily health check passes.

PHASE B — Data Backfill (deterministic, auditable)
  B1. Audit query: items with NULL prod_posting_group_code → fix before anything else
  B2. Backfill items.prod_posting_group_code by category/name heuristic
  B3. Backfill supplier_transactions.due_date for rows where NULL (estimate = transaction_date + 30d)
  B4. Set due_date_estimated=1 on all backfilled rows
  B5. Backfill invoice_ref from document_number on existing supplier_transactions
  B6. Populate fields.area_feddan for all 11 pivots (manual entry, known values)
  B7. Archive 52 future-blocked rows to _archived_blocked_movements

  GATE: SELECT COUNT(*) FROM items WHERE prod_posting_group_code IS NULL = 0
        SELECT COUNT(*) FROM supplier_transactions WHERE due_date IS NULL AND entry_type='invoice' = 0
        SELECT COUNT(*) FROM inventory_movements WHERE blocking_reason='future_date' = 0 (archived)

PHASE C — Logic Refactor (no schema changes)
  C1. Extract src/lib/date_utils.ts (normalizeIsoDate, isFutureIsoDate)
  C2. Extract src/lib/dimension_validator.ts (centralized dimension enforcement)
  C3. Refactor operations.ts — remove inline equipment posting; post only on WO→COSTED
  C4. Refactor suppliers.ts → suppliers/master.ts + invoices.ts + payments.ts
  C5. Build suppliers/payments.ts with match-payment endpoint
  C6. Build inventory/issues.ts dedicated ISSUE endpoint
  C7. Remove finance_core.ts recordCashMovement alias

  GATE: All existing tests pass. GL trial balance still = 0. Health check passes.

PHASE D — New Capabilities (net new, no existing code touched)
  D1. Build /api/schema/forms/:service_type endpoint
  D2. Build /api/reports/cost-per-feddan endpoint
  D3. Build /api/reports/supplier-ap-summary endpoint
  D4. Extend daily_finance_health.ts with AP aging boundary check
  D5. Build FormRenderer component (frontend — separate scope)

  GATE: New endpoints return correct data verified against known values.

PHASE E — Cleanup (only after all phases validated)
  E1. Delete root-level .js audit scripts
  E2. Delete scripts/execute_posting_job_v2.js
  E3. Delete write_test_*.ps1 scripts
  E4. Delete final_reseed_v*.sql files
  E5. Delete safe_wipe/op_wipe/phase_wipe scripts
  E6. Delete finance_core.ts.legacy.backup
  E7. Freeze expense_types table (add is_deprecated column = 1 on all rows)

  GATE: git status clean. No broken imports. Build passes.
```

### 7.2 Compatibility Strategy

During Phases C and D, the old and new module paths MUST coexist:

1. New `suppliers/` directory is built alongside existing `suppliers.ts`
2. Router registers both paths temporarily; old path returns 301 redirect to new path
3. After 2-week validation window, old path is removed
4. Same pattern for `treasury/` split
5. `operations.ts` equipment posting change requires MIGRATION GUARD: for any WO already in COSTED state with `work_order_equipment.journal_entry_id` set, those entries are valid and must not be re-posted on the next WO status check

### 7.3 Rollback Safety Strategy

| Phase | Rollback Method                                               | Rollback Window     |
|-------|---------------------------------------------------------------|---------------------|
| A (schema) | Migrations are additive only (ADD COLUMN, CREATE TABLE). Rollback = DROP the new column/table. No data loss. | Immediate |
| B (backfill) | All backfills use UPDATE SET ... WHERE condition. Rollback script = UPDATE SET field = NULL WHERE due_date_estimated = 1. | Immediate |
| C (refactor) | Git revert. Old files preserved until cleanup phase. | Until Phase E |
| D (new features) | New endpoints only. No existing code changed. Disable route. | Immediate |
| E (cleanup) | Git history. Do not run Phase E until 30-day stability window confirmed. | Git restore |

**GL is immutable.** No rollback strategy touches posted journal entries. Any correction to GL is done via reversal posting.

---

## PART 8 — ARCHITECTURAL DECISIONS LOG

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|-----------------------|
| Inventory stays async (outbox) | D1 statement limits; high volume; balance correctness is independent of GL correctness | Sync posting: rejected — too slow; too many D1 round trips per batch GRN |
| Equipment GL only on WO→COSTED | Prevents orphan entries when WO is cancelled mid-execution | Per-equipment inline posting: rejected — creates GL clutter for cancelled WOs |
| AP aging uses self-referential FK (matched_payment_id) | Simplest model for single-table AP tracking | Separate AP_ledger table: deferred to Phase D view; source stays in supplier_transactions |
| form_templates deferred to Phase D | Schema taxonomy must be solid before UI schema is built | Parallel build: rejected — form schema depends on stable service_types |
| 52 blocked rows archived not deleted | Regulatory + audit trail | Delete: rejected — data governance requires preservation |
| due_date estimated for old rows, flagged | AP aging must work on all invoices; estimates are better than NULL | Leave NULL: rejected — aging queries break; COGS timing analysis breaks |
| Feddan area on fields table | Operational dimension; owned by field master | Separate pivot_metrics table: rejected — over-engineering |

---

*This document is the binding engineering contract for all agents and developers working on the Agri-Nile Flow ERP refactor. No implementation diverges from this plan without a written amendment.*

*Next action: Execute Phase A migrations (0109–0113) — additive only, zero risk.*
