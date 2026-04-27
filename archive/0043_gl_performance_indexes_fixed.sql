-- =============================================================================
-- 0043_gl_performance_indexes.sql
-- Phase 3 — GL performance indexes for posting-engine hot paths.
-- All statements are safe on live D1 (CREATE INDEX IF NOT EXISTS).
-- =============================================================================

-- ── journal_entries hot filters ──────────────────────────────────────────────
-- Used in: income-statement, balance-sheet, integrity-check, ledger
CREATE INDEX IF NOT EXISTS idx_je_company_posted
  ON journal_entries (company_id, is_posted, entry_date);

CREATE INDEX IF NOT EXISTS idx_je_company_ref
  ON journal_entries (company_id, ref_type, ref_id);

-- ── journal_entry_lines hot joins ────────────────────────────────────────────
-- Used in: all GL statement queries, ledger drill-down
CREATE INDEX IF NOT EXISTS idx_jel_entry_id
  ON journal_entry_lines (entry_id);

CREATE INDEX IF NOT EXISTS idx_jel_account
  ON journal_entry_lines (account_code, company_id);

-- ── chart_of_accounts lookup ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_coa_company_type
  ON chart_of_accounts (company_id, account_type, is_active);

CREATE INDEX IF NOT EXISTS idx_coa_parent
  ON chart_of_accounts (company_id, parent_code);

-- ── posting-engine setup lookups ──────────────────────────────────────────────
-- Used on every posting resolution; these tables are tiny but still benefit
-- from indexed scans when company_id is the first predicate.
CREATE INDEX IF NOT EXISTS idx_gps_company_active
  ON general_posting_setup (company_id, is_active, bus_posting_group_code, prod_posting_group_code);

CREATE INDEX IF NOT EXISTS idx_ips_company_active
  ON inventory_posting_setup (company_id, is_active, inv_posting_group_code, prod_posting_group_code);

-- ── posting-group list queries ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bpg_company
  ON business_posting_groups  (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_ppg_company
  ON product_posting_groups   (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_ipg_company
  ON inventory_posting_groups (company_id, is_active);

-- ── gl_account_mappings — add deprecated marker ───────────────────────────────
-- Marks rows that have been superseded by posting-engine setup.
ALTER TABLE gl_account_mappings ADD COLUMN deprecated_at TEXT DEFAULT NULL;

-- ── supplier_transactions index for statement queries ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_st_supplier_company
  ON supplier_transactions (company_id, supplier_code, created_at DESC);

-- ── inventory_quants for stock lookup ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_iq_company_item
  ON inventory_quants (company_id, item_code, warehouse_code);
