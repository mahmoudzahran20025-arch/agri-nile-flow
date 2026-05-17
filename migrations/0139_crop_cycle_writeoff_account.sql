-- Migration: 0139 — GL account and posting rule for crop cycle write-off
--
-- Adds account 61060003 (خسارة محاصيل — شطب) and its control mapping.
-- Distinct from abandonment (61060001 operating_loss, 61060002 extraordinary_loss).
-- Used by postCycleWriteOff via the 'agricultural_loss_writeoff' control key.

INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, is_header, is_active, parent_code)
SELECT c.id, '61060003', 'خسارة محاصيل — شطب', 'expense', 'debit', 0, 1, '6106'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts WHERE company_id = c.id AND code = '61060003'
);

INSERT OR IGNORE INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'agricultural_loss_writeoff', '61060003', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id
    AND pr.rule_type   = 'control'
    AND pr.mapping_key = 'agricultural_loss_writeoff'
);
