-- Rebuild traceability bridge from current journal_entries/business_events (company_id = 1)

INSERT OR IGNORE INTO business_events (
  company_id,
  event_type,
  event_date,
  source_module,
  source_id,
  payload,
  status,
  journal_entry_id,
  posted_at,
  created_at
)
SELECT
  je.company_id,
  CASE je.ref_type
    WHEN 'inventory_movement' THEN 'INVENTORY_POSTED'
    WHEN 'supplier_transaction' THEN 'SUPPLIER_POSTED'
    WHEN 'cash_transaction' THEN 'CASH_POSTED'
    ELSE 'GL_POSTED'
  END,
  je.entry_date,
  je.ref_type,
  je.ref_id,
  json_object('journal_entry_id', je.id, 'ref_type', je.ref_type, 'ref_id', je.ref_id, 'description', je.description),
  'posted',
  je.id,
  COALESCE(je.created_at, datetime('now')),
  datetime('now')
FROM journal_entries je
WHERE je.company_id = 1
  AND je.ref_type IN ('inventory_movement','supplier_transaction','cash_transaction')
  AND je.ref_id IS NOT NULL;

INSERT OR IGNORE INTO source_documents (
  company_id,
  source_module,
  source_id,
  document_type,
  event_id,
  event_date,
  status,
  payload_snapshot,
  created_at,
  updated_at
)
SELECT
  je.company_id,
  je.ref_type,
  CAST(je.ref_id AS TEXT),
  je.ref_type,
  (
    SELECT be.id
    FROM business_events be
    WHERE be.company_id = je.company_id
      AND be.source_module = je.ref_type
      AND be.source_id = je.ref_id
    ORDER BY be.id DESC
    LIMIT 1
  ),
  je.entry_date,
  'posted',
  json_object('journal_entry_id', je.id, 'description', je.description, 'ref_type', je.ref_type, 'ref_id', je.ref_id),
  datetime('now'),
  datetime('now')
FROM journal_entries je
WHERE je.company_id = 1
  AND je.ref_type IN ('inventory_movement','supplier_transaction','cash_transaction')
  AND je.ref_id IS NOT NULL;

INSERT OR IGNORE INTO source_document_links (
  company_id,
  source_document_id,
  journal_entry_id,
  link_type,
  created_at
)
SELECT
  je.company_id,
  sd.id,
  je.id,
  'primary',
  datetime('now')
FROM journal_entries je
JOIN source_documents sd
  ON sd.company_id = je.company_id
 AND sd.source_module = je.ref_type
 AND sd.source_id = CAST(je.ref_id AS TEXT)
 AND sd.document_type = je.ref_type
WHERE je.company_id = 1
  AND je.ref_type IN ('inventory_movement','supplier_transaction','cash_transaction')
  AND je.ref_id IS NOT NULL;

SELECT 'traceability_rebuild' AS section,
       (SELECT COUNT(*) FROM business_events WHERE company_id = 1) AS business_events,
       (SELECT COUNT(*) FROM source_documents WHERE company_id = 1) AS source_documents,
       (SELECT COUNT(*) FROM source_document_links WHERE company_id = 1) AS source_document_links;
