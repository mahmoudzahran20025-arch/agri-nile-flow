-- Migration 0120: Standard Agricultural Unit Conversions + AP Cleanup
-- Date: 2026-05-15
-- Rationale: Seed mandatory UOM factors and purge redundant legacy tables.

-- 1. DROP DEAD TABLES
DROP TABLE IF EXISTS supplier_invoice_items;
DROP TABLE IF EXISTS supplier_invoices;
DROP TABLE IF EXISTS supplier_code_bridge;

-- 2. SEED STANDARD UNIT CONVERSIONS
INSERT INTO unit_conversions (company_id, item_code, from_unit, to_unit, factor, is_active) 
VALUES 
  (1, NULL, 'TON',   'KG', 1000, 1),
  (1, NULL, 'KG',    'G',  1000, 1),
  (1, NULL, 'L',     'ML', 1000, 1),
  (1, NULL, 'LITER', 'ML', 1000, 1),
  (1, NULL, 'CASE',  'UNIT', 12, 1), -- default case size
  (1, NULL, 'BAG',   'KG',   50, 1), -- 50kg fertilizer bag standard
  (1, NULL, 'DRUM',  'L',   200, 1)  -- 200L drum standard
ON CONFLICT(company_id, item_code, from_unit, to_unit) DO UPDATE SET
  factor = excluded.factor,
  is_active = 1;

SELECT 'migration_0120_complete' AS status,
       (SELECT COUNT(*) FROM unit_conversions WHERE company_id = 1) AS uom_factors_seeded;
