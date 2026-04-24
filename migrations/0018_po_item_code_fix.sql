-- ============================================================
-- Migration 0018: Fix purchase_order_items.item_code type
-- Problem: item_code was TEXT, but items.code is INTEGER.
--          This broke JOIN with items table (3-way match).
-- Date: 2026-04-24
-- ============================================================

-- SQLite doesn't support ALTER COLUMN TYPE directly.
-- We rename the old column, add the correct INTEGER column,
-- migrate existing numeric values, then drop the old column.

-- Step 1: Preserve the old column under a different name
ALTER TABLE purchase_order_items RENAME COLUMN item_code TO item_code_legacy;

-- Step 2: Add the correctly-typed INTEGER column
ALTER TABLE purchase_order_items ADD COLUMN item_code INTEGER;

-- Step 3: Migrate data — cast numeric strings, leave non-numeric as NULL
UPDATE purchase_order_items
SET item_code = CAST(item_code_legacy AS INTEGER)
WHERE item_code_legacy IS NOT NULL
  AND item_code_legacy GLOB '[0-9]*';

-- Step 4: Index on the new column for JOIN performance
CREATE INDEX IF NOT EXISTS idx_poi_item_code ON purchase_order_items(item_code);
