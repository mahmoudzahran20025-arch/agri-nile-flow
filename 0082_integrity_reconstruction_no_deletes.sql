-- 0082_integrity_reconstruction_no_deletes.sql
-- Non-destructive integrity reconstruction for event-trace-source graph.
-- NO DELETE statements. Only INSERT/UPDATE.

-- -----------------------------------------------------------------------------
-- Recovery log for rows that cannot be safely reconstructed.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_integrity_recovery_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_tag TEXT NOT NULL,
  company_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RECOVERED', 'UNRECOVERABLE_NOT_DELETABLE')),
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- 1) Re-link business_events -> journal_entries using ref_id + company_id
-- -----------------------------------------------------------------------------
UPDATE business_events
SET journal_entry_id = (
  SELECT je.id
  FROM journal_entries je
  WHERE je.company_id = business_events.company_id
    AND je.ref_type = 'business_event'
    AND je.ref_id = business_events.id
  ORDER BY je.id DESC
  LIMIT 1
),
status = CASE
  WHEN (
    SELECT je.is_posted
    FROM journal_entries je
    WHERE je.company_id = business_events.company_id
      AND je.ref_type = 'business_event'
      AND je.ref_id = business_events.id
    ORDER BY je.id DESC
    LIMIT 1
  ) = 1 THEN 'posted'
  ELSE business_events.status
END
WHERE company_id = 1
  AND (
    journal_entry_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM journal_entries jev
      WHERE jev.id = business_events.journal_entry_id
        AND jev.company_id = business_events.company_id
    )
  )
  AND EXISTS (
    SELECT 1
    FROM journal_entries je
    WHERE je.company_id = business_events.company_id
      AND je.ref_type = 'business_event'
      AND je.ref_id = business_events.id
  );

-- -----------------------------------------------------------------------------
-- 2) Rebuild posting_rule_resolutions from journal_entry_lines.rule_slot + trace
-- -----------------------------------------------------------------------------
INSERT INTO posting_rule_resolutions (
  company_id,
  resolved_at,
  rule_type,
  input_bpg,
  input_ppg,
  input_ipg,
  resolution_step,
  matched_rule_id,
  result,
  error_message,
  journal_entry_id,
  source_event_id
)
SELECT
  je.company_id,
  datetime('now') AS resolved_at,
  COALESCE(json_extract(je.posting_rule_trace, '$.rule_type'), be.event_type, 'unknown') AS rule_type,
  json_extract(je.posting_rule_trace, '$.input_bpg') AS input_bpg,
  json_extract(je.posting_rule_trace, '$.input_ppg') AS input_ppg,
  json_extract(je.posting_rule_trace, '$.input_ipg') AS input_ipg,
  json_extract(je.posting_rule_trace, '$.resolution_step') AS resolution_step,
  json_extract(je.posting_rule_trace, '$.matched_rule_id') AS matched_rule_id,
  'resolved' AS result,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM journal_entry_lines jel
      WHERE jel.company_id = je.company_id
        AND jel.entry_id = je.id
        AND jel.rule_slot IS NOT NULL
    ) THEN NULL
    ELSE 'REBUILT_WITHOUT_RULE_SLOT'
  END AS error_message,
  je.id AS journal_entry_id,
  be.id AS source_event_id
FROM journal_entries je
JOIN business_events be
  ON be.company_id = je.company_id
 AND be.id = je.ref_id
WHERE je.company_id = 1
  AND je.ref_type = 'business_event'
  AND NOT EXISTS (
    SELECT 1
    FROM posting_rule_resolutions prr
    WHERE prr.company_id = je.company_id
      AND prr.journal_entry_id = je.id
      AND prr.source_event_id = be.id
  );

-- -----------------------------------------------------------------------------
-- 3) Repair source_documents.event_id where missing/broken via module/source/type
-- -----------------------------------------------------------------------------
UPDATE source_documents
SET event_id = (
  SELECT be.id
  FROM business_events be
  WHERE be.company_id = source_documents.company_id
    AND be.source_module = source_documents.source_module
    AND CAST(be.source_id AS TEXT) = CAST(source_documents.source_id AS TEXT)
    AND be.event_type = source_documents.document_type
  ORDER BY be.id DESC
  LIMIT 1
),
updated_at = datetime('now')
WHERE company_id = 1
  AND (
    event_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM business_events bex
      WHERE bex.id = source_documents.event_id
        AND bex.company_id = source_documents.company_id
    )
  )
  AND EXISTS (
    SELECT 1
    FROM business_events be
    WHERE be.company_id = source_documents.company_id
      AND be.source_module = source_documents.source_module
      AND CAST(be.source_id AS TEXT) = CAST(source_documents.source_id AS TEXT)
      AND be.event_type = source_documents.document_type
  );

-- -----------------------------------------------------------------------------
-- 4) Fix source_document_links when journal parent is missing
-- -----------------------------------------------------------------------------
UPDATE source_document_links
SET journal_entry_id = (
  SELECT COALESCE(
    be.journal_entry_id,
    (
      SELECT je2.id
      FROM journal_entries je2
      WHERE je2.company_id = source_document_links.company_id
        AND je2.ref_type = 'business_event'
        AND je2.ref_id = sd.event_id
      ORDER BY je2.id DESC
      LIMIT 1
    )
  )
  FROM source_documents sd
  LEFT JOIN business_events be
    ON be.id = sd.event_id
   AND be.company_id = sd.company_id
  WHERE sd.id = source_document_links.source_document_id
    AND sd.company_id = source_document_links.company_id
)
WHERE company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.id = source_document_links.journal_entry_id
      AND je.company_id = source_document_links.company_id
  )
  AND EXISTS (
    SELECT 1
    FROM source_documents sd
    LEFT JOIN business_events be
      ON be.id = sd.event_id
     AND be.company_id = sd.company_id
    WHERE sd.id = source_document_links.source_document_id
      AND sd.company_id = source_document_links.company_id
      AND (
        be.journal_entry_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM journal_entries je2
          WHERE je2.company_id = source_document_links.company_id
            AND je2.ref_type = 'business_event'
            AND je2.ref_id = sd.event_id
        )
      )
  );

-- Insert missing links from source_documents/events to posted journals
INSERT OR IGNORE INTO source_document_links (
  company_id,
  source_document_id,
  journal_entry_id,
  link_type,
  created_at
)
SELECT
  sd.company_id,
  sd.id,
  COALESCE(
    be.journal_entry_id,
    (
      SELECT je.id
      FROM journal_entries je
      WHERE je.company_id = sd.company_id
        AND je.ref_type = 'business_event'
        AND je.ref_id = sd.event_id
      ORDER BY je.id DESC
      LIMIT 1
    )
  ) AS journal_entry_id,
  'primary' AS link_type,
  datetime('now')
FROM source_documents sd
LEFT JOIN business_events be
  ON be.id = sd.event_id
 AND be.company_id = sd.company_id
WHERE sd.company_id = 1
  AND sd.event_id IS NOT NULL
  AND COALESCE(
    be.journal_entry_id,
    (
      SELECT je.id
      FROM journal_entries je
      WHERE je.company_id = sd.company_id
        AND je.ref_type = 'business_event'
        AND je.ref_id = sd.event_id
      ORDER BY je.id DESC
      LIMIT 1
    )
  ) IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5) Re-assign missing posting_rule_trace from latest posting_rule_resolutions
-- -----------------------------------------------------------------------------
UPDATE journal_entries
SET posting_rule_trace = (
  SELECT json_object(
    'rule_type', prr.rule_type,
    'input_bpg', prr.input_bpg,
    'input_ppg', prr.input_ppg,
    'input_ipg', prr.input_ipg,
    'resolution_step', prr.resolution_step,
    'matched_rule_id', prr.matched_rule_id,
    'resolved_at', prr.resolved_at,
    'reconstructed', 1
  )
  FROM posting_rule_resolutions prr
  WHERE prr.company_id = journal_entries.company_id
    AND prr.journal_entry_id = journal_entries.id
  ORDER BY prr.id DESC
  LIMIT 1
)
WHERE company_id = 1
  AND ref_type = 'business_event'
  AND posting_rule_trace IS NULL
  AND EXISTS (
    SELECT 1
    FROM posting_rule_resolutions prr
    WHERE prr.company_id = journal_entries.company_id
      AND prr.journal_entry_id = journal_entries.id
  );

-- -----------------------------------------------------------------------------
-- 6) Log unrecoverable rows (no delete, no invalid status mutation)
-- -----------------------------------------------------------------------------
INSERT INTO data_integrity_recovery_log (
  run_tag, company_id, entity_type, entity_id, issue_type, status, details
)
SELECT
  strftime('%Y%m%d_%H%M%S', 'now') AS run_tag,
  je.company_id,
  'journal_entries',
  CAST(je.id AS TEXT),
  'ORPHAN_EVENT',
  'UNRECOVERABLE_NOT_DELETABLE',
  'ref_type=business_event but no matching business_events row by ref_id'
FROM journal_entries je
WHERE je.company_id = 1
  AND je.ref_type = 'business_event'
  AND NOT EXISTS (
    SELECT 1
    FROM business_events be
    WHERE be.company_id = je.company_id
      AND be.id = je.ref_id
  );

INSERT INTO data_integrity_recovery_log (
  run_tag, company_id, entity_type, entity_id, issue_type, status, details
)
SELECT
  strftime('%Y%m%d_%H%M%S', 'now') AS run_tag,
  prr.company_id,
  'posting_rule_resolutions',
  CAST(prr.id AS TEXT),
  'ORPHAN_TRACE',
  'UNRECOVERABLE_NOT_DELETABLE',
  'source_event_id has no business_events parent'
FROM posting_rule_resolutions prr
WHERE prr.company_id = 1
  AND prr.source_event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM business_events be
    WHERE be.company_id = prr.company_id
      AND be.id = prr.source_event_id
  );

INSERT INTO data_integrity_recovery_log (
  run_tag, company_id, entity_type, entity_id, issue_type, status, details
)
SELECT
  strftime('%Y%m%d_%H%M%S', 'now') AS run_tag,
  sdl.company_id,
  'source_document_links',
  CAST(sdl.id AS TEXT),
  'ORPHAN_SOURCE',
  'UNRECOVERABLE_NOT_DELETABLE',
  'journal_entry_id has no journal_entries parent after reconstruction attempt'
FROM source_document_links sdl
WHERE sdl.company_id = 1
  AND NOT EXISTS (
    SELECT 1
    FROM journal_entries je
    WHERE je.company_id = sdl.company_id
      AND je.id = sdl.journal_entry_id
  );
