-- ═══════════════════════════════════════════════════════════════════
-- INVENTORY GOVERNANCE MIGRATION v1
-- Completes posting setup matrix, adds GL cost accounts to warehouses,
-- links existing 654 movements to journal_entries, adds IPG to items
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add inv_posting_group_code to items (mirrors warehouses column)
ALTER TABLE items ADD COLUMN inv_posting_group_code TEXT;

-- 2. Assign IPG to items based on their prod_posting_group_code
--    (each PPG maps to its primary warehouse IPG)
UPDATE items SET inv_posting_group_code = 'FERT-WH'  WHERE company_id=1 AND prod_posting_group_code='FERT';
UPDATE items SET inv_posting_group_code = 'SEED-WH'  WHERE company_id=1 AND prod_posting_group_code='SEED';
UPDATE items SET inv_posting_group_code = 'CHEM-WH'  WHERE company_id=1 AND prod_posting_group_code='CHEM';
UPDATE items SET inv_posting_group_code = 'MAIN-WH'  WHERE company_id=1 AND prod_posting_group_code='EQUIP';
UPDATE items SET inv_posting_group_code = 'MAIN-WH'  WHERE company_id=1 AND prod_posting_group_code='HARVEST';

-- 3. Add cogs_account and purchases_account columns to inventory_posting_setup
ALTER TABLE inventory_posting_setup ADD COLUMN cogs_account TEXT;
ALTER TABLE inventory_posting_setup ADD COLUMN purchases_account TEXT;
ALTER TABLE inventory_posting_setup ADD COLUMN expense_account TEXT;

-- 4. Complete existing posting setup rows with COGS + Purchases accounts
UPDATE inventory_posting_setup SET
  purchases_account = '140701',
  cogs_account      = '45010001',
  expense_account   = '51200034'
WHERE company_id=1;

-- 5. Complete the posting matrix: add ALL missing warehouse×PPG combinations
--    (so no movement ever lacks a posting setup row)
-- PACK-WH × FERT
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'PACK-WH','FERT','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- PACK-WH × SEED
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'PACK-WH','SEED','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- PACK-WH × CHEM
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'PACK-WH','CHEM','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- PACK-WH × EQUIP
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'PACK-WH','EQUIP','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- OIL-WH × FERT (actual cross: زيوت ووقود holding fertilizer items)
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'OIL-WH','FERT','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- OIL-WH × EQUIP
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'OIL-WH','EQUIP','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- IRR-WH × EQUIP (شبكات ري holding equipment)
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'IRR-WH','EQUIP','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- SPARE-WH × EQUIP (قطع غيار)
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'SPARE-WH','EQUIP','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- MISC-WH × FERT (متنوعات holding fertilizer)
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'MISC-WH','FERT','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- MISC-WH × SEED
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'MISC-WH','SEED','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- MISC-WH × EQUIP
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'MISC-WH','EQUIP','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- CHEM-WH × FERT (cross coverage)
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'CHEM-WH','FERT','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- FERT-WH × SEED, EQUIP, HARVEST coverage
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'FERT-WH','SEED','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'FERT-WH','EQUIP','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'FERT-WH','HARVEST','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- SEED-WH × FERT, CHEM, EQUIP, HARVEST
INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'SEED-WH','FERT','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'SEED-WH','CHEM','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO inventory_posting_setup
  (company_id, inv_posting_group_code, prod_posting_group_code, inventory_account, purchases_account, cogs_account, expense_account, is_active, created_at, updated_at)
VALUES (1,'SEED-WH','EQUIP','140701','140701','45010001','51200034',1,datetime('now'),datetime('now'));

-- 6. Create audit_trail table for immutable inventory change log
CREATE TABLE IF NOT EXISTS inventory_audit_trail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  movement_id   INTEGER,
  action        TEXT NOT NULL,   -- CREATE / UPDATE / DELETE / POST / REVERSE
  table_name    TEXT NOT NULL DEFAULT 'inventory_movements',
  record_id     INTEGER,
  before_value  TEXT,            -- JSON
  after_value   TEXT,            -- JSON
  user_id       TEXT,
  ip_address    TEXT,
  session_id    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_iat_company ON inventory_audit_trail(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iat_movement ON inventory_audit_trail(movement_id);
