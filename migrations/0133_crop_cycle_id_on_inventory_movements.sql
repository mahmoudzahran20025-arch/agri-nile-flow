-- Migration: 0133 — Add crop_cycle_id to inventory_movements
--
-- When an ISSUE movement has crop_cycle_id set, resolveInventoryMovement must
-- route the material cost into wip_ledger (cost_category='materials') instead
-- of posting directly to COGS or an expense account.
--
-- Also added to cash_transactions: cash expenses (irrigation, contractor, transport)
-- can now be attributed directly to a crop cycle for WIP accumulation.
--
-- Nullable: existing movements without crop_cycle_id behave exactly as before.
-- The WIP routing is an opt-in behavior on new transactions.

ALTER TABLE inventory_movements ADD COLUMN crop_cycle_id INTEGER REFERENCES crop_cycles(id);

ALTER TABLE cash_transactions ADD COLUMN crop_cycle_id INTEGER REFERENCES crop_cycles(id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_crop_cycle
  ON inventory_movements(company_id, crop_cycle_id)
  WHERE crop_cycle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_transactions_crop_cycle
  ON cash_transactions(company_id, crop_cycle_id)
  WHERE crop_cycle_id IS NOT NULL;
