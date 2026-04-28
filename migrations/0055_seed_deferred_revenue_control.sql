-- Migration: 0055 — Seed deferred_revenue control account mapping
--
-- Problem: resolveContractAdvance falls back to accounts_payable because
-- no deferred_revenue control rule is seeded in posting_rules.
--
-- Solution: Seed deferred_revenue mapping key for all companies that don't have it.
-- Account code 2210 is from AUDIT_ghost_mappings.md (validated mapping).
--
-- This is idempotent: safe to re-run without duplicates.

INSERT INTO posting_rules (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT c.id, 'control', 'deferred_revenue', '2210', 100, 1
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM posting_rules pr
  WHERE pr.company_id = c.id
    AND pr.rule_type = 'control'
    AND pr.mapping_key = 'deferred_revenue'
);
