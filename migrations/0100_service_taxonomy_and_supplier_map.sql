-- 0100_service_taxonomy_and_supplier_map.sql
-- Canonical service taxonomy and supplier-to-service governance map.

CREATE TABLE IF NOT EXISTS service_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  service_group TEXT NOT NULL CHECK(service_group IN (
    'MECHANIZATION', 'LABOR', 'SUPPLY', 'LOGISTICS', 'SUPERVISION', 'SPARE_PARTS', 'OTHER'
  )),
  default_expense_account_code TEXT,
  default_ap_account_code TEXT,
  requires_supplier INTEGER NOT NULL DEFAULT 0 CHECK(requires_supplier IN (0, 1)),
  requires_document INTEGER NOT NULL DEFAULT 0 CHECK(requires_document IN (0, 1)),
  requires_center INTEGER NOT NULL DEFAULT 0 CHECK(requires_center IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_service_types_company_active
  ON service_types(company_id, is_active, code);

CREATE TABLE IF NOT EXISTS supplier_service_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  supplier_code INTEGER NOT NULL,
  service_type_code TEXT NOT NULL,
  default_ap_account_code TEXT,
  default_expense_account_code TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, supplier_code, service_type_code)
);

CREATE INDEX IF NOT EXISTS idx_supplier_service_map_lookup
  ON supplier_service_map(company_id, supplier_code, is_active, is_primary);

INSERT INTO service_types (
  company_id,
  code,
  name_ar,
  name_en,
  service_group,
  default_expense_account_code,
  default_ap_account_code,
  requires_supplier,
  requires_document,
  requires_center,
  is_active
)
VALUES
  (1, 'SRV_MECH', 'ميكنة', 'Mechanization', 'MECHANIZATION', '5101', '212000013', 1, 1, 1, 1),
  (1, 'SRV_LABOR', 'عمالة', 'Labor', 'LABOR', '5101', '21200001', 1, 1, 1, 1),
  (1, 'SRV_SUPPLY', 'توريد ومشتريات', 'Supply', 'SUPPLY', '1407', '212000010', 1, 1, 0, 1),
  (1, 'SRV_LOGISTICS', 'نقل وشحن', 'Logistics', 'LOGISTICS', '33003', '212000010', 1, 1, 1, 1),
  (1, 'SRV_SUPERVISION', 'اشراف زراعي', 'Agricultural Supervision', 'SUPERVISION', '33067', '212000010', 1, 1, 1, 1),
  (1, 'SRV_SPARE_PARTS', 'قطع غيار', 'Spare Parts', 'SPARE_PARTS', '1407', '212000010', 1, 1, 0, 1)
ON CONFLICT(company_id, code) DO UPDATE SET
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  service_group = excluded.service_group,
  default_expense_account_code = excluded.default_expense_account_code,
  default_ap_account_code = excluded.default_ap_account_code,
  requires_supplier = excluded.requires_supplier,
  requires_document = excluded.requires_document,
  requires_center = excluded.requires_center,
  is_active = excluded.is_active,
  updated_at = datetime('now');

INSERT INTO supplier_service_map (
  company_id,
  supplier_code,
  service_type_code,
  default_ap_account_code,
  default_expense_account_code,
  is_primary,
  is_active
)
VALUES
  (1, 20100033, 'SRV_MECH', '212000019', '5101', 1, 1),
  (1, 20300086, 'SRV_MECH', '212000020', '5101', 1, 1),
  (1, 20300121, 'SRV_MECH', '212000029', '5101', 1, 1),
  (1, 21400002, 'SRV_LABOR', '212000018', '5101', 1, 1),
  (1, 21400108, 'SRV_LABOR', '212000017', '5101', 1, 1),
  (1, 20800286, 'SRV_SPARE_PARTS', '212000010', '1407', 1, 1),
  (1, 35300902, 'SRV_SUPPLY', '212000010', '1407', 1, 1),
  (1, 20900151, 'SRV_SUPPLY', '212000010', '1407', 1, 1),
  (1, 20900151, 'SRV_MECH', '212000013', '5101', 0, 1),
  (1, 20900353, 'SRV_SUPPLY', '212000010', '1407', 1, 1),
  (1, 20900353, 'SRV_SUPERVISION', '212000010', '33067', 0, 1)
ON CONFLICT(company_id, supplier_code, service_type_code) DO UPDATE SET
  default_ap_account_code = excluded.default_ap_account_code,
  default_expense_account_code = excluded.default_expense_account_code,
  is_primary = excluded.is_primary,
  is_active = excluded.is_active,
  updated_at = datetime('now');

UPDATE suppliers
SET gl_account_code = CASE code
  WHEN 21400002 THEN '212000018'
  WHEN 21400108 THEN '212000017'
  ELSE gl_account_code
END
WHERE company_id = 1
  AND code IN (21400002, 21400108)
  AND (gl_account_code IS NULL OR gl_account_code = '');

SELECT 'service_taxonomy_seeded' AS status,
       (SELECT COUNT(*) FROM service_types WHERE company_id = 1) AS service_type_count,
       (SELECT COUNT(*) FROM supplier_service_map WHERE company_id = 1) AS supplier_service_map_count;