-- =============================================================================
-- Migration 0080: Fix Phantom Control Account Codes
-- Date: 2026-05-03
-- =============================================================================
-- The financial_data_integration_report-opus identified that control accounts
-- seeded in migrations 0056 (WIP) and 0057 (fixed assets) used phantom codes
-- (5300, 1590, 1350, 3350) that DO NOT exist in the real Chart of Accounts
-- (شجرة_نواة_المستقبل.json).
--
-- Real CoA codes (from CoA JSON authority):
--   5503  — إهلاك - آلات ومعدات    (depreciation expense, equipment)
--   2203  — مجمع إهلاك - آلات ومعدات (accumulated depreciation, equipment)
--   1302  — مشروعات تحت التنفيذ     (WIP asset — projects in progress)
--   4101  — إيراد نشاط المحصول      (revenue)
--   4501  — تكلفة المبيعات          (COGS)
--
-- For WIP contra we use equity/retained earnings placeholder (3001) until
-- a dedicated seasonal-close contra account is added to the CoA.
-- =============================================================================

-- ── 1. Fix depreciation_expense: phantom 5300 → real 5503 ─────────────────────
UPDATE posting_rules
SET account_code = '5503', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type   = 'control'
  AND mapping_key = 'depreciation_expense'
  AND account_code = '5300';

-- ── 2. Fix accumulated_depreciation: phantom 1590 → real 2203 ─────────────────
UPDATE posting_rules
SET account_code = '2203', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type   = 'control'
  AND mapping_key = 'accumulated_depreciation'
  AND account_code = '1590';

-- ── 3. Fix wip_asset: phantom 1350 → real 1302 ────────────────────────────────
UPDATE posting_rules
SET account_code = '1302', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type   = 'control'
  AND mapping_key = 'wip_asset'
  AND account_code = '1350';

-- ── 4. Fix wip_contra: phantom 3350 → real 3001 (رأس المال — retained earnings) ─
-- This offsets the WIP DR at season close against equity until harvest realises P&L.
UPDATE posting_rules
SET account_code = '3001', updated_at = datetime('now')
WHERE company_id = 1
  AND rule_type   = 'control'
  AND mapping_key = 'wip_contra'
  AND account_code = '3350';

-- ── 5. Seed revenue control account if missing ────────────────────────────────
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT 1, 'control', 'revenue', '4101', 100, 1
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules
  WHERE company_id = 1 AND rule_type = 'control' AND mapping_key = 'revenue'
);

-- ── 6. Seed cogs control account if missing ─────────────────────────────────��─
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT 1, 'control', 'cogs', '4501', 100, 1
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules
  WHERE company_id = 1 AND rule_type = 'control' AND mapping_key = 'cogs'
);

-- ── 7. Seed missing CoA accounts that resolvers may resolve against ────────────
-- These exist in the CoA JSON but may not have been seeded via chart_of_accounts
-- table yet. Using INSERT OR IGNORE to be idempotent.

-- Depreciation expense group (parent 55)
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active)
VALUES
  (1, '55',   'الإهلاكات',                     'expense', 'debit', NULL,  1, 1, 1),
  (1, '5503', 'إهلاك - آلات ومعدات',           'expense', 'debit', '55',  2, 0, 1),
  (1, '5502', 'إهلاك - مبانى',                 'expense', 'debit', '55',  2, 0, 1),
  (1, '5505', 'إهلاك - سيارات',               'expense', 'debit', '55',  2, 0, 1),
  (1, '5507', 'إهلاك - حاسبات آلية',          'expense', 'debit', '55',  2, 0, 1);

-- Accumulated depreciation group (parent 22 — contra-asset)
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active)
VALUES
  (1, '22',   'مجمعات الإهلاك',                'asset', 'credit', NULL,  1, 1, 1),
  (1, '2203', 'مجمع إهلاك - آلات ومعدات',     'asset', 'credit', '22',  2, 0, 1),
  (1, '2202', 'مجمع إهلاك - مبانى',            'asset', 'credit', '22',  2, 0, 1),
  (1, '2205', 'مجمع إهلاك - سيارات',          'asset', 'credit', '22',  2, 0, 1),
  (1, '2207', 'مجمع إهلاك - حاسبات آلية',    'asset', 'credit', '22',  2, 0, 1);

-- WIP asset (projects in progress)
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active)
VALUES
  (1, '1302', 'مشروعات تحت التنفيذ', 'asset', 'debit', NULL, 1, 0, 1);

-- Revenue — crop activity
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active)
VALUES
  (1, '4101', 'إيراد نشاط المحصول', 'revenue', 'credit', NULL, 1, 0, 1);

-- COGS
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active)
VALUES
  (1, '4501', 'تكلفة المبيعات', 'expense', 'debit', NULL, 1, 0, 1);

-- ── 8. Seed wages_expense and wages_payable control accounts ─────────────────��
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT 1, 'control', 'wages_expense', '51010001', 100, 1
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules WHERE company_id = 1 AND rule_type = 'control' AND mapping_key = 'wages_expense'
);

INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT 1, 'control', 'wages_payable', '21200001', 100, 1
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules WHERE company_id = 1 AND rule_type = 'control' AND mapping_key = 'wages_payable'
);

-- Also seed labor_expense (used by work-order labor resolver)
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT 1, 'control', 'labor_expense', '5101', 100, 1
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules WHERE company_id = 1 AND rule_type = 'control' AND mapping_key = 'labor_expense'
);

-- ── 9. Ensure accounts_payable control points to real CoA ─────────────────────
-- 212000010 = موردون متنوعون (real leaf account in CoA)
INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT 1, 'control', 'accounts_payable', '212000010', 100, 1
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules WHERE company_id = 1 AND rule_type = 'control' AND mapping_key = 'accounts_payable'
);

-- ── 10. Seed supporting CoA accounts (idempotent) ─────────────────────────────
INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active)
VALUES
  -- Wages expense
  (1, '5101',     'العمالة',                     'expense',   'debit',  NULL, 1, 1, 1),
  (1, '51010001', 'الأجور والمرتبات',             'expense',   'debit',  '5101', 2, 0, 1),
  -- Wages payable (accrued)
  (1, '21200001', 'مستحقات الرواتب',             'liability', 'credit', NULL, 1, 0, 1),
  -- Accounts payable leaf
  (1, '212000010','موردون متنوعون',               'liability', 'credit', NULL, 1, 0, 1);

-- ── VERIFICATION ──────────────────────────────────────────────────────────────
-- SELECT mapping_key, account_code FROM posting_rules
-- WHERE company_id = 1 AND rule_type = 'control'
--   AND mapping_key IN ('depreciation_expense','accumulated_depreciation','wip_asset','wip_contra','revenue','cogs')
-- ORDER BY mapping_key;
--
-- Expected:
--   accumulated_depreciation → 2203
--   cogs                     → 4501
--   depreciation_expense     → 5503
--   revenue                  → 4101
--   wip_asset                → 1302
--   wip_contra               → 3001
