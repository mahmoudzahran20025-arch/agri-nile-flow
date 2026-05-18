-- Migration 0145: Add base_unit to items table
-- base_unit is the canonical unit for all inventory_movements.quantity values.
-- Defaults from the existing free-text `unit` column so no data is lost.
-- NOT NULL is intentionally NOT enforced here — legacy items with unit = NULL
-- will have base_unit = NULL; the UI will warn but not block.

ALTER TABLE items ADD COLUMN base_unit TEXT;

-- Backfill from existing unit column where present
UPDATE items SET base_unit = unit WHERE unit IS NOT NULL AND base_unit IS NULL;
