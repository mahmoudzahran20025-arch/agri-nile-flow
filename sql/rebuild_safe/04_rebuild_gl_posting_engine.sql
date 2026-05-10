-- Step 4 Rebuild: Recreate GL Posting Engine
-- Rebuild business_events, posting_rule_resolutions, journal_entries, journal_entry_lines
-- from operational tables (supplier_transactions, cash_transactions, inventory_movements)
-- Company: 1, Date: 2026-05-09

-- Phase 1: Recreate business_events from operational records
-- These represent the canonical business transactions that trigger GL postings

INSERT INTO business_events (
  company_id, source_module, source_id, event_type, 
  transaction_date, amount, description, created_at
)
SELECT 
  company_id, 'suppliers', id, 'SUPPLIER_TRANSACTION',
  transaction_date, total_amount, 
  COALESCE(description, '') || ' [' || supplier_code || ']',
  COALESCE(created_at, datetime('now'))
FROM supplier_transactions
WHERE company_id = 1
  AND status = 'posted'
  AND id NOT IN (SELECT source_id FROM business_events WHERE company_id = 1 AND source_module = 'suppliers')
ON CONFLICT DO NOTHING;

INSERT INTO business_events (
  company_id, source_module, source_id, event_type, 
  transaction_date, amount, description, created_at
)
SELECT 
  company_id, 'cash', id, 'CASH_TRANSACTION',
  transaction_date, amount,
  COALESCE(narration, '') || ' [' || CASE direction WHEN 'د' THEN 'Debit' ELSE 'Credit' END || ']',
  COALESCE(created_at, datetime('now'))
FROM cash_transactions
WHERE company_id = 1
  AND status = 'posted'
  AND id NOT IN (SELECT source_id FROM business_events WHERE company_id = 1 AND source_module = 'cash')
ON CONFLICT DO NOTHING;

INSERT INTO business_events (
  company_id, source_module, source_id, event_type, 
  transaction_date, amount, description, created_at
)
SELECT 
  company_id, 'inventory', id, 'INVENTORY_MOVEMENT',
  movement_date, (quantity * unit_cost),
  COALESCE(reference_number, '') || ' [' || movement_type || ']',
  COALESCE(created_at, datetime('now'))
FROM inventory_movements
WHERE company_id = 1
  AND status = 'posted'
  AND movement_type IN ('GRN', 'ISSUE')
  AND id NOT IN (SELECT source_id FROM business_events WHERE company_id = 1 AND source_module = 'inventory')
ON CONFLICT DO NOTHING;

-- Phase 2: Recreate posting_rule_resolutions
-- These map which posting rules apply to which business events

INSERT INTO posting_rule_resolutions (
  company_id, source_event_id, posting_rule_id, 
  debit_account, debit_center, credit_account, credit_center,
  amount, direction, created_at
)
SELECT 
  be.company_id, be.id, pr.id,
  pr.debit_account_code, pr.debit_center_code,
  pr.credit_account_code, pr.credit_center_code,
  be.amount, 'balance', datetime('now')
FROM business_events be
LEFT JOIN posting_rule_resolutions prr 
  ON prr.source_event_id = be.id AND prr.company_id = be.company_id
JOIN posting_rules pr ON pr.company_id = be.company_id
WHERE be.company_id = 1
  AND prr.id IS NULL  -- Not yet resolved
  AND (
    (be.source_module = 'suppliers' AND pr.entity_type = 'supplier')
    OR (be.source_module = 'cash' AND pr.entity_type = 'cash')
    OR (be.source_module = 'inventory' AND pr.entity_type = 'inventory')
  )
ON CONFLICT DO NOTHING;

-- Phase 3: Create journal_entries from business_events
-- One journal entry per business event

INSERT INTO journal_entries (
  company_id, period_id, entry_date, description,
  ref_type, ref_id, source_module,
  debit, credit, is_posted, created_at
)
SELECT 
  be.company_id,
  (SELECT id FROM financial_periods 
   WHERE company_id = be.company_id 
   AND start_date <= be.transaction_date 
   AND end_date >= be.transaction_date 
   LIMIT 1),
  be.transaction_date,
  be.description,
  be.source_module,
  be.source_id,
  be.source_module,
  be.amount,
  be.amount,
  1,
  datetime('now')
FROM business_events be
WHERE be.company_id = 1
  AND be.source_module IN ('suppliers', 'cash', 'inventory')
  AND be.id NOT IN (SELECT DISTINCT je.id FROM journal_entries je WHERE je.company_id = 1 AND je.id = be.id)
ON CONFLICT DO NOTHING;

-- Phase 4: Create journal_entry_lines from posting_rule_resolutions
-- Each resolution creates debit and credit lines

INSERT INTO journal_entry_lines (
  company_id, entry_id, account_code, center_code,
  debit, credit, narration, source_module, source_record_id
)
SELECT 
  prr.company_id,
  (SELECT id FROM journal_entries 
   WHERE company_id = prr.company_id 
   AND ref_id = (SELECT source_id FROM business_events WHERE id = prr.source_event_id AND company_id = prr.company_id)
   AND source_module = (SELECT source_module FROM business_events WHERE id = prr.source_event_id AND company_id = prr.company_id)
   LIMIT 1),
  prr.debit_account,
  prr.debit_center,
  prr.amount,
  0,
  'Debit line from posting rule',
  'posting_rule',
  prr.posting_rule_id
FROM posting_rule_resolutions prr
WHERE prr.company_id = 1
  AND prr.debit_account IS NOT NULL
  AND prr.id NOT IN (SELECT DISTINCT source_record_id FROM journal_entry_lines WHERE company_id = 1 AND source_module = 'posting_rule')
ON CONFLICT DO NOTHING;

INSERT INTO journal_entry_lines (
  company_id, entry_id, account_code, center_code,
  debit, credit, narration, source_module, source_record_id
)
SELECT 
  prr.company_id,
  (SELECT id FROM journal_entries 
   WHERE company_id = prr.company_id 
   AND ref_id = (SELECT source_id FROM business_events WHERE id = prr.source_event_id AND company_id = prr.company_id)
   AND source_module = (SELECT source_module FROM business_events WHERE id = prr.source_event_id AND company_id = prr.company_id)
   LIMIT 1),
  prr.credit_account,
  prr.credit_center,
  0,
  prr.amount,
  'Credit line from posting rule',
  'posting_rule',
  prr.posting_rule_id
FROM posting_rule_resolutions prr
WHERE prr.company_id = 1
  AND prr.credit_account IS NOT NULL
  AND prr.id NOT IN (SELECT DISTINCT source_record_id FROM journal_entry_lines WHERE company_id = 1 AND source_module = 'posting_rule')
ON CONFLICT DO NOTHING;

-- Phase 5: Link operational transactions back to journal entries
UPDATE supplier_transactions
SET journal_entry_id = (
  SELECT id FROM journal_entries 
  WHERE company_id = 1 
  AND ref_type = 'suppliers'
  AND ref_id = supplier_transactions.id
  LIMIT 1
)
WHERE company_id = 1
  AND status = 'posted'
  AND journal_entry_id IS NULL;

UPDATE cash_transactions
SET journal_entry_id = (
  SELECT id FROM journal_entries 
  WHERE company_id = 1 
  AND ref_type = 'cash'
  AND ref_id = cash_transactions.id
  LIMIT 1
)
WHERE company_id = 1
  AND status = 'posted'
  AND journal_entry_id IS NULL;

UPDATE inventory_movements
SET journal_entry_id = (
  SELECT id FROM journal_entries 
  WHERE company_id = 1 
  AND ref_type = 'inventory'
  AND ref_id = inventory_movements.id
  LIMIT 1
),
gl_posted_at = datetime('now')
WHERE company_id = 1
  AND status = 'posted'
  AND movement_type IN ('GRN', 'ISSUE')
  AND journal_entry_id IS NULL;

-- Phase 6: Rebuild account balances
DELETE FROM account_balances
WHERE company_id = 1
  AND period_id IN (SELECT id FROM financial_periods WHERE company_id = 1 AND is_closed = 0);

INSERT INTO account_balances (
  company_id, account_code, period_id,
  opening_balance, debit_total, credit_total, closing_balance
)
SELECT 
  je.company_id,
  jl.account_code,
  je.period_id,
  0,
  SUM(COALESCE(jl.debit, 0)),
  SUM(COALESCE(jl.credit, 0)),
  SUM(COALESCE(jl.debit, 0)) - SUM(COALESCE(jl.credit, 0))
FROM journal_entries je
JOIN journal_entry_lines jl ON jl.entry_id = je.id AND jl.company_id = je.company_id
WHERE je.company_id = 1
  AND je.is_posted = 1
GROUP BY je.company_id, jl.account_code, je.period_id
ON CONFLICT DO NOTHING;

-- Phase 7: Final verification and reporting
SELECT 'REBUILD_COMPLETE' AS section,
       (SELECT COUNT(*) FROM business_events WHERE company_id = 1) as business_events_recreated,
       (SELECT COUNT(*) FROM posting_rule_resolutions WHERE company_id = 1) as posting_rules_resolved,
       (SELECT COUNT(*) FROM journal_entries WHERE company_id = 1) as journal_entries_created,
       (SELECT COUNT(*) FROM journal_entry_lines WHERE company_id = 1) as journal_entry_lines_created,
       (SELECT SUM(debit) FROM journal_entries WHERE company_id = 1) as total_debits,
       (SELECT SUM(credit) FROM journal_entries WHERE company_id = 1) as total_credits,
       (SELECT COUNT(*) FROM supplier_transactions WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NOT NULL) as supplier_linked,
       (SELECT COUNT(*) FROM cash_transactions WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NOT NULL) as cash_linked,
       (SELECT COUNT(*) FROM inventory_movements WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NOT NULL) as inventory_linked;
