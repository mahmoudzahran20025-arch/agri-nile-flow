-- Seed posting_rules for 'cash' and 'cash_default' control keys used by
-- postHarvestSettlement direct-sale revenue line (replaced hardcoded 14010101).
-- Points to the standard cash-on-hand account; override per-company if different.

INSERT OR IGNORE INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'cash', '14010101', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id AND pr.rule_type = 'control' AND pr.mapping_key = 'cash'
);

INSERT OR IGNORE INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'cash_default', '14010101', 90, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id AND pr.rule_type = 'control' AND pr.mapping_key = 'cash_default'
);
