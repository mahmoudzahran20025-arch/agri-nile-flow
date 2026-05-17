# Inventory Domain Model + Finance Posting Flow
## Production-grade design for Agri-Nile Flow ERP

**Date:** 2026-05-03
**Status:** Design — ready for implementation review
**Scope:** Inventory subledger, GL integration, transactional outbox, posting rules.

---

## 0. High-level Architecture

```
Inventory Domain (source of truth for quantities)
  Item | Warehouse | InventoryTransaction (header)
                       |
              InventoryTransactionLine
              InventoryLedgerEntry  <- perpetual ledger (FIFO/MA)
                       |
              OutboxMessage  (same DB tx as ledger write)
                       |  async / polled
Finance Domain (source of truth for monetary value)
  PostingRule (mapping) | GL Journal Entries | SourceDocument (reconciliation)
```

**Boundary contract:** Inventory owns quantities and movement history. Finance owns chart of accounts and monetary postings. The **Outbox** is the only legitimate path from Inventory to Finance.

---

## 1. Domain Model — Entities & Fields

### 1.1 Item (master data)

| Field | Type | Notes |
|---|---|---|
| `company_id` | FK | tenant isolation |
| `item_code` | PK integer | internal SKU |
| `name` | text | display name |
| `base_unit` | text | smallest UOM |
| `costing_method` | enum | `moving_average` or `fifo` |
| `prod_posting_group_code` | text FK | drives GL account selection |
| `inv_posting_group_code` | text FK | drives GL account selection |
| `standard_cost` | decimal | optional frozen cost |
| `is_active` | bool | |
| `track_lots` | bool | future: lot/serial |
| `track_serial` | bool | future: serial |

Relationships: `1:N` → `item_units` (alternate UOMs), `1:N` → `inventory_ledger_entries`.

### 1.2 Warehouse (master data)

| Field | Type | Notes |
|---|---|---|
| `company_id` | FK | |
| `code` | text PK | short mnemonic (`W1`, `MAIN`) |
| `name` | text | human readable |
| `inv_posting_group_code` | text FK | overrides item-level IPG if set |
| `is_active` | bool | |

### 1.3 InventoryTransaction (header)

Represents a *business document* (GRN, transfer order, adjustment sheet). Lines generate ledger entries.

| Field | Type | Notes |
|---|---|---|
| `id` | PK int | |
| `company_id` | FK | |
| `transaction_type` | enum | `GRN` `ISSUE` `TRANSFER` `RETURN_IN` `RETURN_OUT` `ADJUSTMENT` `PRODUCTION` `PHYSICAL_COUNT` |
| `document_number` | text | business document # |
| `source_module` | enum | `purchase_order` `sales_order` `work_order` `manual` `api` `offline_sync` |
| `source_id` | int | FK to origin document |
| `warehouse_code` | text FK | primary warehouse |
| `movement_date` | date | physical date (when stock moved) |
| `posting_date` | date | financial date (can differ) |
| `period_id` | FK | validates open period at creation |
| `status` | enum | `draft` `confirmed` `posted` `cancelled` |
| `total_qty` | decimal | sum of lines |
| `total_value` | decimal | sum of lines |
| `created_by_user_id` | FK | |
| `confirmed_by_user_id` | FK | |
| `cancelled_at` / `cancellation_reason` | | audit trail |

### 1.4 InventoryTransactionLine

| Field | Type | Notes |
|---|---|---|
| `id` | PK int | |
| `transaction_id` | FK | |
| `line_number` | int | display order |
| `item_code` | FK → Item | |
| `warehouse_code` | FK → Warehouse | allows multi-warehouse per header if needed |
| `quantity` | decimal | always positive |
| `unit` | text | line-level UOM |
| `conversion_qty` | decimal | to base unit |
| `unit_cost` | decimal | cost per base unit |
| `total_cost` | decimal | `quantity * conversion_qty * unit_cost` |
| `lot_number` | text | nullable |
| `serial_number` | text | nullable |
| `source_reference` | text | e.g. `PO-2026-0042-L3` |
| `dimensions` | JSON | `{season_id, field_id, work_order_id, center_code}` |

### 1.5 InventoryLedgerEntry

The **perpetual inventory ledger**. Every line becomes one or more ledger entries. This is the source of truth for stock valuation.

| Field | Type | Notes |
|---|---|---|
| `id` | PK int | |
| `company_id` | FK | |
| `line_id` | FK → InventoryTransactionLine | |
| `item_code` | FK → Item | denormalized for fast lookups |
| `warehouse_code` | FK → Warehouse | |
| `entry_date` | date | usually `movement_date` |
| `entry_type` | enum | `IN` `OUT` `TRANSFER_OUT` `TRANSFER_IN` `ADJUSTMENT` |
| `quantity` | decimal | positive for IN, negative for OUT |
| `unit_cost` | decimal | |
| `total_cost` | decimal | |
| `running_qty` | decimal | balance after this entry |
| `running_value` | decimal | balance value after this entry |
| `costing_batch_id` | text | for FIFO: links IN to future OUT |
| `created_at` | timestamp | |

**Index:** `(company_id, item_code, warehouse_code, entry_date, id)` — supports running-balance queries.

**Moving Average cost computation:**
```sql
-- On each IN: new_avg = (old_running_value + total_cost) / (old_running_qty + qty)
-- On each OUT: unit_cost = prior running_value / prior running_qty (lock before write)
```

**FIFO cost computation:**
```sql
-- On OUT: consume from oldest open costing_batch_id until qty satisfied.
-- Leave partial batch records if needed.
```

### 1.6 MovementType (reference data)

| Field | Type | Notes |
|---|---|---|
| `code` | text PK | `GRN` `ISSUE` `TRANSFER` `RETURN_SUPPLIER` `RETURN_CUSTOMER` `ADJUSTMENT_PROFIT` `ADJUSTMENT_LOSS` `PRODUCTION_INPUT` `PRODUCTION_OUTPUT` |
| `name` | text | human label |
| `direction` | enum | `IN` `OUT` `NEUTRAL` |
| `affects_inventory` | bool | |
| `affects_cogs` | bool | |
| `affects_wip` | bool | |
| `requires_reference` | bool | does this require a source document? |

### 1.7 PostingProfile (finance mapping)

A posting profile resolves which GL accounts are hit for a movement.

| Field | Type | Notes |
|---|---|---|
| `id` | PK int | |
| `company_id` | FK | |
| `rule_type` | enum | `inventory_in` `inventory_out` `inventory_transfer` `adjustment` `purchase_receipt` `purchase_invoice` `cogs` `wip` `finished_goods` |
| `movement_type` | text FK → MovementType | nullable = wildcard |
| `prod_posting_group_code` | text FK | nullable = wildcard |
| `inv_posting_group_code` | text FK | nullable = wildcard |
| `debit_account_code` | text FK → chart_of_accounts | |
| `credit_account_code` | text FK → chart_of_accounts | |
| `journal_template` | text | e.g. `INVENTORY`, `PURCHASES` |
| `priority` | int | lower = more specific |
| `is_active` | bool | |

**Resolution cascade (most specific → catch-all):**
1. `(movement_type, PPG, IPG)` — exact
2. `(movement_type, PPG, NULL)` — IPG wildcard
3. `(movement_type, NULL, IPG)` — PPG wildcard
4. `(movement_type, NULL, NULL)` — movement-only default
5. `(NULL, NULL, NULL)` — global catch-all (blocked in production, emergency only)

### 1.8 OutboxMessage

| Field | Type | Notes |
|---|---|---|
| `id` | PK int | |
| `company_id` | FK | |
| `event_type` | enum | `inventory_movement` `inventory_transfer` `purchase_receipt` `purchase_invoice` `adjustment` |
| `source_id` | int | FK to `InventoryTransaction.id` |
| `payload_json` | JSON | snapshot of all data needed for GL posting |
| `status` | enum | `pending` `processing` `done` `failed` |
| `attempts` | int | |
| `idempotency_key` | text | `event_type:source_id:line_id` or `event_type:transaction_id` |
| `last_error` | text | truncated to 4KB |
| `created_at` | timestamp | |
| `processed_at` | timestamp | |
| `updated_at` | timestamp | |

**Unique constraint:** `UNIQUE(company_id, idempotency_key)` — prevents duplicate GL postings.

---

## 2. Posting Rules & Mapping (Inventory → Finance)

### 2.1 Resolution logic

Posting is **data-driven**, not hard-coded. The engine resolves GL accounts from:

```
Input:  (movement_type, item.prod_posting_group_code, warehouse.inv_posting_group_code)
Output: (debit_account_code, credit_account_code, journal_template)
```

This uses the cascade in `PostingProfile` (section 1.7). A `trace` object records which step matched and which rule ID was used.

### 2.2 Example posting matrix

| Business Event | MovementType | Debit Account | Credit Account | Journal Template |
|---|---|---|---|---|
| **Purchase receipt (GRN)** | `GRN` | `Inventory` (IPG) | `GRNI` (control) | `PURCHASES` |
| **Supplier invoice arrives** | `PURCHASE_INVOICE` | `GRNI` (control) | `Accounts Payable` (control) | `PURCHASES` |
| **Sales issue (shipment)** | `ISSUE` | `COGS` (PPG) | `Inventory` (IPG) | `INVENTORY` |
| **Stock adjustment (profit)** | `ADJUSTMENT_PROFIT` | `Inventory` (IPG) | `Inventory P&L` (control) | `INVENTORY` |
| **Stock adjustment (loss)** | `ADJUSTMENT_LOSS` | `Inventory P&L` (control) | `Inventory` (IPG) | `INVENTORY` |
| **Transfer out** | `TRANSFER_OUT` | `In-Transit Inventory` (IPG) | `Inventory` (source WH IPG) | `INVENTORY` |
| **Transfer in** | `TRANSFER_IN` | `Inventory` (dest WH IPG) | `In-Transit Inventory` (IPG) | `INVENTORY` |
| **Production input** | `PRODUCTION_INPUT` | `WIP` (PPG) | `Inventory` (IPG) | `MANUFACTURING` |
| **Production output** | `PRODUCTION_OUTPUT` | `Finished Goods` (IPG) | `WIP` (PPG) | `MANUFACTURING` |
| **Return to supplier** | `RETURN_SUPPLIER` | `GRNI` (control) | `Inventory` (IPG) | `PURCHASES` |
| **Customer return** | `RETURN_CUSTOMER` | `Inventory` (IPG) | `COGS` (PPG) | `INVENTORY` |

**Control accounts** (singleton mappings) live in `posting_rules` with `rule_type = 'control'` and `mapping_key`:
- `GRNI` → `mapping_key = 'GRNI_ACCOUNT'`
- `ACCOUNTS_PAYABLE` → `mapping_key = 'AP_CONTROL'`
- `INVENTORY_PNL` → `mapping_key = 'INVENTORY_PNL'`
- `IN_TRANSIT` → `mapping_key = 'IN_TRANSIT_INVENTORY'`

### 2.3 Resolution trace & audit

Every account resolution is logged to `posting_rule_resolutions`:
- `rule_type` (which matrix was queried)
- `input_bpg`, `input_ppg`, `input_ipg`
- `resolution_step` (1-5)
- `matched_rule_id`
- `result` (`resolved` or `failed`)
- `journal_entry_id` (link to the actual GL entry once posted)

This trace must be returned in any GL preview API so a user can see *why* a specific account was chosen.

---

## 3. Transactional Outbox & Posting Flow

### 3.1 Posting modes

The system supports three posting modes per company:

| Mode | Behavior | Use case |
|---|---|---|
| `strict_sync` | GL journal entry is created in the **same** DB transaction as the inventory movement. If GL posting fails, the inventory transaction is rolled back. | Small orgs, low volume, strong consistency required. |
| `async_reliable` | Inventory transaction commits immediately; an `OutboxMessage` is written in the same tx. A background worker later reads the outbox and creates the GL entry. | Production default. High throughput, tolerant of seconds of GL lag. |
| `decoupled` | Inventory commits; outbox is written. GL posting is deferred to nightly batch jobs or manual accountant review. | Weak finance config, remote sites, offline-first operations. |

`inventory_posting_controls` stores the mode and related policies (zero-value rules, lock dates, approval roles).

### 3.2 Step-by-step flow (`async_reliable`)

#### Step 1 — Create inventory transaction
User/system posts to `POST /inventory/transactions`.
Payload includes `transaction_type`, `movement_date`, `warehouse_code`, and lines with `item_code`, `quantity`, `unit_price`, `unit`.

#### Step 2 — Validate & lock
- `enforceInventoryLockDate` rejects any date on or before `locked_through_date`.
- `getOpenPeriod` confirms `movement_date` falls in an open `financial_periods` row.
- Item master, warehouse master, and UOM conversion are resolved and validated.
- Zero-value policy: if `total_cost = 0` and `zero_value_require_reason = true`, `zero_value_reason` is mandatory. If the user lacks an approved role, the request is blocked.

#### Step 3 — Write inventory subledger (same DB tx)
For each line:
1. Compute base-unit quantity via `item_units` conversion.
2. Compute `unit_cost`:
   - For `IN` (GRN, adjustment profit): from line `unit_price` if provided; else from prior `running_value / running_qty`.
   - For `OUT` (issue, adjustment loss): **lock** the item-warehouse balance row, read `running_value / running_qty`, use that as unit cost.
3. Insert `InventoryLedgerEntry` with new `running_qty` and `running_value`.
4. If FIFO: generate a `costing_batch_id` for IN entries; for OUT entries, consume from oldest open batch and write a `fifo_cost_layer_allocation` record linking the OUT entry to the consumed IN batch(es).

#### Step 4 — Write OutboxMessage (same DB tx)
After all ledger entries are inserted, one `OutboxMessage` is created **in the same SQLite/D1 transaction**:

```sql
INSERT INTO inventory_posting_outbox
  (company_id, event_type, source_id, payload_json, status, attempts, idempotency_key)
VALUES
  (?, 'inventory_movement', ?, ?, 'pending', 0, ?);
-- idempotency_key = 'inventory_movement:42'
```

The inventory transaction status moves to `confirmed`. The DB tx commits. Inventory is now truthfully recorded regardless of downstream finance health.

#### Step 5 — Background worker polls the outbox
A scheduled function or cron worker (e.g. Cloudflare D1 + Workers) repeatedly calls `POST /posting-outbox/process` with a `limit` (default 50, max 200).

Pseudo-worker logic:
```typescript
while (true) {
  const result = await api.post('/posting-outbox/process', { limit: 50 })
  if (result.data.scanned === 0) break
  if (result.data.failed > 0) await sleep(30_000)
}
```

#### Step 6 — Process one outbox message
For each pending message:
1. **SELECT FOR UPDATE equivalent:** `UPDATE inventory_posting_outbox SET status = 'processing' WHERE id = ? AND company_id = ?`.
2. Parse `payload_json`. It contains everything needed: `company_id`, `ref_id`, `item_code`, `warehouse`, `movement_type`, `value`, `date`, `item_name`, `prod_posting_group_code`, `inv_posting_group_code`, `dimensions`.
3. Call `FinanceCore.resolveInventoryMovement(db, payload)`:
   - Queries `posting_rules` cascade for `(movement_type, PPG, IPG)`.
   - Builds a `JournalBlueprint` with debit/credit lines.
   - Validates that resolved accounts exist in `chart_of_accounts`, are active, and are not header accounts.
4. If `blueprint.isBlocked == true`:
   - Do **not** retry. Move outbox status to `failed`.
   - Write `last_error` = concatenated `validationErrors`.
   - Update `inventory_movements.gl_posting_status = 'failed'` and `gl_posting_error`.
5. If valid, call `postFromBusinessEvent` to:
   - Insert `journal_entries` (with `ref_type = 'inventory_movement'`, `ref_id = movement_id`).
   - Insert `journal_entry_lines`.
   - Insert `business_events` record with `status = 'posted'`.
   - Link via `source_documents` + `source_document_links`.
   - Log to `posting_rule_resolutions`.
6. Update outbox:
   - `status = 'done'`, `processed_at = now()`, `journal_entry_id = ?`.
7. Update inventory movement:
   - `gl_posting_status = 'posted'`, `gl_posted_at = now()`, `journal_entry_id = ?`.

#### Step 7 — Idempotency guarantee
Because `idempotency_key` has `UNIQUE(company_id, idempotency_key)`, attempting to insert a duplicate outbox message from a retried API call will fail (or `INSERT OR REPLACE` will overwrite the pending row, which is safe because the payload for a given `movement_id` is immutable). The GL posting itself is idempotent because `journal_entries` can be keyed by `(company_id, ref_type, ref_id)` and checked before insert, or the worker can skip if `gl_posting_status = 'posted'`.

### 3.3 Error handling & retries

| Scenario | Behavior |
|---|---|
| **Transient DB error** (D1 timeout, lock) | `attempts` increments. After 10 attempts, status becomes `failed`. Exponential back-off (30s, 60s, 120s…) can be implemented via `updated_at` comparison. |
| **Missing posting rule** | Hard fail after first attempt. This is a master-data error, not a transient one. An alert is raised. |
| **Invalid account** (header account, inactive, nonexistent) | Hard fail after first attempt. Finance admin must fix the posting rule or chart of accounts. |
| **Finance module down** | Outbox messages remain `pending` or `processing`. Worker retries until success. Inventory remains accurate. |
| **Partial failure in batch** | Each outbox message is processed independently. One failure does not block others in the same batch. |

**Monitoring:**
- API endpoint `GET /inventory/posting-health` returns counts by `gl_posting_status`.
- API endpoint `GET /inventory/health-summary` returns oldest pending message age and failed message list.
- Any message with `status = 'failed'` should trigger a notification to the finance admin role.

---

## 4. Edge Cases & Reliability

### 4.1 Zero-value movements

| Case | Policy | Implementation |
|---|---|---|
| **Inward movement at zero cost** (free sample, donation, start-up stock) | Allowed if `zero_value_require_reason = true` and `zero_value_reason` is provided. If reason is missing, block at validation. If user lacks an approved role, raise an approval workflow. | `validateZeroValuePolicy` checks `unit_price == 0 OR total_cost == 0`. Enforces reason + role check. |
| **Outward movement when inventory value is zero** (MA average was zero, or stock was donated) | System posts `Inventory 0 / COGS 0`. GL lines are zero-amount lines. The movement is accepted because the physical reality (stock left) is more important than the monetary zero. Posting engine skips zero-amount lines in the journal blueprint. | Posting engine filters out `debit == 0 && credit == 0` lines before writing `journal_entry_lines`. |

### 4.2 Missing master data

| Missing data | Behavior |
|---|---|
| **Item missing** | Reject at `InventoryTransaction` creation. Foreign key violation or explicit existence check. |
| **Warehouse missing** | Reject. |
| **UOM missing / invalid conversion** | Reject with explicit error: `UOM 'كرتون' not defined for item 10123`. |
| **PPG or IPG not assigned** | Warning is emitted (`'Item has no Product Posting Group assigned. Using default setup.'`), but posting proceeds if a catch-all rule exists. If no catch-all rule exists, `blueprint.isBlocked = true`, outbox moves to `failed`, and inventory is **still recorded** (quantities are truth). Finance admin must create the rule and re-trigger posting. |
| **Account missing in Chart of Accounts** | `validateAccounts` detects nonexistent/inactive/header accounts. `blueprint.isBlocked = true`, outbox moves to `failed`. Inventory stands. Fix COA, then retry. |

### 4.3 Failed posting & manual corrections

1. **Retry mechanism:** The outbox worker retries transient errors up to 10 times. After 10, status = `failed`.
2. **Re-trigger posting:** An admin endpoint (or UI action) can reset `status = 'pending'` for a specific `outbox.id`. The worker will pick it up on the next poll. Payload is immutable, so reprocessing is safe.
3. **Manual journal entry:** If a posting rule is permanently wrong and cannot be fixed retroactively, a manual GL journal can be created with `ref_type = 'manual_correction'`. It is linked to the source inventory movement via a `source_document_links` row with `link_type = 'manual_override'`. This preserves the bridge but flags it as human-corrected.
4. **Reversal:** If an inventory transaction is reversed/cancelled, a new `InventoryTransaction` of type `ADJUSTMENT` (or `RETURN_*`) is created, generating a new ledger entry and a new outbox message. The original movement stays immutable.

### 4.4 Accept movement vs block movement rules

| Condition | Inventory movement | Financial posting |
|---|---|---|
| Period locked (`movement_date <= locked_through_date`) | **Blocked** | N/A |
| Item/warehouse/UOM missing | **Blocked** | N/A |
| Zero value, no reason, strict policy | **Blocked** | N/A |
| Zero value, reason provided | **Accepted** | **Accepted** (zero lines skipped) |
| PPG/IPG missing, catch-all rule exists | **Accepted** | **Accepted** (with warning) |
| PPG/IPG missing, no catch-all rule | **Accepted** | **Delayed/Failed** (outbox `failed`) |
| Account invalid (inactive/header/missing) | **Accepted** | **Delayed/Failed** (outbox `failed`) |
| Finance module down | **Accepted** | **Delayed** (outbox stays `pending`) |

This table is critical: **Inventory (quantity) truth is never held hostage to finance configuration health.** Financial posting can be delayed or manually corrected. Physical stock cannot.

### 4.5 Inventory lock dates

`locked_through_date` in `inventory_posting_controls` prevents accidental back-dating. Any `movement_date <= locked_through_date` is rejected at creation time. Only users with `company_admin` or `accountant` roles can update `locked_through_date`.

### 4.6 Auditability requirements

- Every inventory transaction has `created_by`, `confirmed_by`, timestamps.
- Every ledger entry has a FK to the transaction line (`line_id`).
- Every GL journal entry has `ref_type`, `ref_id` back to the inventory movement.
- `posting_rule_resolutions` logs the exact rule used.
- `source_documents` + `source_document_links` create a cross-module reconciliation bridge.
- `audit_log` captures changes to `inventory_movements`, `posting_rules`, and `inventory_posting_controls`.

---

## 5. Concrete Example Scenario

**Scenario:** Purchase order for item Fertilizer-X, qty 100 kg, price 10 EGP/kg. GRN at warehouse W1. Later supplier invoice.

### 5.1 Master data (pre-existing)

- **Item:** `code = 101`, `name = 'Fertilizer-X'`, `base_unit = 'kg'`, `costing_method = 'moving_average'`, `prod_posting_group_code = 'RAW_MAT'`, `inv_posting_group_code = 'MAIN_WH'`
- **Warehouse:** `code = 'W1'`, `inv_posting_group_code = 'MAIN_WH'`
- **Posting rules:**
  - `rule_type = 'inventory'`, `movement_type = 'GRN'`, `prod_posting_group_code = 'RAW_MAT'`, `inv_posting_group_code = 'MAIN_WH'` → `debit_account = '1300-Inventory'`, `credit_account = '2200-GRNI'`, `journal_template = 'PURCHASES'`
  - `rule_type = 'control'`, `mapping_key = 'AP_CONTROL'` → `account_code = '2100-Accounts Payable'`
- **Chart of Accounts:**
  - `1300-Inventory` (Asset, debit)
  - `2200-GRNI` (Liability, credit)
  - `2100-Accounts Payable` (Liability, credit)
- **Open period:** January 2026, `is_closed = false`
- **Posting mode:** `async_reliable`

### 5.2 Step A — Create GRN (InventoryTransaction)

**Request:** `POST /inventory/transactions`
```json
{
  "transaction_type": "GRN",
  "movement_date": "2026-01-15",
  "posting_date": "2026-01-15",
  "warehouse_code": "W1",
  "source_module": "purchase_order",
  "source_id": 5001,
  "lines": [
    {
      "line_number": 1,
      "item_code": 101,
      "quantity": 100,
      "unit": "kg",
      "unit_price": 10.00,
      "dimensions": { "season_id": 7, "field_id": 12 }
    }
  ]
}
```

**Validation:**
- `movement_date` > `locked_through_date` (2025-12-31) → OK.
- Period open (Jan 2026) → OK.
- Item exists, warehouse exists, UOM `kg` = base unit → OK.
- `total_cost = 1000` → no zero-value policy trigger.

**Ledger entry created:**

| id | item_code | warehouse_code | entry_date | entry_type | quantity | unit_cost | total_cost | running_qty | running_value | costing_batch_id |
|---|---|---|---|---|---|---|---|---|---|---|
| 10001 | 101 | W1 | 2026-01-15 | `IN` | 100 | 10.00 | 1000.00 | 100 | 1000.00 | `BATCH-2026-101-001` |

**InventoryTransaction status:** `confirmed`

### 5.3 Step B — Outbox message created

```sql
INSERT INTO inventory_posting_outbox
  (company_id, event_type, source_id, payload_json, status, idempotency_key)
VALUES
  (1, 'inventory_movement', 10001, '{...}', 'pending', 'inventory_movement:10001');
```

**Payload snapshot:**
```json
{
  "company_id": 1,
  "ref_id": 10001,
  "item_code": 101,
  "warehouse": "W1",
  "movement_type": "GRN",
  "value": 1000.00,
  "date": "2026-01-15",
  "item_name": "Fertilizer-X",
  "prod_posting_group_code": "RAW_MAT",
  "inv_posting_group_code": "MAIN_WH",
  "dimensions": { "season_id": 7, "field_id": 12 }
}
```

### 5.4 Step C — Background worker processes outbox

1. Picks up message 10001, sets `status = 'processing'`.
2. Calls `FinanceCore.resolveInventoryMovement(db, payload)`.
3. Posting engine resolves:
   - `movement_type = 'GRN'` (INCREASE)
   - Exact match: `rule_type = 'inventory'`, `RAW_MAT` x `MAIN_WH`
   - `inventory_account = 1300-Inventory`
   - Offset (purchases) = `2200-GRNI`
4. `JournalBlueprint`:
   ```
   Line 1: debit 1300-Inventory  1000.00  | rule_slot: inventory_account
   Line 2: credit 2200-GRNI      1000.00  | rule_slot: purchases_account
   ```
5. `validateAccounts` → both exist, active, not headers → OK.
6. `postFromBusinessEvent` writes:
   - `journal_entries` row: `id = 9001`, `ref_type = 'inventory_movement'`, `ref_id = 10001`, `description = 'GRN | Fertilizer-X | W1'`
   - `journal_entry_lines` (2 rows)
   - `business_events` row: `event_type = 'inventory_movement'`, `source_module = 'inventory'`, `source_id = 10001`, `status = 'posted'`
   - `source_documents` + `source_document_links`
   - `posting_rule_resolutions` log with `resolution_step = 1`, `matched_rule_id = 42`

7. Outbox updated: `status = 'done'`, `processed_at = '2026-01-15T10:05:00Z'`.
8. `inventory_movements` updated: `gl_posting_status = 'posted'`, `gl_posted_at = ...`, `journal_entry_id = 9001`.

**Resulting GL entries:**

| account_code | account_name | debit | credit | ref_type | ref_id | rule_slot |
|---|---|---|---|---|---|---|
| 1300 | Inventory | 1000.00 | 0.00 | inventory_movement | 10001 | inventory_account |
| 2200 | GRNI | 0.00 | 1000.00 | inventory_movement | 10001 | purchases_account |

### 5.5 Step D — Supplier invoice arrives (later)

PO line is now invoiced. A `supplier_invoice` transaction is created in the AP module.

**AP module calls FinanceCore:**
- Debit `2200-GRNI` 1000.00 (clear GRNI)
- Credit `2100-Accounts Payable` 1000.00 (create liability)

This is **not** an inventory movement, but the inventory subledger was already correct at GRN time. The GRN-Invoice bridge is maintained by `source_id` linking the inventory GRN back to `purchase_order.id = 5001`.

### 5.6 If invoice price differs (e.g. actual = 10.50)

This triggers a **purchase price variance** scenario:
1. AP invoice posts: Debit `2200-GRNI` 1000.00, Debit `Price Variance` 50.00, Credit `AP` 1050.00.
2. Alternatively, if the policy is to revalue inventory: a separate `InventoryTransaction` of type `ADJUSTMENT` is created to update the moving average cost and post `Inventory 50 / GRNI 50`.

The choice between these two policies (variance account vs inventory revaluation) is controlled by a company-level flag in `inventory_posting_controls` (`purchase_variance_policy`).

### 5.7 Summary of truth ownership

| Step | Quantity | Unit Cost | GL Value | System of Record |
|---|---|---|---|---|
| GRN created | +100 kg | 10.00 | — | Inventory |
| Ledger entry | 100 | 10.00 | 1000 | Inventory |
| GL posted | — | — | 1000 DR Inventory / 1000 CR GRNI | Finance (via Outbox) |
| Invoice posted | — | — | 1000 DR GRNI / 1000 CR AP | Finance (AP module) |

Inventory owns the physical and cost layer. Finance owns the monetary representation. The Outbox is the durable, retryable, auditable bridge between them.

---

## 6. Mapping to Existing Codebase

This design is an evolution of the architecture already present in the system. Below is a direct mapping between the design entities and existing files/tables.

| Design Entity | Existing Implementation | Notes / Gap |
|---|---|---|
| `InventoryTransaction` + `InventoryTransactionLine` | `inventory_movements` (single table) | **Refactor opportunity:** split into header + lines to support multi-line GRNs and better document control. |
| `InventoryLedgerEntry` | `inventory_movements` (it currently acts as both line + ledger) | **Refactor opportunity:** extract a true perpetual ledger table so balance queries do not scan the entire movement history. |
| `Item` | `items` | Already has `prod_posting_group_code`, `inv_posting_group_code`. Add `costing_method` and `track_lots` / `track_serial`. |
| `Warehouse` | `warehouses` (inferred from `inventory_movements.warehouse`) | Formalize with `inv_posting_group_code` override. |
| `MovementType` | Hard-coded strings (`اضافة`, `صرف`) | **New:** create a `movement_types` reference table with `direction`, `affects_inventory`, `requires_reference`. |
| `PostingProfile` | `posting_rules` (with `rule_type = 'general'|'inventory'|'control'`) | Already implements the cascade resolution. Extend to explicitly support the movement-type dimension. |
| `OutboxMessage` | `inventory_posting_outbox` | Already implemented with `idempotency_key`, `status`, `attempts`. Keep as-is. |
| Posting modes | `inventory_posting_controls.posting_mode` | Already has `strict_sync`, `async_reliable`, `decoupled`. Keep as-is. |
| `FinanceCore.resolveInventoryMovement` | `src/lib/finance/resolvers/inventory.ts` + `posting_engine.ts` | Already resolves via `JournalBlueprint`. Enhance to accept `movement_type` as a first-class dimension in the cascade. |
| `postFromBusinessEvent` | `src/lib/finance/business_events.ts` | Already writes `journal_entries`, `business_events`, `source_documents`. Keep as-is. |
| `BatchPostJob` | `batch_post_jobs` + `batch_post_job_items` | Used for bulk import and background posting. Complements the outbox for batch scenarios. |
| Zero-value policy | `validateZeroValuePolicy` in `src/lib/inventory_posting.ts` | Already implemented. Extend to support `zero_value_approval_roles`. |
| Lock dates | `enforceInventoryLockDate` in `src/lib/inventory_posting.ts` | Already implemented. |
| Idempotency | `UNIQUE(company_id, idempotency_key)` on outbox | Already implemented. |
| `source_documents` bridge | `source_documents` + `source_document_links` | Already implemented. |
| `posting_rule_resolutions` | Already exists | Already logs resolution traces. |

### Recommended implementation order

1. **Create `movement_types` reference table** and migrate existing hard-coded strings (`اضافة`, `صرف`) to typed codes (`GRN`, `ISSUE`).
2. **Split `inventory_movements`** into `inventory_transactions` (header) + `inventory_transaction_lines` (lines) + `inventory_ledger_entries` (perpetual ledger). This is the biggest refactor but unlocks true document control and costing methods.
3. **Add `costing_method` to `items`** and implement FIFO layer allocation table (`fifo_cost_layer_allocation`).
4. **Extend `posting_rules`** to include `movement_type` as a resolution dimension.
5. **Create `inventory_transactions.status` workflow** (`draft` → `confirmed` → `posted`) so unconfirmed documents do not hit the ledger.
6. **Enhance the outbox worker** to check `gl_posting_status` before reprocessing, making it fully idempotent even across restarts.
