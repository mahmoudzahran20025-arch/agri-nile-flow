-- Post-cleanup snapshot (company_id = 1)

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

SELECT 'remaining_generated_candidates' AS section,
       COUNT(*) AS remaining_generated_entries
FROM journal_entries
WHERE company_id = 1
  AND (
    local_id LIKE 'phase4_%'
    OR local_id LIKE 'reclass_supplier_ap_%'
    OR description LIKE 'Phase4 %'
  );
