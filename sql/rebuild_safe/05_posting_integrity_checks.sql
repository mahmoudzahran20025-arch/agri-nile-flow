-- Final integrity checks after rebuild (company_id = 1)

SELECT 'unlinked_posted_rows' AS section,
       (SELECT COUNT(*) FROM supplier_transactions WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL) AS supplier_unlinked,
       (SELECT COUNT(*) FROM cash_transactions WHERE company_id = 1 AND status = 'posted' AND journal_entry_id IS NULL) AS cash_unlinked,
       (SELECT COUNT(*) FROM inventory_movements WHERE company_id = 1 AND status = 'posted' AND movement_type IN ('GRN','ISSUE') AND journal_entry_id IS NULL AND COALESCE(gl_posting_status,'') NOT IN ('exempt_zero_value','skipped_zero_value')) AS inventory_unlinked;

SELECT 'unbalanced_entries' AS section,
       COUNT(*) AS unbalanced_count
FROM (
  SELECT je.id
  FROM journal_entries je
  JOIN journal_entry_lines jl
    ON jl.entry_id = je.id
   AND jl.company_id = je.company_id
  WHERE je.company_id = 1
    AND je.ref_type IN ('supplier_transaction','cash_transaction','inventory_movement')
  GROUP BY je.id
  HAVING ABS(ROUND(SUM(COALESCE(jl.debit,0)),2) - ROUND(SUM(COALESCE(jl.credit,0)),2)) > 0.01
);

SELECT 'traceability_orphans' AS section,
       (SELECT COUNT(*)
        FROM source_documents sd
        LEFT JOIN business_events be
          ON be.id = sd.event_id
         AND be.company_id = sd.company_id
        WHERE sd.company_id = 1
          AND sd.event_id IS NOT NULL
          AND be.id IS NULL) AS orphan_source_documents,
       (SELECT COUNT(*)
        FROM source_document_links sdl
        LEFT JOIN source_documents sd
          ON sd.id = sdl.source_document_id
         AND sd.company_id = sdl.company_id
        WHERE sdl.company_id = 1
          AND sd.id IS NULL) AS orphan_source_document_links;
