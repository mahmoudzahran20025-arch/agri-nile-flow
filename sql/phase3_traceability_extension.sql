-- Phase 3: Traceability Architecture Extension (CORRECTED)
-- =============================================
-- Objective: Add deterministic lineage to every journal entry and line
-- Status: Ready for remote D1 execution
-- Company: company_id = 1
-- Note: source_record_id already exists in journal_entry_lines; adding only new ones

-- ============================================================================
-- SECTION 1: Extend journal_entries with posting/business-event linkage
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
-- SECTION 2: Extend journal_entry_lines with granular trace metadata
-- (source_record_id already exists; adding only new ones needed)
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
-- SECTION 3: Create traceability log table for audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS posting_trace_log (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL,
  
  business_event_type TEXT NOT NULL,
  source_record_id INTEGER NOT NULL,
  source_module TEXT NOT NULL,
  source_timestamp DATETIME NOT NULL,
  
  journal_entry_id INTEGER NOT NULL,
  posting_rule_id TEXT NOT NULL,
  posting_rule_slot TEXT,
  posting_timestamp DATETIME NOT NULL,
  
  resolution_id TEXT,
  generated_by TEXT,
  engine_version TEXT,
  
  is_traced INTEGER DEFAULT 1,
  is_validated INTEGER DEFAULT 0,
  validation_notes TEXT,
  
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
-- SECTION 4: Account classification governance table
-- ============================================================================

CREATE TABLE IF NOT EXISTS account_classification (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL,
  account_code TEXT NOT NULL,
  
  classification_type TEXT NOT NULL,
  sub_classification TEXT,
  accounting_class TEXT,
  
  business_domain TEXT,
  cost_element TEXT,
  balance_sheet_category TEXT,
  
  classification_status TEXT DEFAULT 'DRAFT',
  approved_by TEXT,
  approved_at DATETIME,
  effective_from DATETIME,
  effective_to DATETIME,
  
  mapping_notes TEXT,
  automation_rules TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(company_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_ac_account_code ON account_classification(company_id, account_code);
CREATE INDEX IF NOT EXISTS idx_ac_classification_type ON account_classification(company_id, classification_type);
CREATE INDEX IF NOT EXISTS idx_ac_status ON account_classification(company_id, classification_status);

-- ============================================================================
-- SECTION 5: Trace reconciliation state table
-- ============================================================================

CREATE TABLE IF NOT EXISTS trace_reconciliation_state (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL,
  
  reconciliation_type TEXT NOT NULL,
  scope_value TEXT,
  
  total_traced_lines INTEGER,
  traced_correctly INTEGER,
  traced_with_warning INTEGER,
  missing_trace INTEGER,
  unreconciled INTEGER,
  
  coverage_pct REAL,
  quality_pct REAL,
  
  last_run_at DATETIME,
  next_run_at DATETIME,
  reconciliation_status TEXT DEFAULT 'PENDING',
  error_message TEXT,
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(company_id, reconciliation_type, scope_value)
);

CREATE INDEX IF NOT EXISTS idx_trs_status ON trace_reconciliation_state(company_id, reconciliation_status);

-- ============================================================================
-- SECTION 6: Backfill trace data from existing records
-- ============================================================================

UPDATE journal_entries
SET 
  posting_rule_id = COALESCE(posting_rule_trace, NULL),
  business_event_type = ref_type,
  generated_by = 'backfill-from-audit',
  business_event_id = CAST(ref_id AS TEXT)
WHERE 
  company_id = 1 
  AND posting_rule_id IS NULL 
  AND posting_rule_trace IS NOT NULL;

UPDATE journal_entry_lines
SET 
  business_event_id = (
    SELECT CAST(ref_id AS TEXT) FROM journal_entries je 
    WHERE je.company_id = journal_entry_lines.company_id 
    AND je.id = journal_entry_lines.entry_id 
    LIMIT 1
  ),
  source_module = (
    SELECT ref_type FROM journal_entries je 
    WHERE je.company_id = journal_entry_lines.company_id 
    AND je.id = journal_entry_lines.entry_id 
    LIMIT 1
  ),
  posting_rule_id = (
    SELECT posting_rule_trace FROM journal_entries je 
    WHERE je.company_id = journal_entry_lines.company_id 
    AND je.id = journal_entry_lines.entry_id 
    LIMIT 1
  ),
  generated_at = CURRENT_TIMESTAMP
WHERE 
  company_id = 1 
  AND source_module IS NULL;

UPDATE journal_entry_lines
SET rule_classification = CASE 
  WHEN debit > 0 THEN 'debit'
  WHEN credit > 0 THEN 'credit'
  ELSE 'balancing'
END
WHERE 
  company_id = 1 
  AND rule_classification IS NULL;

-- ============================================================================
-- SECTION 7: Insert account classification proposals
-- ============================================================================

INSERT OR IGNORE INTO account_classification (
  id, company_id, account_code, 
  classification_type, accounting_class,
  business_domain, classification_status, created_at, updated_at
)
SELECT 
  'ac-' || code || '-' || CAST(ABS(RANDOM()) % 9999 AS TEXT),
  company_id,
  code,
  CASE 
    WHEN LOWER(name) LIKE '%مصروف%' THEN 'operating'
    WHEN LOWER(name) LIKE '%اهلاك%' THEN 'administrative'
    WHEN LOWER(name) LIKE '%رأس مال%' THEN 'balance_sheet'
    WHEN LOWER(name) LIKE '%مبيع%' THEN 'operating'
    WHEN LOWER(name) LIKE '%ايراد%' THEN 'operating'
    ELSE 'other'
  END,
  account_type,
  CASE 
    WHEN LOWER(name) LIKE '%بيفوت%' THEN 'pivots'
    WHEN LOWER(name) LIKE '%مخزن%' THEN 'inventory'
    WHEN LOWER(name) LIKE '%مورد%' THEN 'suppliers'
    WHEN LOWER(name) LIKE '%نقد%' THEN 'cash'
    ELSE 'shared'
  END,
  'DRAFT',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM chart_of_accounts
WHERE 
  company_id = 1 
  AND is_header = 0 
  AND is_active = 1;

-- ============================================================================
-- SECTION 8: Trace coverage verification query (Run after migration)
-- ============================================================================
-- SELECT 
--   COUNT(*) AS total_lines,
--   SUM(CASE WHEN business_event_id IS NOT NULL THEN 1 ELSE 0 END) AS with_event_link,
--   SUM(CASE WHEN posting_rule_id IS NOT NULL THEN 1 ELSE 0 END) AS with_rule_link,
--   SUM(CASE WHEN source_record_id IS NOT NULL THEN 1 ELSE 0 END) AS with_source_link,
--   SUM(CASE WHEN rule_classification IS NOT NULL THEN 1 ELSE 0 END) AS with_classification,
--   ROUND(100.0 * SUM(CASE WHEN business_event_id IS NOT NULL AND source_record_id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) AS trace_coverage_pct
-- FROM journal_entry_lines
-- WHERE company_id = 1;
