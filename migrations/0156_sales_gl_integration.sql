-- 0156: Sales GL integration
-- Adds journal_entry_id to sales_orders and seeds receivable_default control rule.

-- ── sales_orders: GL link ─────────────────────────────────────────────────────
ALTER TABLE sales_orders ADD COLUMN journal_entry_id INTEGER REFERENCES journal_entries(id);

-- ── posting rule: receivable_default ─────────────────────────────────────────
-- Used as the debit account on credit sales (AR). Maps to ذمم مدينة (trade receivables).
INSERT OR IGNORE INTO posting_rules
  (company_id, rule_type, mapping_key, account_code, priority, is_active)
SELECT
  c.id, 'control', 'receivable_default', '1403', 100, 1
FROM companies c
WHERE c.is_active = 1;
