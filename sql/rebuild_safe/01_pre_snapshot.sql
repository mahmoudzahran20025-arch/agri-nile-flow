-- Safe rebuild pre-snapshot (company_id = 1)

SELECT 'counts' AS section,
       (SELECT COUNT(*) FROM supplier_transactions WHERE company_id = 1) AS supplier_transactions,
       (SELECT COUNT(*) FROM cash_transactions WHERE company_id = 1) AS cash_transactions,
       (SELECT COUNT(*) FROM inventory_movements WHERE company_id = 1) AS inventory_movements,
       (SELECT COUNT(*) FROM business_events WHERE company_id = 1) AS business_events,
       (SELECT COUNT(*) FROM journal_entries WHERE company_id = 1) AS journal_entries,
       (SELECT COUNT(*) FROM journal_entry_lines WHERE company_id = 1) AS journal_entry_lines,
       (SELECT COUNT(*) FROM source_documents WHERE company_id = 1) AS source_documents,
       (SELECT COUNT(*) FROM source_document_links WHERE company_id = 1) AS source_document_links,
       (SELECT COUNT(*) FROM posting_rule_resolutions WHERE company_id = 1) AS posting_rule_resolutions;

SELECT 'generated_candidates' AS section,
       COUNT(*) AS candidate_entries,
       SUM(CASE WHEN local_id LIKE 'phase4_%' THEN 1 ELSE 0 END) AS phase4_local_id,
       SUM(CASE WHEN local_id LIKE 'reclass_supplier_ap_%' THEN 1 ELSE 0 END) AS reclass_local_id
FROM journal_entries
WHERE company_id = 1
  AND (
    local_id LIKE 'phase4_%'
    OR local_id LIKE 'reclass_supplier_ap_%'
    OR description LIKE 'Phase4 %'
  );

SELECT 'generated_amounts' AS section,
       ROUND(COALESCE(SUM(jel.debit), 0), 2) AS generated_debit,
       ROUND(COALESCE(SUM(jel.credit), 0), 2) AS generated_credit
FROM journal_entry_lines jel
WHERE jel.company_id = 1
  AND jel.entry_id IN (
    SELECT je.id
    FROM journal_entries je
    WHERE je.company_id = 1
      AND (
        je.local_id LIKE 'phase4_%'
        OR je.local_id LIKE 'reclass_supplier_ap_%'
        OR je.description LIKE 'Phase4 %'
      )
  );
