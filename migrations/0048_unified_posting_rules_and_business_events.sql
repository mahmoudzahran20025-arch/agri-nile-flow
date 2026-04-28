-- 0048_unified_posting_rules_and_business_events.sql
-- Canonical posting configuration and event-first financial traceability.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS posting_rules (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  rule_type TEXT NOT NULL,

  -- Routing dimensions (NULL = wildcard)
  bus_posting_group_code TEXT,
  prod_posting_group_code TEXT,
  inv_posting_group_code TEXT,

  -- For control/singleton mappings (cash, AP, wages, etc.)
  mapping_key TEXT,
  account_code TEXT,

  -- General posting slots
  sales_account TEXT,
  purchases_account TEXT,
  cogs_account TEXT,
  sales_returns_account TEXT,
  purch_returns_account TEXT,
  expense_account TEXT,

  -- Inventory posting slots
  inventory_account TEXT,

  priority INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK(rule_type IN ('general','inventory','control'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_posting_rules_signature
ON posting_rules (
  company_id,
  rule_type,
  COALESCE(bus_posting_group_code, '__NULL__'),
  COALESCE(prod_posting_group_code, '__NULL__'),
  COALESCE(inv_posting_group_code, '__NULL__'),
  COALESCE(mapping_key, '__NULL__')
);

CREATE INDEX IF NOT EXISTS idx_posting_rules_lookup
ON posting_rules (
  company_id,
  rule_type,
  is_active,
  priority
);

CREATE TABLE IF NOT EXISTS business_events (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  journal_entry_id INTEGER,
  posted_by INTEGER,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK(status IN ('pending','posted','error','reversed')),
  UNIQUE(company_id, source_module, source_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_business_events_status
ON business_events (company_id, status, event_date);

CREATE INDEX IF NOT EXISTS idx_business_events_source
ON business_events (company_id, source_module, source_id);

PRAGMA foreign_keys = ON;
