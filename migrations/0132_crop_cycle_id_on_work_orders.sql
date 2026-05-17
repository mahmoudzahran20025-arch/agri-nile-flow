-- Migration: 0132 — Add crop_cycle_id to work_orders
--
-- When a work order has crop_cycle_id set, resolveWorkOrderLabor must route
-- the labor cost into wip_ledger (cost_category='labor') instead of posting
-- directly to an expense account.
--
-- Nullable: existing work orders without a crop_cycle_id continue to behave
-- as before — labor posts to operating expense. This is the backward-compatible
-- opt-in pattern: only new work orders created for a crop cycle enter WIP.

ALTER TABLE work_orders ADD COLUMN crop_cycle_id INTEGER REFERENCES crop_cycles(id);

CREATE INDEX IF NOT EXISTS idx_work_orders_crop_cycle
  ON work_orders(company_id, crop_cycle_id)
  WHERE crop_cycle_id IS NOT NULL;
