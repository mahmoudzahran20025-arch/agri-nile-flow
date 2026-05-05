-- Migration: 0058 — Complete Equipment Module Integration
--
-- PURPOSE: Consolidate equipment tracking into fixed_assets, link supplier
-- transactions to assets, add equipment types catalog, and enable proper GL routing
--
-- NEW TABLES:
-- - equipment_types: Catalog of equipment (tractor, pump, harvester, etc.)
-- - fixed_assets_supplier_link: Junction between supplier_transactions and fixed_assets
--
-- MODIFIED:
-- - fixed_assets: Add supplier_transaction_id, asset_status
-- - expense_types: Add asset_nature ('expense' vs 'asset')

-- ============================================================================
-- 1. CREATE equipment_types catalog
-- ============================================================================
CREATE TABLE IF NOT EXISTS equipment_types (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'other'
                    CHECK(category IN ('vehicle', 'machinery', 'irrigation', 'harvest', 'storage', 'other')),
  asset_nature      TEXT NOT NULL DEFAULT 'capital'
                    CHECK(asset_nature IN ('capital', 'consumable')),
  default_life_months INTEGER NOT NULL DEFAULT 60,
  notes             TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE INDEX idx_equipment_types_company ON equipment_types(company_id, is_active);

-- Seed default equipment types
INSERT INTO equipment_types (company_id, code, name, category, asset_nature, default_life_months)
SELECT c.id, 'TRACTOR', 'جرار', 'vehicle', 'capital', 84
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM equipment_types et WHERE et.company_id = c.id AND et.code = 'TRACTOR');

INSERT INTO equipment_types (company_id, code, name, category, asset_nature, default_life_months)
SELECT c.id, 'PUMP', 'طلمبة', 'irrigation', 'capital', 60
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM equipment_types et WHERE et.company_id = c.id AND et.code = 'PUMP');

INSERT INTO equipment_types (company_id, code, name, category, asset_nature, default_life_months)
SELECT c.id, 'HARVESTER', 'حصادة', 'harvest', 'capital', 72
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM equipment_types et WHERE et.company_id = c.id AND et.code = 'HARVESTER');

INSERT INTO equipment_types (company_id, code, name, category, asset_nature, default_life_months)
SELECT c.id, 'SPARE_PARTS', 'قطع غيار', 'other', 'consumable', 12
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM equipment_types et WHERE et.company_id = c.id AND et.code = 'SPARE_PARTS');

INSERT INTO equipment_types (company_id, code, name, category, asset_nature, default_life_months)
SELECT c.id, 'FUEL', 'وقود', 'other', 'consumable', 1
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM equipment_types et WHERE et.company_id = c.id AND et.code = 'FUEL');

-- ============================================================================
-- 2. EXTEND fixed_assets with supplier transaction linking
-- ============================================================================
ALTER TABLE fixed_assets ADD COLUMN supplier_transaction_id INTEGER;
ALTER TABLE fixed_assets ADD COLUMN equipment_type_id INTEGER;
ALTER TABLE fixed_assets ADD COLUMN asset_status TEXT NOT NULL DEFAULT 'active'
                           CHECK(asset_status IN ('active', 'disposed', 'maintenance'));
ALTER TABLE fixed_assets ADD COLUMN disposal_date TEXT;
ALTER TABLE fixed_assets ADD COLUMN disposal_notes TEXT;

-- Add foreign keys
CREATE TRIGGER IF NOT EXISTS fk_fixed_assets_supplier_txn
  BEFORE INSERT ON fixed_assets
  BEGIN
    SELECT CASE
      WHEN NEW.supplier_transaction_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM supplier_transactions WHERE id = NEW.supplier_transaction_id)
      THEN RAISE(ABORT, 'Invalid supplier_transaction_id')
    END;
  END;

-- ============================================================================
-- 3. EXTEND expense_types with asset classification
-- ============================================================================
ALTER TABLE expense_types ADD COLUMN asset_nature TEXT DEFAULT 'expense'
                           CHECK(asset_nature IN ('expense', 'capital_asset', 'consumable_asset'));

-- Mark existing معدات entry as capital
UPDATE expense_types SET asset_nature = 'capital_asset'
WHERE company_id = 1 AND name LIKE '%معدات%';

-- ============================================================================
-- 4. CREATE junction table (optional, for audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fixed_assets_supplier_link (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id               INTEGER NOT NULL,
  fixed_asset_id           INTEGER NOT NULL,
  supplier_transaction_id  INTEGER NOT NULL,
  linked_at                TEXT NOT NULL DEFAULT (datetime('now')),
  created_by               INTEGER,
  notes                    TEXT,
  UNIQUE(fixed_asset_id, supplier_transaction_id),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(fixed_asset_id) REFERENCES fixed_assets(id),
  FOREIGN KEY(supplier_transaction_id) REFERENCES supplier_transactions(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE INDEX idx_assets_supplier_link ON fixed_assets_supplier_link(company_id, fixed_asset_id);

-- ============================================================================
-- 5. UPDATE posting_rules for proper GL routing
-- ============================================================================

-- Ensure EQUIP_CAP posts to asset account (1130)
DELETE FROM general_posting_setup WHERE company_id = 1
  AND prod_posting_group_code = 'EQUIP_CAP';

INSERT INTO general_posting_setup
(company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES
(1, 'AGRI-OP', 'EQUIP_CAP', '41010001', '11030001', NULL, '41010001', '11030001', '62010001', 1);

-- EQUIP_CONS posts to consumable expense (5x)
DELETE FROM general_posting_setup WHERE company_id = 1
  AND prod_posting_group_code = 'EQUIP_CONS';

INSERT INTO general_posting_setup
(company_id, bus_posting_group_code, prod_posting_group_code, sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active)
VALUES
(1, 'AGRI-OP', 'EQUIP_CONS', '41010001', '14070105', '55010004', '41010001', '14070105', '62010002', 1);

-- ============================================================================
-- 6. VERIFY data integrity
-- ============================================================================
SELECT 'Equipment types seeded' as status, COUNT(*) as count FROM equipment_types WHERE company_id = 1;
SELECT 'Fixed assets with supplier link' as status, COUNT(*) as count FROM fixed_assets WHERE supplier_transaction_id IS NOT NULL;
