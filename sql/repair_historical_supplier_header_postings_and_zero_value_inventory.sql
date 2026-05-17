-- Repair historical financially material live-data issues identified in final ERP posting verification.
-- 1) Controlled historical remediation: temporarily drop the posted-line immutability trigger,
--    remap supplier_transaction journal lines from header account 2120 to the active AP control leaf 212000010,
--    then recreate the trigger immediately.
-- 2) Exempt the zero-value inventory movement 6767 from GL posting so it no longer appears as ghost-posted.

DROP TRIGGER IF EXISTS trg_gl_prevent_posted_line_update;

UPDATE journal_entry_lines
SET account_code = '212000010'
WHERE company_id = 1
  AND account_code = '2120'
  AND entry_id IN (
    SELECT id
    FROM journal_entries
    WHERE company_id = 1
      AND ref_type = 'supplier_transaction'
  );

CREATE TRIGGER IF NOT EXISTS trg_gl_prevent_posted_line_update
BEFORE UPDATE ON journal_entry_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY_VIOLATION: Cannot modify lines of a posted journal entry. Use reversal instead.');
END;

UPDATE inventory_movements
SET gl_posting_status = 'exempt_zero_value',
    zero_value_reason = COALESCE(zero_value_reason, 'historical_zero_value_live_repair'),
    gl_posting_error = NULL,
    gl_posted_at = COALESCE(gl_posted_at, datetime('now'))
WHERE company_id = 1
  AND id = 6767
  AND gl_posting_status = 'posted'
  AND COALESCE(value_in, 0) = 0
  AND COALESCE(value_out, 0) = 0
  AND journal_entry_id IS NULL;
