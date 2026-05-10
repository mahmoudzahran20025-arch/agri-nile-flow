-- Phase 3: Traceability Architecture Extension - Schema Only
-- =============================================
-- Objective: Add deterministic lineage infrastructure
-- Note: No UPDATEs to existing data; triggers protect posted entries
-- Company: company_id = 1

-- ============================================================================
-- SECTION 1: Add new columns to journal_entries
-- ============================================================================

ALTER TABLE journal_entries ADD COLUMN business_event_id TEXT;
ALTER TABLE journal_entries ADD COLUMN business_event_type TEXT;
ALTER TABLE journal_entries ADD COLUMN posting_rule_id TEXT;
ALTER TABLE journal_entries ADD COLUMN resolution_id TEXT;
ALTER TABLE journal_entries ADD COLUMN generated_by TEXT;
ALTER TABLE journal_entries ADD COLUMN trace_checksum TEXT;

CREATE INDEX IF NOT EXISTS idx_je_business_event_id ON journal_entries(company_id, business_event_id);
CREATE INDEX IF NOT EXISTS idx_je_business_event_type ON journal_entries(company_id, business_event_type);

-- ============================================================================
-- SECTION 2: Add new columns to journal_entry_lines
-- ============================================================================

ALTER TABLE journal_entry_lines ADD COLUMN business_event_id TEXT;
ALTER TABLE journal_entry_lines ADD COLUMN posting_rule_id TEXT;
ALTER TABLE journal_entry_lines ADD COLUMN resolution_id TEXT;
ALTER TABLE journal_entry_lines ADD COLUMN source_module TEXT;
ALTER TABLE journal_entry_lines ADD COLUMN rule_classification TEXT;
ALTER TABLE journal_entry_lines ADD COLUMN generated_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_jel_business_event_id ON journal_entry_lines(company_id, business_event_id);
CREATE INDEX IF NOT EXISTS idx_jel_source_module ON journal_entry_lines(company_id, source_module, source_record_id);
CREATE INDEX IF NOT EXISTS idx_jel_posting_rule ON journal_entry_lines(company_id, posting_rule_id);
CREATE INDEX IF NOT EXISTS idx_jel_rule_class ON journal_entry_lines(company_id, rule_classification);

-- ============================================================================
-- SECTION 3: Create posting_trace_log table for forward traceability
-- ============================================================================

CREATE TABLE IF NOT EXISTS posting_trace_log (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL,
  
  -- Source event reference
  business_event_type TEXT NOT NULL,
  source_record_id INTEGER NOT NULL,
  source_module TEXT NOT NULL,
  source_timestamp DATETIME NOT NULL,
  
  -- Posting result reference
  journal_entry_id INTEGER NOT NULL,
  posting_rule_id TEXT NOT NULL,
  posting_rule_slot TEXT,
  posting_timestamp DATETIME NOT NULL,
  
  -- Engine metadata
  resolution_id TEXT,
  generated_by TEXT,
  engine_version TEXT,
  
  -- Audit state
  is_traced INTEGER DEFAULT 1,
  is_validated INTEGER DEFAULT 0,
  validation_notes TEXT,
  
  -- Governance
  classification TEXT,
  is_reversible INTEGER,
  reversal_entry_id INTEGER,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(company_id, source_record_id, journal_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_ptl_source_event ON posting_trace_log(company_id, business_event_type, source_record_id);
CREATE INDEX IF NOT EXISTS idx_ptl_journal_entry ON posting_trace_log(company_id, journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_ptl_posting_rule ON posting_trace_log(company_id, posting_rule_id);
CREATE INDEX IF NOT EXISTS idx_ptl_validation ON posting_trace_log(company_id, is_validated);

-- ============================================================================
-- SECTION 4: Create account_classification table
-- ============================================================================

CREATE TABLE IF NOT EXISTS account_classification (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL,
  account_code TEXT NOT NULL,
  
  -- Classification hierarchy
  classification_type TEXT NOT NULL,      -- 'operating', 'administrative', 'balance_sheet', 'other'
  sub_classification TEXT,                -- 'fuel', 'labor', 'overhead', 'machinery', etc.
  accounting_class TEXT,                  -- 'asset', 'liability', 'equity', 'revenue', 'expense'
  
  -- Business mapping
  business_domain TEXT,                   -- 'pivots', 'inventory', 'suppliers', 'cash', 'shared'
  cost_element TEXT,
  balance_sheet_category TEXT,
  
  -- Governance
  classification_status TEXT DEFAULT 'DRAFT',  -- 'DRAFT', 'PROPOSED', 'APPROVED', 'DEPRECATED'
  approved_by TEXT,
  approved_at DATETIME,
  effective_from DATETIME,
  effective_to DATETIME,
  
  -- Metadata
  mapping_notes TEXT,
  automation_rules TEXT,                  -- JSON: automated drilldown rules
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(company_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_ac_account_code ON account_classification(company_id, account_code);
CREATE INDEX IF NOT EXISTS idx_ac_classification_type ON account_classification(company_id, classification_type);
CREATE INDEX IF NOT EXISTS idx_ac_status ON account_classification(company_id, classification_status);

-- ============================================================================
-- SECTION 5: Create trace_reconciliation_state table
-- ============================================================================

CREATE TABLE IF NOT EXISTS trace_reconciliation_state (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL,
  
  -- Reconciliation scope
  reconciliation_type TEXT NOT NULL,      -- 'full', 'by_source', 'by_period', 'by_rule'
  scope_value TEXT,
  
  -- Results
  total_traced_lines INTEGER,
  traced_correctly INTEGER,
  traced_with_warning INTEGER,
  missing_trace INTEGER,
  unreconciled INTEGER,
  
  -- Audit metrics
  coverage_pct REAL,
  quality_pct REAL,
  
  -- Status
  last_run_at DATETIME,
  next_run_at DATETIME,
  reconciliation_status TEXT DEFAULT 'PENDING',  -- 'PENDING', 'IN_PROGRESS', 'COMPLETE', 'FAILED'
  error_message TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(company_id, reconciliation_type, scope_value)
);

CREATE INDEX IF NOT EXISTS idx_trs_status ON trace_reconciliation_state(company_id, reconciliation_status);

-- ============================================================================
-- SECTION 6: Verify schema extension success
-- ============================================================================
-- After successful execution, verify with:
-- PRAGMA table_info(journal_entries);
-- PRAGMA table_info(journal_entry_lines);
-- SELECT COUNT(*) FROM account_classification;
-- SELECT COUNT(*) FROM posting_trace_log;
