-- Migration 0146 — Item behavioral flags
-- Adds item_type discriminator and is_sellable / is_purchasable flags.
-- Existing rows default to item_type='inventory', is_sellable=1, is_purchasable=1
-- which preserves all current behaviour.
--
-- item_type values:
--   inventory  — physical stock tracked in inventory_movements (current default)
--   service    — non-stock service item (no inventory_movements, no balance)
--   non_stock  — expensed immediately, no perpetual balance
--
-- is_sellable / is_purchasable are validated at API level, not enforced here
-- so existing data isn't broken and the flags are opt-in for new tenants.

ALTER TABLE items ADD COLUMN item_type      TEXT NOT NULL DEFAULT 'inventory'
  CHECK(item_type IN ('inventory', 'service', 'non_stock'));

ALTER TABLE items ADD COLUMN is_sellable    INTEGER NOT NULL DEFAULT 1
  CHECK(is_sellable IN (0, 1));

ALTER TABLE items ADD COLUMN is_purchasable INTEGER NOT NULL DEFAULT 1
  CHECK(is_purchasable IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_items_type
  ON items(company_id, item_type, is_active);
