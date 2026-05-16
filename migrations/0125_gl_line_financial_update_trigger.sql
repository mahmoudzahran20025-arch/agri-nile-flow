-- Migration: 0125_gl_line_financial_update_trigger
-- Purpose: Prevent modification of financial fields on posted journal entry lines
-- Invariant: Once a journal entry is posted (is_posted=1), debit/credit/account_code
--            on its lines are immutable. Trace metadata (business_event_id, etc.) may
--            still be updated by the regeneration engine.
-- Affected tables: journal_entry_lines
-- Reversible: YES (DROP TRIGGER below)
-- Estimated rows affected: 0 (DDL only)
-- Safe to apply live: YES — trigger fires only on UPDATE, not existing rows

CREATE TRIGGER IF NOT EXISTS trg_gl_prevent_posted_line_financial_update
BEFORE UPDATE ON journal_entry_lines
WHEN (
  NEW.debit     <> OLD.debit     OR
  NEW.credit    <> OLD.credit    OR
  NEW.account_code <> OLD.account_code
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot modify financial fields (debit/credit/account_code) of a posted journal entry line. Use a reversal entry instead.')
  WHERE (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id AND company_id = NEW.company_id LIMIT 1) = 1;
END;

-- REVERSE:
-- DROP TRIGGER IF EXISTS trg_gl_prevent_posted_line_financial_update;
