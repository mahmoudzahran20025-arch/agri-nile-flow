-- COA remediation phase 1: structural hierarchy cleanup
-- Target: parent_missing anomalies and malformed legacy nodes (company_id = 1)

PRAGMA foreign_keys = ON;

-- 1) Ensure required intermediate headers exist first.
INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '15', 'مجمعات الإهلاك', 'asset', 'debit', '1', 2, 1, 1, 'Auto-created by COA remediation phase 1 (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '15'
);

INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '62', 'مصروفات تشغيلية أخرى', 'expense', 'debit', '6', 2, 1, 1, 'Auto-created by COA remediation phase 1 (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '62'
);

-- 2) Create missing parent headers used by active leaf accounts.
INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '1350', 'أصول تحت التشغيل', 'asset', 'debit', '13', 3, 1, 1, 'Auto-created to resolve parent_missing (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '1350'
);

INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '1590', 'مجمعات إهلاك أصول زراعية', 'asset', 'debit', '15', 3, 1, 1, 'Auto-created to resolve parent_missing (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '1590'
);

INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '2106', 'ضريبة قيمة مضافة مخرجات', 'liability', 'credit', '21', 3, 1, 1, 'Auto-created to resolve parent_missing (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '2106'
);

INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '5501', 'تكلفة المبيعات', 'expense', 'debit', '55', 3, 1, 1, 'Auto-created to resolve parent_missing (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '5501'
);

INSERT INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, parent_code, level, is_header, is_active, notes)
SELECT 1, '6201', 'مصروفات تشغيلية', 'expense', 'debit', '62', 3, 1, 1, 'Auto-created to resolve parent_missing (2026-05-08)'
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = 1 AND code = '6201'
);

-- 3) Normalize top-level revenue header account 7 (legacy had string "null" parent).
UPDATE chart_of_accounts
SET parent_code = NULL,
    is_header = 1,
    notes = CASE
      WHEN notes IS NULL OR notes = '' THEN 'Normalized parent_code from string null by COA remediation phase 1 (2026-05-08)'
      WHEN notes LIKE '%COA remediation phase 1 (2026-05-08)%' THEN notes
      ELSE notes || ' | Normalized parent_code from string null by COA remediation phase 1 (2026-05-08)'
    END
WHERE company_id = 1
  AND code = '7'
  AND parent_code = 'null';

-- 4) Quarantine malformed imported header row (non-numeric code, no valid parent tree).
UPDATE chart_of_accounts
SET is_active = 0,
    is_header = 1,
    parent_code = NULL,
    notes = CASE
      WHEN notes IS NULL OR notes = '' THEN 'Auto-quarantined malformed CoA row by COA remediation phase 1 (2026-05-08)'
      WHEN notes LIKE '%COA remediation phase 1 (2026-05-08)%' THEN notes
      ELSE notes || ' | Auto-quarantined malformed CoA row by COA remediation phase 1 (2026-05-08)'
    END
WHERE company_id = 1
  AND code = 'رقــم الــحـــســـاب';

-- 5) Visibility checks
SELECT 'phase1_parent_missing_remaining' AS metric,
       COUNT(*) AS count_value
FROM chart_of_accounts a
LEFT JOIN chart_of_accounts p
  ON p.company_id = a.company_id
 AND p.code = a.parent_code
WHERE a.company_id = 1
  AND a.parent_code IS NOT NULL
  AND p.code IS NULL;

SELECT code, name, parent_code, is_header, is_active
FROM chart_of_accounts
WHERE company_id = 1
  AND code IN ('15','62','1350','1590','2106','5501','6201','7','رقــم الــحـــســـاب')
ORDER BY code;
