-- COA remediation phase 2: orphan_rules cleanup
-- Target: active posting_rules referencing missing accounts (company_id = 1)

PRAGMA foreign_keys = ON;

-- 1) Create missing inventory branch used by inventory rules 77/78.
INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '140703', 'مخزون المعدات', 'asset', 'debit', '1407', 4, 1, 1, 'Auto-created by COA remediation phase 2 (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '140703'
);

INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '14070301', 'مخزون معدات رأسمالية', 'asset', 'debit', '140703', 4, 0, 1, 'Auto-created by COA remediation phase 2 (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '14070301'
);

INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '14070302', 'مخزون معدات استهلاكية', 'asset', 'debit', '140703', 4, 0, 1, 'Auto-created by COA remediation phase 2 (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '14070302'
);

-- 2) Ensure orphan inventory rules now point to active posting-level inventory accounts.
UPDATE posting_rules
SET inventory_account = '14070301'
WHERE company_id = 1
  AND id = 77
  AND is_active = 1;

UPDATE posting_rules
SET inventory_account = '14070302'
WHERE company_id = 1
  AND id = 78
  AND is_active = 1;

-- 3) Visibility checks
SELECT id, rule_type, prod_posting_group_code, inventory_account
FROM posting_rules
WHERE company_id = 1
  AND id IN (77, 78)
ORDER BY id;

SELECT code, name, parent_code, is_header, is_active
FROM chart_of_accounts
WHERE company_id = 1
  AND code IN ('140703','14070301','14070302')
ORDER BY code;
