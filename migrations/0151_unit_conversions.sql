-- Migration 0151 — unit_conversions table
--
-- resolveUnitFactor() in finance_core.ts queries this table for UOM conversion
-- factors but the table was never created (migration 0120 only had INSERTs).
-- This migration creates the table and backfills common agricultural conversions.
--
-- item_units (from migration 001) is a dead table — never queried by any resolver.
-- It is left in place to avoid breaking existing data but should not be used.
-- New UOM conversions go in unit_conversions.

CREATE TABLE IF NOT EXISTS unit_conversions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  item_code   INTEGER,                    -- NULL = global conversion
  from_unit   TEXT    NOT NULL,
  to_unit     TEXT    NOT NULL,
  factor      REAL    NOT NULL,           -- to_unit = from_unit × factor
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  UNIQUE(company_id, item_code, from_unit, to_unit)
);

CREATE INDEX IF NOT EXISTS idx_unit_conv_company
  ON unit_conversions(company_id, is_active, from_unit, to_unit);

-- Seed common agricultural global conversions for every active company.
-- factor: to_unit = from_unit × factor
-- Example: 1 TON = 1000 KG → from_unit=TON, to_unit=KG, factor=1000
INSERT OR IGNORE INTO unit_conversions (company_id, item_code, from_unit, to_unit, factor, is_active)
SELECT c.id, NULL, 'طن',   'كجم',  1000,  1 FROM companies c WHERE c.is_active = 1
UNION ALL
SELECT c.id, NULL, 'كجم',  'جم',   1000,  1 FROM companies c WHERE c.is_active = 1
UNION ALL
SELECT c.id, NULL, 'طن',   'جم',   1000000, 1 FROM companies c WHERE c.is_active = 1
UNION ALL
SELECT c.id, NULL, 'لتر',  'مل',   1000,  1 FROM companies c WHERE c.is_active = 1
UNION ALL
SELECT c.id, NULL, 'فدان', 'قيراط', 24,   1 FROM companies c WHERE c.is_active = 1;
