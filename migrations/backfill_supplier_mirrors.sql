-- Backfill supplier_transactions mirrors for historical cash payments
-- Each row's running balance is computed as the cumulative sum per supplier
INSERT INTO supplier_transactions
  (company_id, season_id, supplier_code, transaction_date, entry_type, document_type,
   notes, amount, credit, debit, balance_no_checks, balance_with_checks,
   status, created_by_user_id, local_id, center_code)
SELECT
  ct.company_id,
  ct.season_id,
  ct.supplier_code,
  ct.transaction_date,
  ct.direction                                                             AS entry_type,
  'cash_payment'                                                           AS document_type,
  ct.narration                                                             AS notes,
  ct.amount,
  CASE WHEN ct.direction = 'د' THEN ct.amount ELSE 0 END                  AS credit,
  CASE WHEN ct.direction = 'م' THEN ct.amount ELSE 0 END                  AS debit,
  SUM(CASE WHEN ct.direction = 'د' THEN ct.amount ELSE -ct.amount END)
    OVER (PARTITION BY ct.company_id, ct.supplier_code
          ORDER BY ct.transaction_date, ct.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)               AS balance_no_checks,
  SUM(CASE WHEN ct.direction = 'د' THEN ct.amount ELSE -ct.amount END)
    OVER (PARTITION BY ct.company_id, ct.supplier_code
          ORDER BY ct.transaction_date, ct.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)               AS balance_with_checks,
  'posted'                                                                 AS status,
  ct.created_by_user_id,
  'st_' || ct.local_id                                                     AS local_id,
  ct.center_code
FROM cash_transactions ct
WHERE ct.company_id = 1
  AND ct.supplier_code IS NOT NULL
  AND ct.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM supplier_transactions st
    WHERE st.company_id = 1 AND st.local_id = 'st_' || ct.local_id
  )
ORDER BY ct.supplier_code, ct.transaction_date, ct.id;
