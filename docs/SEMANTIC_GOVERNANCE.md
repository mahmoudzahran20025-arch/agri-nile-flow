# Canonical ERP Semantic Governance
**Agri-Nile Flow — v1.0 · 2026-05-18**

This document is the semantic constitution of the system. Every decision here
is a FROZEN RULE — do not re-litigate, do not hardcode alternatives, do not
allow a new feature to violate these boundaries. If a rule must change, update
this document and create a migration to match.

---

## 1. Canonical Item Semantics

An item is a stockable, transferable, priceable unit of value identified by
`item_code` within a `company_id`.

| Property | Owner | Rule |
|---|---|---|
| Identity | `items.code` | **Immutable** after first movement. Never reuse a code. |
| Name | `items.name` | Display-only. `item_code` is canonical. |
| Base unit | `items.base_unit_code` | **Immutable** after first movement. All balances in this unit. |
| Behavioral class | `items.item_type` | `raw_material / finished_good / service / fixed_asset / consumable` — governs legal movement types. |
| WIP eligibility | `items.is_wip_trackable` | Only flag-set items appear in `wip_ledger`. |
| POS eligibility | `items.is_pos_item` | Only these appear in POS cart. |
| Catalog status | `items.catalog_status` | `active / discontinued / draft`. Discontinued = no new purchases; Draft = invisible to all transaction flows. |

**FROZEN:** `item_type` and `base_unit_code` cannot change once any movement
exists. Any migration attempting this must validate zero movement history first.

---

## 2. Canonical Movement Semantics

A movement is an **immutable** atomic record of quantity and value flowing into
or out of a warehouse. Every movement has: one direction (IN/OUT), one item,
one warehouse, one date.

| Code | Direction | GL Effect | Created by |
|---|---|---|---|
| `GRN` | IN | DR inventory / CR accounts_payable | PO receipt |
| `GRN_REVERSE` | OUT | DR accounts_payable / CR inventory | PO void |
| `ISSUE` | OUT | DR expense/COGS / CR inventory | Work order dispatch |
| `RETURN_CUSTOMER` | IN | DR sales_returns / CR cash or receivable | Sales return or sales void |
| `RETURN_SUPPLIER` | OUT | DR accounts_payable / CR inventory | Supplier return |
| `TRANSFER_IN` | IN | No GL (inter-warehouse) | Warehouse transfer |
| `TRANSFER_OUT` | OUT | No GL (inter-warehouse) | Warehouse transfer |
| `ADJUSTMENT_PROFIT` | IN | DR inventory / CR inventory_adjustment | Physical count gain |
| `ADJUSTMENT_LOSS` | OUT | DR inventory_adjustment / CR inventory | Physical count loss |
| `PRODUCTION_INPUT` | OUT | DR WIP / CR inventory | Manufacturing input |
| `PRODUCTION_OUTPUT` | IN | DR inventory / CR WIP | Finished good receipt |
| `SALE` | OUT | DR receivable or cash / CR inventory (COGS) | Sales order |

**FROZEN rules:**
- Movement rows are **immutable** after creation. Reversal always creates a
  new opposing movement, never edits an existing one.
- `inventory_balances` is the **authoritative running balance**. Never compute
  balance from `SUM(movements)` in production code.
- `movement_type` is the **single source of truth** for GL dispatch. Do not
  derive GL behavior from any other field.
- New movement types require a code review + `posting_engine.ts` update +
  governance doc update. Never free-text.

---

## 3. Canonical Pricing Ownership

Pricing is owned exclusively by the `pricing_engine` module. No other module
may hardcode prices.

| Level | Scope | Table | Precedence |
|---|---|---|---|
| Base price | Item global | `item_prices` | 5 (lowest) |
| Customer price | Item × customer | `item_prices` (customer_id filter) | 4 |
| Branch price | Item × branch | `item_prices` (branch_id filter) | 3 |
| Promotion | Item × date range | `promotions` / `promotion_items` | 2 |
| Session override | POS session | `pos_sessions.price_list_id` | 1 (highest) |

**FROZEN:** `unit_price` on `sales_order_items` is a **snapshot at time of
sale** — not a foreign key. Once written it never changes, even if the price
list is later modified.

---

## 4. Canonical Valuation Ownership

Inventory is valued at **weighted-average cost**. Authoritative cost:
`inventory_balances.balance_value / balance_qty`.

| Responsibility | Owner |
|---|---|
| Cost of receipt | `unit_price` on GRN movement (from PO item) |
| Running average cost | Computed at each GRN: `(prev_value + qty_in × price) / (prev_qty + qty_in)` |
| COGS on sale | Average cost at time of sale × quantity sold |
| WIP cost | `wip_ledger` accumulates actual costs; settled at harvest |
| Fixed asset depreciation | `depreciation_schedules` — straight-line, monthly |

**FROZEN:** `value_out` on a SALE movement must equal `avg_cost × qty_out`
computed at dispatch time. It is **never** the sale price. Revenue and COGS
are always separate GL lines — never netted.

---

## 5. Canonical WIP Ownership

WIP cost is owned exclusively by `wip_ledger`, keyed to `crop_cycle_id`. No
other table accumulates in-progress agricultural costs.

| Cost category | Entry point |
|---|---|
| Materials issued to field | `PRODUCTION_INPUT` movement → `postCostToWIP()` |
| Labor (work tasks) | `work_tasks` settlement → `postCostToWIP()` |
| Equipment | `work_order_equipment` settlement → `postCostToWIP()` |
| Supplier services | `supplier_transactions` (invoice entry) → `postCostToWIP()` |
| Land rent | `contracts` / direct cash → `postCostToWIP()` |
| Depreciation | Monthly run → `allocateDepreciationToWIP()` |

**Settlement:** `HarvestSettlement` closes the cycle. WIP balance →
Inventory (default) or COGS (`direct_sale` mode). After settlement, status =
`settled`; no further cost entries accepted.

**FROZEN:** `wip_ledger` rows are immutable. Settlement writes a credit entry
that zeroes the balance — it never deletes prior rows.

---

## 6. Canonical Sales Flow

```
Customer order → POST /sales
  ↓
Inventory check: balance_qty ≥ qty OR allow_negative_stock = true
  ↓
SALE movement (qty_out, value_out = avg_cost × qty)
  ↓
inventory_balances updated (atomic, same DB round-trip)
  ↓
sales_order header + sales_order_items written
  ↓
[credit payment] customer.balance += total
  ↓
Non-blocking GL: DR receivable/cash / CR revenue (COGS split)
  ↓
business_events outbox record (idempotent, survives GL failure)
```

**Void:** status → `voided`, RETURN_CUSTOMER movement, customer balance
reversed, GL reversal (swap DR/CR).

**Return:** `POST /sales/returns` → `sales_returns` record, RETURN_CUSTOMER
movements, inventory restored, GL: DR sales_returns_account / CR cash or
receivable. Return quantity ≤ original sale quantity (enforced).

**FROZEN:** A return is always linked to an `original_order_id`. There are no
orphan returns. Return GL is posted to the **return_date period**, not the
original sale period.

---

## 7. Canonical Inventory Normalization Rules

1. **Single warehouse per movement row.** Transfers require two rows
   (TRANSFER_OUT + TRANSFER_IN) with the same `transaction_id`.
2. **Quantities in base unit only.** Unit conversions happen at entry point
   before the movement row is written.
3. **Negative balance guard.** Any movement producing `balance_qty < 0` is
   rejected unless `inventory_posting_controls.allow_negative_stock = 1`.
4. **Backdating propagation.** A movement dated before the last movement
   propagates the delta to all subsequent movements' `balance_qty` and
   `balance_value`.
5. **No direct `inventory_balances` edits.** All balance changes flow through
   movement inserts. Direct UPDATE is only permitted by the balance propagator
   and the adjustment workflow.

---

## 8. Canonical Unit/Package Model

The system supports one unit per item at the movement level (`base_unit_code`).
Package/conversion ratios live in `unit_conversions` and are resolved at entry
time before writing the movement row.

**FROZEN:** `unit_conversions` is append-only per active item. Changing a
conversion factor after movements exist requires a physical adjustment movement
to reconcile. Never retroactively edit a conversion factor.

---

## 9. Canonical Revenue Recognition Flow

Revenue is recognized at physical dispatch (SALE movement) — "earned at
delivery" model for physical goods.

```
SALE movement created
  ↓
GL event: DR accounts_receivable (or cash_default) / CR sales_revenue_account
  ↓
GL event: DR cost_of_goods_sold / CR inventory_asset
```

For credit sales: receivable created immediately. Collection clears it:
DR cash / CR receivable.

For returns: revenue reversed in **period of return**, not period of original
sale.

**FROZEN:** Revenue and COGS are never netted into a single GL line. They must
always be separate entries to support gross margin reporting per account.

---

## 10. Canonical Branch Pricing Hierarchy

Branch is an optional dimension. A branch never owns stock — warehouses own
stock. A branch owns a price list and a cost center.

```
Company
  └── Branch (optional)
        ├── price_list_id → resolves to item_prices rows
        ├── cost_center_code → GL dimension on branch transactions
        └── warehouse_id (default)
```

POS sessions always associate with a branch. The branch's price list governs
the session unless overridden at session open.

**FROZEN:** Branch cannot override tax rates, account mappings, or GL period
rules. Those are company-level. Branch is a pricing and reporting dimension
only — never a GL isolation boundary.

---

## Known Fragmentation Risks

### Duplicated Semantics (must not worsen)

| Conflict | Rule |
|---|---|
| `supplier_transactions.amount` vs `credit/debit` | `amount` = absolute value. `credit`/`debit` = signed components. Never read both for the same purpose. |
| `items.unit` (legacy) vs `items.base_unit_code` (canonical) | `base_unit_code` is authoritative for all new code. `items.unit` is read-only legacy. |
| `sales_order_items.item_name` (snapshot) vs `items.name` (current) | Snapshot is for receipt display only. Never join through it for reporting. |
| `inventory_movements.running_balance` vs `inventory_balances.balance_qty` | `inventory_balances` is authoritative. `running_balance` on movements is audit trail only. |

### Workflow Fragmentation Risks (known, not yet fixed)

1. PO → GRN → AP Invoice are three separate user actions with no enforced
   sequencing. A company can invoice before receiving.
2. A sales return does not verify the original sale GL entry was successfully
   posted — if the GL failed silently, the reversal reverses nothing.
3. WIP settlement requires manual trigger; no automated alert when a cycle
   passes its `expected_harvest_date` without settlement.

### Future Cross-Industry Risks

| Risk | What to do before onboarding that client |
|---|---|
| Service-only clients | Make `sales_orders.warehouse_id` nullable; validate in application layer |
| Multi-currency | Add `currency_code + exchange_rate` columns to all transaction tables |
| Lot/batch/serial | Add `lot_id` to inventory_movements before first lot-tracked client |
| Multi-jurisdiction tax | Add `tax_lines` table before first multi-rate client |
| Approval workflows | Build approval state machine before first enterprise client |

---

## FROZEN RULES SUMMARY (do not violate)

| Rule | Enforcement |
|---|---|
| `item_code` is immutable | DB trigger: `trg_items_code_immutable` |
| `base_unit_code` is immutable after first movement | DB trigger: `trg_items_base_unit_immutable` |
| Movement rows are immutable | DB trigger: `trg_im_no_delete` |
| GL posted entries cannot be deleted | DB trigger: `trg_gl_prevent_posted_delete` |
| `inventory_balances` is the sole balance authority | Application invariant — no direct edits except via propagator |
| GL posting is non-blocking | Architecture invariant — business operations never fail due to GL failures |
| Revenue ≠ COGS — always separate GL lines | Application invariant — `buildSalesRevenueBlueprint` never nets them |
| Branch ≠ GL isolation boundary | Architecture invariant — all GL is company-scoped |
| Weighted-average cost (WAC) only | No FIFO/LIFO until migration workflow exists |
| `company_id` on every query | Architecture invariant — enforced by `getUser(c)` pattern |
