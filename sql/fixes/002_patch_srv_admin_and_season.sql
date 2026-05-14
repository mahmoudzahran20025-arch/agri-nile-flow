-- =============================================================================
-- PATCH 002: SRV_ADMIN INSERT + 2026-05-09 SEASON BACKFILL
-- Generated: 2026-05-11
-- Purpose: Fix items that failed in 001 due to column ordering issue
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. INSERT SRV_ADMIN (failed in 001 because bus_posting_group_code column
--    was added AFTER the INSERT in that script)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO service_types
  (company_id, code, name_ar, name_en, service_group,
   default_expense_account_code, default_ap_account_code,
   requires_supplier, requires_document, requires_center, is_active,
   bus_posting_group_code)
VALUES
  (1, 'SRV_ADMIN', 'خدمات إدارية وتشغيلية', 'Administrative / Operational Services',
   'ADMINISTRATION', '51200034', '212000013', 1, 0, 0, 1, 'BPG_ADMIN');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ADD SRV_ADMIN → supplier_service_map for 20900151
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO supplier_service_map
  (company_id, supplier_code, service_type_code, default_ap_account_code,
   default_expense_account_code, is_primary, is_active)
VALUES
  (1, 20900151, 'SRV_ADMIN', '212000013', '51200034', 0, 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL season_id FOR 2026-05-09 MOVEMENTS
-- These 46 movements are post-season maintenance/rebuild entries.
-- Season 1 officially ended 2026-04-30, but these belong to the same
-- operational context (winter 2025-2026 close). Assign to season 1.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE inventory_movements
SET season_id = 1
WHERE
  company_id  = 1
  AND season_id IS NULL
  AND movement_date = '2026-05-09';

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'SRV_ADMIN in service_types' AS check_label,
  code, name_ar, default_expense_account_code, default_ap_account_code, bus_posting_group_code
FROM service_types WHERE company_id = 1 AND code = 'SRV_ADMIN';

SELECT 'null_season_count' AS check_label, COUNT(*) AS cnt
FROM inventory_movements WHERE company_id = 1 AND season_id IS NULL;
