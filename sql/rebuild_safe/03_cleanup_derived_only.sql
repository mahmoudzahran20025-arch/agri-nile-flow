-- Safe cleanup: remove generated/derived artifacts only (company_id = 1)
-- No BEGIN/COMMIT, compatible with Wrangler D1 execute/import behavior.

DROP TABLE IF EXISTS _target_je;
CREATE TEMP TABLE _target_je (id INTEGER PRIMARY KEY);

INSERT INTO _target_je(id)
SELECT je.id
FROM journal_entries je
WHERE je.company_id = 1
  AND (
    je.local_id LIKE 'phase4_%'
    OR je.local_id LIKE 'reclass_supplier_ap_%'
    OR je.description LIKE 'Phase4 %'
  );

DROP TABLE IF EXISTS _target_be;
CREATE TEMP TABLE _target_be (id INTEGER PRIMARY KEY);

INSERT INTO _target_be(id)
SELECT be.id
FROM business_events be
WHERE be.company_id = 1
  AND be.journal_entry_id IN (SELECT id FROM _target_je);

-- Unlink operational rows first (preserve source operations, remove generated ledger links).
UPDATE supplier_transactions
SET journal_entry_id = NULL
WHERE company_id = 1
  AND journal_entry_id IN (SELECT id FROM _target_je);

UPDATE cash_transactions
SET journal_entry_id = NULL
WHERE company_id = 1
  AND journal_entry_id IN (SELECT id FROM _target_je);

UPDATE inventory_movements
SET journal_entry_id = NULL,
    gl_posting_status = CASE
      WHEN COALESCE(gl_posting_status, '') = 'posted' THEN NULL
      ELSE gl_posting_status
    END,
    gl_posted_at = NULL
WHERE company_id = 1
  AND journal_entry_id IN (SELECT id FROM _target_je);

-- Bridge and posting resolution cleanup for targeted generated entries/events.
DELETE FROM source_document_links
WHERE company_id = 1
  AND (
    journal_entry_id IN (SELECT id FROM _target_je)
    OR source_document_id IN (
      SELECT sd.id
      FROM source_documents sd
      WHERE sd.company_id = 1
        AND sd.event_id IN (SELECT id FROM _target_be)
    )
  );

DELETE FROM posting_rule_resolutions
WHERE company_id = 1
  AND (
    journal_entry_id IN (SELECT id FROM _target_je)
    OR source_event_id IN (SELECT id FROM _target_be)
  );

DELETE FROM source_documents
WHERE company_id = 1
  AND event_id IN (SELECT id FROM _target_be);

-- Delete lines, entries, then events.
DELETE FROM journal_entry_lines
WHERE company_id = 1
  AND entry_id IN (SELECT id FROM _target_je);

DELETE FROM journal_entries
WHERE company_id = 1
  AND id IN (SELECT id FROM _target_je);

DELETE FROM business_events
WHERE company_id = 1
  AND id IN (SELECT id FROM _target_be);

-- Remove pure orphan docs/links left from historical partial repairs.
DELETE FROM source_document_links
WHERE company_id = 1
  AND source_document_id NOT IN (
    SELECT id FROM source_documents WHERE company_id = 1
  );

DELETE FROM source_documents
WHERE company_id = 1
  AND event_id IS NOT NULL
  AND event_id NOT IN (
    SELECT id FROM business_events WHERE company_id = 1
  );

-- Cleanup metrics.
SELECT 'cleanup_result' AS section,
       (SELECT COUNT(*) FROM _target_je) AS removed_generated_entries,
       (SELECT COUNT(*) FROM _target_be) AS removed_linked_events,
       (SELECT COUNT(*) FROM supplier_transactions WHERE company_id = 1 AND journal_entry_id IS NULL) AS supplier_unlinked_after_cleanup,
       (SELECT COUNT(*) FROM cash_transactions WHERE company_id = 1 AND journal_entry_id IS NULL) AS cash_unlinked_after_cleanup,
       (SELECT COUNT(*) FROM inventory_movements WHERE company_id = 1 AND journal_entry_id IS NULL AND movement_type IN ('GRN','ISSUE')) AS inventory_unlinked_after_cleanup;
