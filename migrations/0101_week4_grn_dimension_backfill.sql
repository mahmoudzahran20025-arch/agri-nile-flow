-- ============================================================
-- Migration 0101: Week 4 — GRN Dimension Backfill
-- Problem: 70 GRN inventory_movements have center_code=NULL and season_id=NULL.
--          These were tagged NEEDS_DIMENSION:center_code during data remediation.
-- Coverage:
--   64 rows → 2025-11-24 to 2026-04-30 → season_id=1 (الموسم الشتوي 2025-2026)
--    6 rows → 2026-05-09                → season_id=2 (الموسم الصيفي 2026)
-- Center: all rows lack field_id/warehouse_id as alternate source,
--         so we assign to root cost center 1006011 (ادارية ارض الدلتا الجديدة)
--         as the farm-wide holding code until Finance assigns specific pivots.
-- ============================================================

-- ── Step 1: Assign winter season + farm root center ───────────
UPDATE inventory_movements
SET
  season_id   = 1,
  center_code = '1006011'
WHERE company_id   = 1
  AND movement_type = 'GRN'
  AND center_code  IS NULL
  AND movement_date >= '2025-11-06'
  AND movement_date <= '2026-04-30';

-- ── Step 2: Assign summer season + farm root center ───────────
UPDATE inventory_movements
SET
  season_id   = 2,
  center_code = '1006011'
WHERE company_id   = 1
  AND movement_type = 'GRN'
  AND center_code  IS NULL
  AND movement_date >= '2026-05-01'
  AND movement_date <= '2026-10-31';

-- ── Step 3: Safety net — any remaining NULLs get winter + root center ──
-- (should be 0, but protects against future edge cases)
UPDATE inventory_movements
SET
  season_id   = 1,
  center_code = '1006011'
WHERE company_id   = 1
  AND movement_type = 'GRN'
  AND center_code  IS NULL;

-- ── Step 4: Log governance note ───────────────────────────────
INSERT INTO system_error_logs
  (company_id, user_id, endpoint, method, error_message, stack_trace, request_payload, created_at)
VALUES
  (1, 1,
   'FINANCIAL_WORKFLOW:inventory_dimensions',
   'MIGRATION_0101',
   '70 GRN inventory_movements backfilled with default center_code=1006011 (ادارية ارض الدلتا الجديدة). Finance must review and assign specific pivot/field center codes per movement. Season assigned by date range.',
   'Migration 0101 governance log. 64 rows → season_id=1, 6 rows → season_id=2. All assigned center_code=1006011 as holding code.',
   '{"migration":"0101","table":"inventory_movements","movement_type":"GRN","rows_affected":70,"default_center":"1006011","action":"dimension_backfill_holding_code","finance_action_required":true}',
   datetime('now'));

-- ── Verification ──────────────────────────────────────────────
-- SELECT movement_type, COUNT(*) as total,
--        SUM(CASE WHEN center_code IS NULL THEN 1 ELSE 0 END) as null_center,
--        SUM(CASE WHEN season_id IS NULL THEN 1 ELSE 0 END) as null_season
-- FROM inventory_movements WHERE company_id=1 GROUP BY movement_type;
-- Expected GRN: null_center=0, null_season=0
