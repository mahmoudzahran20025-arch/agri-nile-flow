-- 0063_inventory_rules_wip_finished_accounts.sql
-- Extend canonical posting_rules inventory configuration to support harvest flow.

ALTER TABLE posting_rules ADD COLUMN wip_account TEXT;
ALTER TABLE posting_rules ADD COLUMN finished_goods_account TEXT;

-- Optional backfill from active control mappings so existing installs work immediately.
UPDATE posting_rules
SET wip_account = (
  SELECT account_code
  FROM posting_rules prc
  WHERE prc.company_id = posting_rules.company_id
    AND prc.rule_type = 'control'
    AND prc.mapping_key = 'WIP_ACCOUNT'
    AND prc.is_active = 1
  ORDER BY prc.priority ASC, prc.id ASC
  LIMIT 1
)
WHERE rule_type = 'inventory' AND wip_account IS NULL;

UPDATE posting_rules
SET finished_goods_account = (
  SELECT account_code
  FROM posting_rules prc
  WHERE prc.company_id = posting_rules.company_id
    AND prc.rule_type = 'control'
    AND prc.mapping_key = 'FINISHED_GOODS'
    AND prc.is_active = 1
  ORDER BY prc.priority ASC, prc.id ASC
  LIMIT 1
)
WHERE rule_type = 'inventory' AND finished_goods_account IS NULL;
