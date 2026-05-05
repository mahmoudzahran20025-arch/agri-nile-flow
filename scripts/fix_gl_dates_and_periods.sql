-- 1) Fix future supplier transaction dates using real creation date
UPDATE supplier_transactions
SET transaction_date = date(created_at),
    year = CAST(strftime('%Y', date(created_at)) AS INTEGER),
    month = CAST(strftime('%m', date(created_at)) AS INTEGER)
WHERE company_id = 1
  AND transaction_date > date('now')
  AND created_at IS NOT NULL;

-- 2) Keep business_events aligned with corrected supplier transaction date
UPDATE business_events
SET event_date = (
  SELECT st.transaction_date
  FROM supplier_transactions st
  WHERE st.company_id = business_events.company_id
    AND st.id = business_events.source_id
)
WHERE company_id = 1
  AND event_date > date('now')
  AND source_module = 'supplier'
  AND EXISTS (
    SELECT 1
    FROM supplier_transactions st
    WHERE st.company_id = business_events.company_id
      AND st.id = business_events.source_id
  );

-- 3) Keep GL journal entry date aligned with corrected supplier transaction date
UPDATE journal_entries
SET entry_date = (
  SELECT st.transaction_date
  FROM supplier_transactions st
  WHERE st.company_id = journal_entries.company_id
    AND st.id = journal_entries.ref_id
)
WHERE company_id = 1
  AND ref_type = 'supplier_transaction'
  AND entry_date > date('now')
  AND EXISTS (
    SELECT 1
    FROM supplier_transactions st
    WHERE st.company_id = journal_entries.company_id
      AND st.id = journal_entries.ref_id
  );

-- 4) Backfill missing period_id using date-range match
UPDATE journal_entries
SET period_id = (
  SELECT fp.id
  FROM financial_periods fp
  WHERE fp.company_id = journal_entries.company_id
    AND journal_entries.entry_date BETWEEN fp.start_date AND fp.end_date
  ORDER BY fp.start_date DESC
  LIMIT 1
)
WHERE company_id = 1
  AND period_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM financial_periods fp
    WHERE fp.company_id = journal_entries.company_id
      AND journal_entries.entry_date BETWEEN fp.start_date AND fp.end_date
  );
