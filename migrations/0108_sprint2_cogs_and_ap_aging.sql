-- =============================================================================
-- Sprint 2: COGS posting correctness + AP aging foundation
-- Date: 2026-05-12
-- =============================================================================

-- BLOCK 1: Per-PPG COGS accounts under 5130 (التكاليف التشغيلية الزراعية)
INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, normal_balance, is_active, is_header, parent_code) VALUES
  (1, '51300005', 'مستلزمات الأسمدة والتربة',         'expense', 'debit', 1, 0, '5130'),
  (1, '51300006', 'مستلزمات المبيدات والكيماويات',    'expense', 'debit', 1, 0, '5130'),
  (1, '51300007', 'مستلزمات التقاوي والبذور',          'expense', 'debit', 1, 0, '5130'),
  (1, '51300008', 'مستلزمات الري والبنية التحتية',    'expense', 'debit', 1, 0, '5130'),
  (1, '51300009', 'قطع غيار مستهلكة',                  'expense', 'debit', 1, 0, '5130'),
  (1, '51300010', 'مواد ومستلزمات متنوعة',              'expense', 'debit', 1, 0, '5130');

-- BLOCK 2: Per-PPG general posting rules with COGS accounts
-- These are PPG-only rules (BPG=NULL) so the engine matches at step 3 for inventory ISSUE.
INSERT OR IGNORE INTO posting_rules (company_id, rule_type, prod_posting_group_code, cogs_account, purchases_account, is_active, priority) VALUES
  (1, 'general', 'FERT',       '51300005', '14070101', 1, 10),
  (1, 'general', 'CHEM',       '51300006', '14070102', 1, 10),
  (1, 'general', 'SEED',       '51300007', '14070103', 1, 10),
  (1, 'general', 'SEEDS',      '51300007', '14070103', 1, 10),
  (1, 'general', 'MISC',       '51300010', '14070106', 1, 10),
  (1, 'general', 'FUEL',       '51200015', '14070106', 1, 10),
  (1, 'general', 'EQUIP_CONS', '51300009', '14070105', 1, 10);

-- BLOCK 3: Missing inventory posting rules for CHEM-WH, SEED-WH, IRR-WH, SPARE-WH
INSERT OR IGNORE INTO posting_rules (company_id, rule_type, inv_posting_group_code, prod_posting_group_code, inventory_account, is_active, priority) VALUES
  (1, 'inventory', 'CHEM-WH',  'CHEM',       '14070102', 1, 10),
  (1, 'inventory', 'SEED-WH',  'SEEDS',      '14070103', 1, 10),
  (1, 'inventory', 'IRR-WH',   'EQUIP_CONS', '14070105', 1, 10),
  (1, 'inventory', 'SPARE-WH', 'EQUIP_CONS', '14070105', 1, 10);

-- BLOCK 4: AP aging columns on supplier_transactions
ALTER TABLE supplier_transactions ADD COLUMN matched_payment_id INTEGER REFERENCES supplier_transactions(id);
ALTER TABLE supplier_transactions ADD COLUMN invoice_ref TEXT;
ALTER TABLE supplier_transactions ADD COLUMN is_matched INTEGER DEFAULT 0;

-- BLOCK 5: Index for AP aging queries
CREATE INDEX IF NOT EXISTS idx_supplier_txn_aging
  ON supplier_transactions(company_id, supplier_code, entry_type, is_matched, due_date);
