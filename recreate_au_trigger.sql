CREATE TRIGGER trg_account_balances_au_jel
AFTER UPDATE ON journal_entry_lines
BEGIN
  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = OLD.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id),
    OLD.account_code,
    0, 0, 0, 0,
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit -
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL THEN COALESCE(OLD.debit, 0) ELSE 0 END),
    period_credit = period_credit -
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL THEN COALESCE(OLD.credit, 0) ELSE 0 END),
    closing_balance = closing_balance -
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = OLD.entry_id) IS NOT NULL THEN (COALESCE(OLD.debit, 0) - COALESCE(OLD.credit, 0)) ELSE 0 END),
    updated_at = datetime('now');

  INSERT INTO account_balances (
    company_id, period_id, account_code,
    opening_balance, period_debit, period_credit, closing_balance, updated_at
  )
  VALUES (
    (SELECT company_id FROM journal_entries WHERE id = NEW.entry_id),
    (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id),
    NEW.account_code,
    0, 0, 0, 0,
    datetime('now')
  )
  ON CONFLICT(company_id, period_id, account_code)
  DO UPDATE SET
    period_debit = period_debit +
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL THEN COALESCE(NEW.debit, 0) ELSE 0 END),
    period_credit = period_credit +
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL THEN COALESCE(NEW.credit, 0) ELSE 0 END),
    closing_balance = closing_balance +
      (CASE WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1 AND (SELECT period_id FROM journal_entries WHERE id = NEW.entry_id) IS NOT NULL THEN (COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0)) ELSE 0 END),
    updated_at = datetime('now');
END;
