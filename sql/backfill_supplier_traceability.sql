INSERT INTO business_events (
  company_id,
  event_type,
  event_date,
  source_module,
  source_id,
  payload,
  status,
  journal_entry_id,
  posted_at
)
SELECT
  st.company_id,
  CASE WHEN st.entry_type = 'م' THEN 'supplier_payment' ELSE 'supplier_invoice' END,
  st.transaction_date,
  'suppliers',
  st.id,
  json_object(
    'supplier_code', st.supplier_code,
    'amount', st.amount,
    'expense_category', st.expense_category,
    'description', st.description,
    'document_type', st.document_type,
    'document_number', st.document_number,
    'notes', st.notes,
    'journal_entry_id', je.id
  ),
  'posted',
  je.id,
  COALESCE(je.created_at, datetime('now'))
FROM supplier_transactions st
JOIN journal_entries je
  ON je.company_id = st.company_id
 AND je.ref_type = 'supplier_transaction'
 AND je.ref_id = st.id
WHERE st.company_id = 1
  AND NOT EXISTS (
    SELECT 1
    FROM business_events be
    WHERE be.company_id = st.company_id
      AND be.source_module = 'suppliers'
      AND be.source_id = st.id
      AND be.event_type = CASE WHEN st.entry_type = 'م' THEN 'supplier_payment' ELSE 'supplier_invoice' END
  );

INSERT INTO source_documents (
  company_id,
  source_module,
  source_id,
  document_type,
  event_id,
  event_date,
  status,
  payload_snapshot,
  created_by
)
SELECT
  st.company_id,
  'suppliers',
  CAST(st.id AS TEXT),
  be.event_type,
  be.id,
  st.transaction_date,
  'posted',
  be.payload,
  je.created_by
FROM supplier_transactions st
JOIN journal_entries je
  ON je.company_id = st.company_id
 AND je.ref_type = 'supplier_transaction'
 AND je.ref_id = st.id
JOIN business_events be
  ON be.company_id = st.company_id
 AND be.source_module = 'suppliers'
 AND be.source_id = st.id
 AND be.event_type = CASE WHEN st.entry_type = 'م' THEN 'supplier_payment' ELSE 'supplier_invoice' END
WHERE st.company_id = 1
  AND NOT EXISTS (
    SELECT 1
    FROM source_documents sd
    WHERE sd.company_id = st.company_id
      AND sd.source_module = 'suppliers'
      AND sd.source_id = CAST(st.id AS TEXT)
      AND sd.document_type = be.event_type
  );

INSERT INTO source_document_links (
  company_id,
  source_document_id,
  journal_entry_id,
  link_type
)
SELECT
  je.company_id,
  sd.id,
  je.id,
  'primary'
FROM supplier_transactions st
JOIN journal_entries je
  ON je.company_id = st.company_id
 AND je.ref_type = 'supplier_transaction'
 AND je.ref_id = st.id
JOIN business_events be
  ON be.company_id = st.company_id
 AND be.source_module = 'suppliers'
 AND be.source_id = st.id
 AND be.event_type = CASE WHEN st.entry_type = 'م' THEN 'supplier_payment' ELSE 'supplier_invoice' END
JOIN source_documents sd
  ON sd.company_id = st.company_id
 AND sd.source_module = 'suppliers'
 AND sd.source_id = CAST(st.id AS TEXT)
 AND sd.document_type = be.event_type
WHERE st.company_id = 1
  AND NOT EXISTS (
    SELECT 1
    FROM source_document_links sdl
    WHERE sdl.company_id = je.company_id
      AND sdl.source_document_id = sd.id
      AND sdl.journal_entry_id = je.id
      AND sdl.link_type = 'primary'
  );

INSERT INTO source_document_links (
  company_id,
  source_document_id,
  journal_entry_id,
  link_type
)
SELECT
  reclass.company_id,
  sd.id,
  reclass.id,
  'derived'
FROM journal_entries reclass
JOIN journal_entries original
  ON original.company_id = reclass.company_id
 AND original.id = reclass.ref_id
JOIN supplier_transactions st
  ON st.company_id = original.company_id
 AND st.id = original.ref_id
JOIN business_events be
  ON be.company_id = st.company_id
 AND be.source_module = 'suppliers'
 AND be.source_id = st.id
 AND be.event_type = CASE WHEN st.entry_type = 'م' THEN 'supplier_payment' ELSE 'supplier_invoice' END
JOIN source_documents sd
  ON sd.company_id = st.company_id
 AND sd.source_module = 'suppliers'
 AND sd.source_id = CAST(st.id AS TEXT)
 AND sd.document_type = be.event_type
WHERE reclass.company_id = 1
  AND reclass.local_id LIKE 'reclass_supplier_ap_%'
  AND NOT EXISTS (
    SELECT 1
    FROM source_document_links sdl
    WHERE sdl.company_id = reclass.company_id
      AND sdl.source_document_id = sd.id
      AND sdl.journal_entry_id = reclass.id
      AND sdl.link_type = 'derived'
  );