-- End-to-end master-data alignment
-- Scope:
-- 1) Ensure administrative field 1006011 exists in fields
-- 2) Ensure field.center_code is synchronized with cost center code when possible
-- 3) Resolve orphan center codes observed in journal_entry_lines (2104, 210101)
-- 4) Materialize crop/main-account mapping that replaces JSON nulls

-- 1) Ensure field 1006011 exists
INSERT INTO fields (company_id, code, name, area_feddan, crop_type, location, is_active, center_code)
SELECT 1, '1006011', 'إدارية أرض الدلتا الجديدة', 0, 'إداري', 'أراضي الدلتا الجديدة', 1, 1006011
WHERE NOT EXISTS (
  SELECT 1 FROM fields WHERE company_id = 1 AND code = '1006011'
);

-- 2) Backfill missing field.center_code from cost_centers.code
UPDATE fields
SET center_code = CAST(code AS INTEGER)
WHERE company_id = 1
  AND center_code IS NULL
  AND EXISTS (
    SELECT 1
    FROM cost_centers cc
    WHERE cc.company_id = fields.company_id
      AND cc.code = fields.code
  );

-- 3) Register orphan center codes as explicit legacy centers
INSERT INTO cost_centers (company_id, code, name_ar, name_en, cost_center_type, is_active)
SELECT 1, '2104', 'مركز تكلفة مرجعي 2104 (Legacy)', 'Legacy Center 2104', 'OVERHEAD', 1
WHERE NOT EXISTS (
  SELECT 1 FROM cost_centers WHERE company_id = 1 AND code = '2104'
);

INSERT INTO cost_centers (company_id, code, name_ar, name_en, cost_center_type, is_active)
SELECT 1, '210101', 'مركز تكلفة مرجعي 210101 (Legacy)', 'Legacy Center 210101', 'OVERHEAD', 1
WHERE NOT EXISTS (
  SELECT 1 FROM cost_centers WHERE company_id = 1 AND code = '210101'
);

-- 4) Crop/main account mapping table (for null-account JSON list)
CREATE TABLE IF NOT EXISTS crop_account_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  crop_label TEXT NOT NULL,
  account_code TEXT NOT NULL,
  mapping_scope TEXT NOT NULL DEFAULT 'MAIN',
  source TEXT NOT NULL DEFAULT 'json_seed_2026_05_08',
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, crop_label)
);

-- Non-crop / control mappings
INSERT INTO crop_account_mappings (company_id, crop_label, account_code, notes)
VALUES
  (1, 'موردون محليون', '21100001', 'Mapped to local suppliers payable account'),
  (1, 'عملاء محليون', '14030001', 'Mapped to local customers receivable account'),
  (1, 'خدمات ادارية', '51010019', 'Mapped to general admin expenses'),
  (1, 'أ.ث تحت الانشاء', '13050001', 'Mapped to pre-operating/capitalized placeholder account'),
  (1, 'مصاريف اصول ثابتة', '51010019', 'Mapped to admin expense placeholder pending detailed policy'),
  (1, 'ارصدة افتتاحية', '14040211', 'Mapped to generic prepaid/misc placeholder pending opening-balance policy')
ON CONFLICT(company_id, crop_label) DO UPDATE SET
  account_code = excluded.account_code,
  notes = excluded.notes,
  is_active = 1,
  updated_at = datetime('now');

-- Crop mappings (defaulted to finished crop inventory account until crop-specific CoA is expanded)
INSERT INTO crop_account_mappings (company_id, crop_label, account_code, notes)
VALUES
  (1, 'بطاطس شتوى', '14070401', 'Default crop inventory account'),
  (1, 'بطاطس صيفى', '14070401', 'Default crop inventory account'),
  (1, 'البصل', '14070401', 'Default crop inventory account'),
  (1, 'ذرة سيلاج', '14070401', 'Default crop inventory account'),
  (1, 'ذرة حب', '14070401', 'Default crop inventory account'),
  (1, 'قمح', '14070401', 'Default crop inventory account'),
  (1, 'خيار', '14070401', 'Default crop inventory account'),
  (1, 'بطاطا', '14070401', 'Default crop inventory account'),
  (1, 'بنجر السكر', '14070401', 'Default crop inventory account'),
  (1, 'فول سوداني', '14070401', 'Default crop inventory account'),
  (1, 'فاصوليا', '14070401', 'Default crop inventory account'),
  (1, 'زراعات قرع', '14070401', 'Default crop inventory account'),
  (1, 'فول بلدي', '14070401', 'Default crop inventory account'),
  (1, 'زراعات خوخ', '14070401', 'Default crop inventory account'),
  (1, 'زراعات قصب', '14070401', 'Default crop inventory account'),
  (1, 'زراعات زيتون', '14070401', 'Default crop inventory account'),
  (1, 'زراعات ثوم', '14070401', 'Default crop inventory account'),
  (1, 'زراعات بصل قنار', '14070401', 'Default crop inventory account'),
  (1, 'ذرة رفيعه', '14070401', 'Default crop inventory account'),
  (1, 'زراعات عنب', '14070401', 'Default crop inventory account'),
  (1, 'زراعات مانجو', '14070401', 'Default crop inventory account'),
  (1, 'فلفل', '14070401', 'Default crop inventory account'),
  (1, 'شعير', '14070401', 'Default crop inventory account')
ON CONFLICT(company_id, crop_label) DO UPDATE SET
  account_code = excluded.account_code,
  notes = excluded.notes,
  is_active = 1,
  updated_at = datetime('now');

-- Post-check snapshot
SELECT 'fields_1006011' AS metric, COUNT(*) AS n FROM fields WHERE company_id=1 AND code='1006011';
SELECT 'fields_missing_center_code' AS metric, COUNT(*) AS n FROM fields WHERE company_id=1 AND center_code IS NULL;
SELECT 'orphan_centers_unregistered' AS metric, COUNT(*) AS n
FROM journal_entry_lines l
WHERE l.company_id = 1
  AND l.center_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cost_centers cc
    WHERE cc.company_id = l.company_id AND cc.code = CAST(l.center_code AS TEXT)
  );
SELECT 'crop_account_mappings_count' AS metric, COUNT(*) AS n FROM crop_account_mappings WHERE company_id=1;
