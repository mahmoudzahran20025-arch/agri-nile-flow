-- Seed posting_rules for 'accounts_payable' control key used by GL preview
-- and any future supplier-facing GL resolution.
-- 2120 = دائنو الموردين (standard accounts payable)

INSERT OR IGNORE INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'accounts_payable', '212000010', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id AND pr.rule_type = 'control' AND pr.mapping_key = 'accounts_payable'
);

INSERT OR IGNORE INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'supplier_payable', '212000010', 90, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id AND pr.rule_type = 'control' AND pr.mapping_key = 'supplier_payable'
);
