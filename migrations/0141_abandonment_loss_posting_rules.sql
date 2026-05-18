-- Seed posting_rules for abandonment loss accounts so postCycleAbandonment can
-- resolve dynamically instead of using hardcoded GL codes.
-- 61060001 = خسارة إهلاك محاصيل (operating_loss policy)
-- 61060002 = خسائر استثنائية — إهلاك محاصيل (extraordinary_loss policy)

INSERT OR IGNORE INTO chart_of_accounts
  (company_id, code, name, account_type, normal_balance, is_header, is_active, parent_code)
SELECT c.id, '61060002', 'خسائر استثنائية — إهلاك محاصيل', 'expense', 'debit', 0, 1, '6106'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM chart_of_accounts ca
  WHERE ca.company_id = c.id AND ca.code = '61060002'
);

INSERT OR IGNORE INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'agricultural_loss_operating', '61060001', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id AND pr.rule_type = 'control' AND pr.mapping_key = 'agricultural_loss_operating'
);

INSERT OR IGNORE INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'agricultural_loss_extraordinary', '61060002', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id AND pr.rule_type = 'control' AND pr.mapping_key = 'agricultural_loss_extraordinary'
);

INSERT OR IGNORE INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'agricultural_loss_abandonment', '61060001', 80, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id AND pr.rule_type = 'control' AND pr.mapping_key = 'agricultural_loss_abandonment'
);
