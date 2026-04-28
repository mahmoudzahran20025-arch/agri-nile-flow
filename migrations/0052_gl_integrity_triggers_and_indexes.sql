-- =============================================================================
-- 0052_gl_integrity_triggers_and_indexes.sql
-- Section 11 (DB integrity constraints) + Section 17 (performance indexes)
-- from SYSTEM_ARCHITECTURE_REALITY_CHECK.md
--
-- Triggers enforce the 10 Laws at the database layer:
--   Law 3:  Every journal_entry is balanced (enforced by app; backed here)
--   Law 8:  Posted entries are immutable
--   Law 4:  Only posting accounts receive direct lines
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION A — GL INTEGRITY TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Block deletion of posted journal entries.
--    Corrections must go through reversal (POST /gl/entries/:id/reverse).
CREATE TRIGGER IF NOT EXISTS trg_gl_prevent_posted_delete
BEFORE DELETE ON journal_entries
WHEN OLD.is_posted = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot delete a posted journal entry. Use reversal instead.');
END;

-- 2. Block UPDATE on lines whose parent entry is already posted.
CREATE TRIGGER IF NOT EXISTS trg_gl_prevent_posted_line_update
BEFORE UPDATE ON journal_entry_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot modify lines of a posted journal entry. Use reversal instead.');
END;

-- 3. Block DELETE on lines whose parent entry is already posted.
CREATE TRIGGER IF NOT EXISTS trg_gl_prevent_posted_line_delete
BEFORE DELETE ON journal_entry_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot delete lines of a posted journal entry. Use reversal instead.');
END;

-- 4. Block posting to header accounts (groups that contain child accounts).
--    Posting must always land on a leaf / detail account.
CREATE TRIGGER IF NOT EXISTS trg_gl_enforce_no_header_posting
BEFORE INSERT ON journal_entry_lines
WHEN (
  SELECT is_header FROM chart_of_accounts
  WHERE code = NEW.account_code AND company_id = NEW.company_id
) = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to a header account. Use a posting-level (leaf) account.');
END;

-- 5. Block inserting journal entries into closed financial periods.
--    financial_periods.is_closed = 1 means the period is sealed.
CREATE TRIGGER IF NOT EXISTS trg_gl_enforce_open_period
BEFORE INSERT ON journal_entries
WHEN (
  SELECT is_closed FROM financial_periods
  WHERE id = NEW.period_id AND company_id = NEW.company_id
) = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot post to a closed financial period. Reopen the period or select an open one.');
END;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION B — PERFORMANCE INDEXES (current schema post-migration-0050)
-- ═══════════════════════════════════════════════════════════════════════════════
-- These replace the indexes in 0043_gl_performance_indexes.sql that referenced
-- the now-dropped tables (general_posting_setup, inventory_posting_setup,
-- business_posting_groups, product_posting_groups, inventory_posting_groups,
-- gl_account_mappings).

-- ── posting_rules: engine cascade resolution (hot path on every transaction) ──
-- Covers: company_id filter + rule_type discriminator + wildcard group lookups
CREATE INDEX IF NOT EXISTS idx_pr_cascade
  ON posting_rules (company_id, rule_type, is_active,
                    bus_posting_group_code, prod_posting_group_code, inv_posting_group_code);

-- posting_rules: control/singleton account lookup (getMapping calls)
CREATE INDEX IF NOT EXISTS idx_pr_control
  ON posting_rules (company_id, rule_type, mapping_key, is_active)
  WHERE mapping_key IS NOT NULL;

-- ── business_events: status + coverage queries ────────────────────────────────
-- Used in: integrity score (coverage), orphan detection, period-close guard
CREATE INDEX IF NOT EXISTS idx_be_status
  ON business_events (company_id, status);

-- Used in: source document lookup, event replay
CREATE INDEX IF NOT EXISTS idx_be_source
  ON business_events (company_id, source_module, source_id);

-- Used in: event type dashboards, audit log
CREATE INDEX IF NOT EXISTS idx_be_type_date
  ON business_events (company_id, event_type, event_date);

-- ── journal_entry_lines: new dimension columns (added in migration 0029/0051) ─
-- Used in: cost center reports, season P&L, field P&L
CREATE INDEX IF NOT EXISTS idx_jel_center
  ON journal_entry_lines (company_id, center_code, entry_id)
  WHERE center_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jel_season
  ON journal_entry_lines (company_id, season_id, entry_id)
  WHERE season_id IS NOT NULL;

-- Used in: GL-inventory reconciliation, orphan detection
CREATE INDEX IF NOT EXISTS idx_jel_rule_slot
  ON journal_entry_lines (company_id, rule_slot)
  WHERE rule_slot IS NOT NULL;

-- ── posting_rule_resolutions: engine audit queries ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prr_company_date
  ON posting_rule_resolutions (company_id, resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_prr_entry
  ON posting_rule_resolutions (journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;
