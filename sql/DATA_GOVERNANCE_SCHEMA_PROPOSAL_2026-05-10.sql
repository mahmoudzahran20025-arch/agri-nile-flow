-- Data Governance Schema Proposal (non-destructive)
-- Date: 2026-05-10
-- Purpose: Canonical supplier/service/statement governance for all movement modules.
-- Note: Review in staging first, then convert to migration.

BEGIN TRANSACTION;

-- 1) Canonical service taxonomy table
CREATE TABLE IF NOT EXISTS service_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  service_group TEXT NOT NULL, -- MECHANIZATION/LABOR/SUPPLY/LOGISTICS/OTHER
  default_expense_account_code TEXT,
  default_ap_account_code TEXT,
  requires_supplier INTEGER NOT NULL DEFAULT 0,
  requires_document INTEGER NOT NULL DEFAULT 0,
  requires_center INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, code)
);

-- 2) Governance flags table (instead of technical tags inside notes)
CREATE TABLE IF NOT EXISTS movement_governance_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  source_module TEXT NOT NULL,      -- treasury/suppliers/inventory/operations
  source_table TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  flag_code TEXT NOT NULL,          -- MISSING_DIMENSION / MISSING_POSTING_LINK / etc
  flag_status TEXT NOT NULL DEFAULT 'open', -- open/resolved/waived
  flag_details TEXT,
  created_by INTEGER,
  resolved_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  UNIQUE(company_id, source_table, source_id, flag_code)
);

-- 3) Canonical column additions (safe nullable)
-- supplier_transactions
ALTER TABLE supplier_transactions ADD COLUMN statement_text TEXT;
ALTER TABLE supplier_transactions ADD COLUMN service_type_code TEXT;
ALTER TABLE supplier_transactions ADD COLUMN notes_internal TEXT;

-- cash_transactions
ALTER TABLE cash_transactions ADD COLUMN statement_text TEXT;
ALTER TABLE cash_transactions ADD COLUMN service_type_code TEXT;
ALTER TABLE cash_transactions ADD COLUMN notes_internal TEXT;

-- inventory_movements
ALTER TABLE inventory_movements ADD COLUMN statement_text TEXT;
ALTER TABLE inventory_movements ADD COLUMN service_type_code TEXT;
ALTER TABLE inventory_movements ADD COLUMN notes_internal TEXT;
ALTER TABLE inventory_movements ADD COLUMN document_date TEXT;

-- 4) Indexes for governance quality scans
CREATE INDEX IF NOT EXISTS idx_supplier_tx_service_type
  ON supplier_transactions(company_id, service_type_code, status);

CREATE INDEX IF NOT EXISTS idx_cash_tx_service_type
  ON cash_transactions(company_id, service_type_code, status);

CREATE INDEX IF NOT EXISTS idx_inventory_mov_service_type
  ON inventory_movements(company_id, service_type_code, movement_type);

CREATE INDEX IF NOT EXISTS idx_inventory_mov_supplier_doc
  ON inventory_movements(company_id, movement_type, supplier_code, document_number);

-- 5) Seed baseline taxonomy (idempotent)
INSERT OR IGNORE INTO service_types
(company_id, code, name_ar, name_en, service_group, requires_supplier, requires_document, requires_center, is_active)
VALUES
(1, 'SRV_MECH', 'ميكنة', 'Mechanization', 'MECHANIZATION', 1, 1, 1, 1),
(1, 'SRV_LABOR', 'عمالة', 'Labor', 'LABOR', 0, 0, 1, 1),
(1, 'SRV_SUPPLY', 'توريد', 'Supply', 'SUPPLY', 1, 1, 1, 1),
(1, 'SRV_LOGISTICS', 'نقل', 'Logistics', 'LOGISTICS', 0, 1, 1, 1);

-- 6) Lightweight backfill (best effort)
UPDATE supplier_transactions
SET statement_text = COALESCE(statement_text, notes)
WHERE statement_text IS NULL AND notes IS NOT NULL;

UPDATE cash_transactions
SET statement_text = COALESCE(statement_text, narration)
WHERE statement_text IS NULL AND narration IS NOT NULL;

UPDATE inventory_movements
SET statement_text = COALESCE(statement_text, notes)
WHERE statement_text IS NULL AND notes IS NOT NULL;

-- service_type backfill from legacy categories
UPDATE supplier_transactions
SET service_type_code = 'SRV_MECH'
WHERE service_type_code IS NULL AND TRIM(COALESCE(expense_category, '')) = 'ميكنة';

UPDATE supplier_transactions
SET service_type_code = 'SRV_LABOR'
WHERE service_type_code IS NULL AND TRIM(COALESCE(expense_category, '')) = 'عمالة';

COMMIT;

-- Post-apply verification queries
-- SELECT code, name_ar, service_group FROM service_types ORDER BY code;
-- SELECT COUNT(*) FROM supplier_transactions WHERE status='posted' AND statement_text IS NULL;
-- SELECT COUNT(*) FROM inventory_movements WHERE movement_type='GRN' AND supplier_code IS NULL;
