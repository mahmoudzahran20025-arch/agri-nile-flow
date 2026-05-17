-- =============================================================================
-- 0094_coa_governance_phase.sql
-- COA Governance Phase: deterministic posting governance + audit surfaces.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- 1) Account intent classification (governance taxonomy).
CREATE TABLE IF NOT EXISTS coa_account_intents (
  company_id       INTEGER NOT NULL,
  account_code     TEXT    NOT NULL,
  intent_class     TEXT    NOT NULL CHECK (intent_class IN ('operational', 'control', 'reporting', 'system-owned', 'manual-only')),
  ownership_scope  TEXT    NOT NULL DEFAULT 'finance',
  is_system_owned  INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  notes            TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, account_code),
  FOREIGN KEY (company_id, account_code) REFERENCES chart_of_accounts(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coa_intents_company_intent
  ON coa_account_intents(company_id, intent_class, is_active);

-- Seed control/system-owned accounts from active control posting rules.
INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id,
       pr.account_code,
       'control',
       'posting_rules',
       1,
       'Seeded from posting_rules.control'
FROM posting_rules pr
JOIN chart_of_accounts coa
  ON coa.company_id = pr.company_id
 AND coa.code = pr.account_code
WHERE pr.rule_type = 'control'
  AND pr.is_active = 1
  AND pr.account_code IS NOT NULL;

-- Seed operational accounts from active general/inventory rules.
INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id, pr.sales_account, 'operational', 'posting_rules', 1, 'Seeded from posting_rules.general.sales_account'
FROM posting_rules pr
JOIN chart_of_accounts coa ON coa.company_id = pr.company_id AND coa.code = pr.sales_account
WHERE pr.rule_type = 'general' AND pr.is_active = 1 AND pr.sales_account IS NOT NULL;

INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id, pr.purchases_account, 'operational', 'posting_rules', 1, 'Seeded from posting_rules.general.purchases_account'
FROM posting_rules pr
JOIN chart_of_accounts coa ON coa.company_id = pr.company_id AND coa.code = pr.purchases_account
WHERE pr.rule_type = 'general' AND pr.is_active = 1 AND pr.purchases_account IS NOT NULL;

INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id, pr.cogs_account, 'operational', 'posting_rules', 1, 'Seeded from posting_rules.general.cogs_account'
FROM posting_rules pr
JOIN chart_of_accounts coa ON coa.company_id = pr.company_id AND coa.code = pr.cogs_account
WHERE pr.rule_type = 'general' AND pr.is_active = 1 AND pr.cogs_account IS NOT NULL;

INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id, pr.sales_returns_account, 'operational', 'posting_rules', 1, 'Seeded from posting_rules.general.sales_returns_account'
FROM posting_rules pr
JOIN chart_of_accounts coa ON coa.company_id = pr.company_id AND coa.code = pr.sales_returns_account
WHERE pr.rule_type = 'general' AND pr.is_active = 1 AND pr.sales_returns_account IS NOT NULL;

INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id, pr.purch_returns_account, 'operational', 'posting_rules', 1, 'Seeded from posting_rules.general.purch_returns_account'
FROM posting_rules pr
JOIN chart_of_accounts coa ON coa.company_id = pr.company_id AND coa.code = pr.purch_returns_account
WHERE pr.rule_type = 'general' AND pr.is_active = 1 AND pr.purch_returns_account IS NOT NULL;

INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id, pr.expense_account, 'operational', 'posting_rules', 1, 'Seeded from posting_rules.general.expense_account'
FROM posting_rules pr
JOIN chart_of_accounts coa ON coa.company_id = pr.company_id AND coa.code = pr.expense_account
WHERE pr.rule_type = 'general' AND pr.is_active = 1 AND pr.expense_account IS NOT NULL;

INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id, pr.inventory_account, 'operational', 'posting_rules', 1, 'Seeded from posting_rules.inventory.inventory_account'
FROM posting_rules pr
JOIN chart_of_accounts coa ON coa.company_id = pr.company_id AND coa.code = pr.inventory_account
WHERE pr.rule_type = 'inventory' AND pr.is_active = 1 AND pr.inventory_account IS NOT NULL;

INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id, pr.wip_account, 'operational', 'posting_rules', 1, 'Seeded from posting_rules.inventory.wip_account'
FROM posting_rules pr
JOIN chart_of_accounts coa ON coa.company_id = pr.company_id AND coa.code = pr.wip_account
WHERE pr.rule_type = 'inventory' AND pr.is_active = 1 AND pr.wip_account IS NOT NULL;

INSERT OR IGNORE INTO coa_account_intents
(company_id, account_code, intent_class, ownership_scope, is_system_owned, notes)
SELECT pr.company_id, pr.finished_goods_account, 'operational', 'posting_rules', 1, 'Seeded from posting_rules.inventory.finished_goods_account'
FROM posting_rules pr
JOIN chart_of_accounts coa ON coa.company_id = pr.company_id AND coa.code = pr.finished_goods_account
WHERE pr.rule_type = 'inventory' AND pr.is_active = 1 AND pr.finished_goods_account IS NOT NULL;

-- 2) Deterministic operation matrix (documented and machine-checkable).
CREATE TABLE IF NOT EXISTS posting_operation_matrix (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL,
  operation_key    TEXT    NOT NULL,
  source_module    TEXT    NOT NULL,
  debit_role       TEXT    NOT NULL,
  credit_role      TEXT    NOT NULL,
  is_system_owned  INTEGER NOT NULL DEFAULT 1,
  is_active        INTEGER NOT NULL DEFAULT 1,
  description      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, operation_key),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_posting_operation_matrix_active
  ON posting_operation_matrix(company_id, source_module, is_active);

INSERT OR IGNORE INTO posting_operation_matrix
(company_id, operation_key, source_module, debit_role, credit_role, description)
VALUES
(1, 'SUPPLIER_INVOICE',      'suppliers',  'inventory_or_expense',   'accounts_payable',  'Supplier invoice posting matrix'),
(1, 'SUPPLIER_PAYMENT',      'suppliers',  'accounts_payable',        'cash',              'Supplier payment posting matrix'),
(1, 'SALES_INVOICE',         'sales',      'accounts_receivable',     'revenue',           'Sales invoice posting matrix'),
(1, 'SALE_RECEIPT',          'sales',      'cash',                    'accounts_receivable','Sales receipt posting matrix'),
(1, 'INVENTORY_MOVEMENT',    'inventory',  'inventory_or_offset',     'inventory_or_offset','Inventory movement matrix (direction-aware resolver)'),
(1, 'PRODUCTION_CONSUMPTION','production', 'wip_asset',               'inventory',         'Production issue posting matrix'),
(1, 'PRODUCTION_OUTPUT',     'production', 'finished_goods',          'wip_asset',         'Production output posting matrix'),
(1, 'INVENTORY_IN',          'inventory',  'inventory',               'purchases_or_cogs', 'Inventory increase matrix'),
(1, 'INVENTORY_OUT',         'inventory',  'purchases_or_cogs',       'inventory',         'Inventory decrease matrix'),
(1, 'CASH_EXPENSE',          'cash',       'expense',                 'cash',              'Cash expense matrix'),
(1, 'CASH_INCOME',           'cash',       'cash',                    'revenue',           'Cash income matrix');

-- 3) Hard posting guards: block missing/inactive/header accounts at DB boundary.
CREATE TRIGGER IF NOT EXISTS trg_gl_enforce_existing_account_insert
BEFORE INSERT ON journal_entry_lines
WHEN NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to a missing account code.');
END;

CREATE TRIGGER IF NOT EXISTS trg_gl_enforce_active_account_insert
BEFORE INSERT ON journal_entry_lines
WHEN EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
    AND coa.is_active = 0
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to an inactive account.');
END;

CREATE TRIGGER IF NOT EXISTS trg_gl_enforce_no_header_posting_update
BEFORE UPDATE OF account_code ON journal_entry_lines
WHEN EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
    AND coa.is_header = 1
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to a header account.');
END;

CREATE TRIGGER IF NOT EXISTS trg_gl_enforce_existing_account_update
BEFORE UPDATE OF account_code ON journal_entry_lines
WHEN NOT EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot use missing account code on journal line update.');
END;

CREATE TRIGGER IF NOT EXISTS trg_gl_enforce_active_account_update
BEFORE UPDATE OF account_code ON journal_entry_lines
WHEN EXISTS (
  SELECT 1
  FROM chart_of_accounts coa
  WHERE coa.company_id = NEW.company_id
    AND coa.code = NEW.account_code
    AND coa.is_active = 0
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot use inactive account on journal line update.');
END;

-- 4) posting_rules guards: active rules cannot reference invalid posting targets.
CREATE TRIGGER IF NOT EXISTS trg_pr_control_account_guard_insert
BEFORE INSERT ON posting_rules
WHEN NEW.rule_type = 'control'
 AND NEW.is_active = 1
 AND NEW.account_code IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM chart_of_accounts coa
   WHERE coa.company_id = NEW.company_id
     AND coa.code = NEW.account_code
     AND coa.is_active = 1
     AND coa.is_header = 0
 )
BEGIN
  SELECT RAISE(ABORT, 'POSTING_RULE_INVALID: control mapping account must be existing, active, and posting-level.');
END;

CREATE TRIGGER IF NOT EXISTS trg_pr_control_account_guard_update
BEFORE UPDATE OF account_code, is_active ON posting_rules
WHEN NEW.rule_type = 'control'
 AND NEW.is_active = 1
 AND NEW.account_code IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM chart_of_accounts coa
   WHERE coa.company_id = NEW.company_id
     AND coa.code = NEW.account_code
     AND coa.is_active = 1
     AND coa.is_header = 0
 )
BEGIN
  SELECT RAISE(ABORT, 'POSTING_RULE_INVALID: control mapping account must be existing, active, and posting-level.');
END;

CREATE TRIGGER IF NOT EXISTS trg_pr_general_slots_guard_insert
BEFORE INSERT ON posting_rules
WHEN NEW.rule_type = 'general'
 AND NEW.is_active = 1
BEGIN
  SELECT CASE WHEN NEW.sales_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.sales_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: sales_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.purchases_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.purchases_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: purchases_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.cogs_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.cogs_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: cogs_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.sales_returns_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.sales_returns_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: sales_returns_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.purch_returns_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.purch_returns_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: purch_returns_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.expense_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.expense_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: expense_account must be existing, active, and posting-level.') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_pr_general_slots_guard_update
BEFORE UPDATE OF sales_account, purchases_account, cogs_account, sales_returns_account, purch_returns_account, expense_account, is_active ON posting_rules
WHEN NEW.rule_type = 'general'
 AND NEW.is_active = 1
BEGIN
  SELECT CASE WHEN NEW.sales_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.sales_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: sales_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.purchases_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.purchases_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: purchases_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.cogs_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.cogs_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: cogs_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.sales_returns_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.sales_returns_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: sales_returns_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.purch_returns_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.purch_returns_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: purch_returns_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.expense_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.expense_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: expense_account must be existing, active, and posting-level.') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_pr_inventory_slots_guard_insert
BEFORE INSERT ON posting_rules
WHEN NEW.rule_type = 'inventory'
 AND NEW.is_active = 1
BEGIN
  SELECT CASE WHEN NEW.inventory_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.inventory_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: inventory_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.wip_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.wip_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: wip_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.finished_goods_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.finished_goods_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: finished_goods_account must be existing, active, and posting-level.') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_pr_inventory_slots_guard_update
BEFORE UPDATE OF inventory_account, wip_account, finished_goods_account, is_active ON posting_rules
WHEN NEW.rule_type = 'inventory'
 AND NEW.is_active = 1
BEGIN
  SELECT CASE WHEN NEW.inventory_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.inventory_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: inventory_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.wip_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.wip_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: wip_account must be existing, active, and posting-level.') END;

  SELECT CASE WHEN NEW.finished_goods_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts coa WHERE coa.company_id = NEW.company_id AND coa.code = NEW.finished_goods_account AND coa.is_active = 1 AND coa.is_header = 0
  ) THEN RAISE(ABORT, 'POSTING_RULE_INVALID: finished_goods_account must be existing, active, and posting-level.') END;
END;

-- 5) Daily / deploy audit view with requested metrics.
CREATE VIEW IF NOT EXISTS vw_coa_audit_metrics AS
WITH
missing_parent AS (
  SELECT COUNT(*) AS c
  FROM chart_of_accounts a
  LEFT JOIN chart_of_accounts p
    ON p.company_id = a.company_id
   AND p.code = a.parent_code
  WHERE a.parent_code IS NOT NULL
    AND p.code IS NULL
),
leaf_with_children AS (
  SELECT COUNT(*) AS c
  FROM chart_of_accounts a
  WHERE a.is_header = 0
    AND EXISTS (
      SELECT 1 FROM chart_of_accounts c
      WHERE c.company_id = a.company_id
        AND c.parent_code = a.code
    )
),
posted_to_header AS (
  SELECT COUNT(*) AS c
  FROM journal_entry_lines jel
  JOIN journal_entries je
    ON je.id = jel.entry_id
   AND je.company_id = jel.company_id
  JOIN chart_of_accounts coa
    ON coa.company_id = jel.company_id
   AND coa.code = jel.account_code
  WHERE je.is_posted = 1
    AND coa.is_header = 1
),
wrong_account_type AS (
  SELECT COUNT(*) AS c
  FROM posting_rules pr
  JOIN chart_of_accounts coa
    ON coa.company_id = pr.company_id
   AND coa.code = pr.account_code
  WHERE pr.rule_type = 'control'
    AND pr.is_active = 1
    AND pr.mapping_key IS NOT NULL
    AND (
      (pr.mapping_key IN ('cash') AND coa.account_type <> 'asset')
      OR (pr.mapping_key IN ('inventory', 'wip_asset', 'accounts_receivable') AND coa.account_type <> 'asset')
      OR (pr.mapping_key IN ('accounts_payable', 'wages_payable', 'deferred_revenue', 'accumulated_depreciation') AND coa.account_type <> 'liability')
      OR (pr.mapping_key IN ('revenue', 'revenue_default', 'revenue_crops') AND coa.account_type <> 'revenue')
      OR (pr.mapping_key IN ('cogs', 'cost_of_goods', 'expense_default', 'depreciation_expense', 'wages_expense', 'labor_expense') AND coa.account_type <> 'expense')
      OR (pr.mapping_key IN ('wip_contra') AND coa.account_type <> 'equity')
    )
),
orphan_rules AS (
  SELECT COUNT(*) AS c
  FROM posting_rules pr
  WHERE pr.is_active = 1
    AND (
      (pr.account_code IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.account_code
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.sales_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.sales_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.purchases_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.purchases_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.cogs_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.cogs_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.expense_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.expense_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.inventory_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.inventory_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.wip_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.wip_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
      OR (pr.finished_goods_account IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts coa
        WHERE coa.company_id = pr.company_id
          AND coa.code = pr.finished_goods_account
          AND coa.is_active = 1
          AND coa.is_header = 0
      ))
    )
),
duplicate_control_accounts AS (
  SELECT COUNT(*) AS c
  FROM (
    SELECT company_id, mapping_key
    FROM posting_rules
    WHERE rule_type = 'control'
      AND is_active = 1
      AND mapping_key IS NOT NULL
    GROUP BY company_id, mapping_key
    HAVING COUNT(*) > 1
  ) x
),
metrics(metric, severity, issue_count) AS (
  VALUES
    ('parent_missing', 'critical', (SELECT c FROM missing_parent)),
    ('leaf_with_children', 'high', (SELECT c FROM leaf_with_children)),
    ('posted_to_header', 'critical', (SELECT c FROM posted_to_header)),
    ('wrong_account_type', 'high', (SELECT c FROM wrong_account_type)),
    ('orphan_rules', 'critical', (SELECT c FROM orphan_rules)),
    ('duplicate_control_accounts', 'high', (SELECT c FROM duplicate_control_accounts))
)
SELECT metric, severity, issue_count
FROM metrics;
