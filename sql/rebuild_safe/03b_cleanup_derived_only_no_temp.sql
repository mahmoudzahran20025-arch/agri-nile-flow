-- Safe cleanup: remove generated/derived artifacts only (company_id = 1)
-- D1-compatible version without temp tables.

-- Unlink operational rows first (preserve source operations, remove generated ledger links).
UPDATE supplier_transactions
SET journal_entry_id = NULL
WHERE company_id = 1
  AND journal_entry_id IN (
    SELECT id
    FROM journal_entries
    WHERE company_id = 1
      AND (
        local_id LIKE 'phase4_%'
        OR local_id LIKE 'reclass_supplier_ap_%'
        OR description LIKE 'Phase4 %'
      )
  );

UPDATE cash_transactions
SET journal_entry_id = NULL
WHERE company_id = 1
  AND journal_entry_id IN (
    SELECT id
    FROM journal_entries
    WHERE company_id = 1
      AND (
        local_id LIKE 'phase4_%'
        OR local_id LIKE 'reclass_supplier_ap_%'
        OR description LIKE 'Phase4 %'
      )
  );

UPDATE inventory_movements
SET journal_entry_id = NULL,
    gl_posted_at = NULL
WHERE company_id = 1
  AND journal_entry_id IN (
    SELECT id
    FROM journal_entries
    WHERE company_id = 1
      AND (
        local_id LIKE 'phase4_%'
        OR local_id LIKE 'reclass_supplier_ap_%'
        OR description LIKE 'Phase4 %'
      )
  );

DELETE FROM source_document_links
WHERE company_id = 1
  AND (
    journal_entry_id IN (
      SELECT id
      FROM journal_entries
      WHERE company_id = 1
        AND (
          local_id LIKE 'phase4_%'
          OR local_id LIKE 'reclass_supplier_ap_%'
          OR description LIKE 'Phase4 %'
        )
    )
    OR source_document_id IN (
      SELECT sd.id
      FROM source_documents sd
      WHERE sd.company_id = 1
        AND sd.event_id IN (
          SELECT be.id
          FROM business_events be
          WHERE be.company_id = 1
            AND be.journal_entry_id IN (
              SELECT id
              FROM journal_entries
              WHERE company_id = 1
                AND (
                  local_id LIKE 'phase4_%'
                  OR local_id LIKE 'reclass_supplier_ap_%'
                  OR description LIKE 'Phase4 %'
                )
            )
        )
    )
  );

DELETE FROM posting_rule_resolutions
WHERE company_id = 1
  AND (
    journal_entry_id IN (
      SELECT id
      FROM journal_entries
      WHERE company_id = 1
        AND (
          local_id LIKE 'phase4_%'
          OR local_id LIKE 'reclass_supplier_ap_%'
          OR description LIKE 'Phase4 %'
        )
    )
    OR source_event_id IN (
      SELECT be.id
      FROM business_events be
      WHERE be.company_id = 1
        AND be.journal_entry_id IN (
          SELECT id
          FROM journal_entries
          WHERE company_id = 1
            AND (
              local_id LIKE 'phase4_%'
              OR local_id LIKE 'reclass_supplier_ap_%'
              OR description LIKE 'Phase4 %'
            )
        )
    )
  );

DELETE FROM source_documents
WHERE company_id = 1
  AND event_id IN (
    SELECT be.id
    FROM business_events be
    WHERE be.company_id = 1
      AND be.journal_entry_id IN (
        SELECT id
        FROM journal_entries
        WHERE company_id = 1
          AND (
            local_id LIKE 'phase4_%'
            OR local_id LIKE 'reclass_supplier_ap_%'
            OR description LIKE 'Phase4 %'
          )
      )
  );

UPDATE journal_entries
SET is_posted = 0
WHERE company_id = 1
  AND is_posted = 1
  AND (
    local_id LIKE 'phase4_%'
    OR local_id LIKE 'reclass_supplier_ap_%'
    OR description LIKE 'Phase4 %'
  );

DELETE FROM journal_entry_lines
WHERE company_id = 1
  AND entry_id IN (
    SELECT id
    FROM journal_entries
    WHERE company_id = 1
      AND (
        local_id LIKE 'phase4_%'
        OR local_id LIKE 'reclass_supplier_ap_%'
        OR description LIKE 'Phase4 %'
      )
  );

DELETE FROM business_events
WHERE company_id = 1
  AND journal_entry_id IN (
    SELECT id
    FROM journal_entries
    WHERE company_id = 1
      AND (
        local_id LIKE 'phase4_%'
        OR local_id LIKE 'reclass_supplier_ap_%'
        OR description LIKE 'Phase4 %'
      )
  );

DELETE FROM journal_entries
WHERE company_id = 1
  AND (
    local_id LIKE 'phase4_%'
    OR local_id LIKE 'reclass_supplier_ap_%'
    OR description LIKE 'Phase4 %'
  );

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

SELECT 'cleanup_result' AS section,
       (SELECT COUNT(*) FROM journal_entries WHERE company_id = 1 AND (local_id LIKE 'phase4_%' OR local_id LIKE 'reclass_supplier_ap_%' OR description LIKE 'Phase4 %')) AS remaining_generated_entries,
       (SELECT COUNT(*) FROM supplier_transactions WHERE company_id = 1 AND status='posted' AND journal_entry_id IS NULL) AS supplier_unlinked_after_cleanup,
       (SELECT COUNT(*) FROM cash_transactions WHERE company_id = 1 AND status='posted' AND journal_entry_id IS NULL) AS cash_unlinked_after_cleanup,
       (SELECT COUNT(*) FROM inventory_movements WHERE company_id = 1 AND status='posted' AND movement_type IN ('GRN','ISSUE') AND journal_entry_id IS NULL AND COALESCE(gl_posting_status,'') NOT IN ('exempt_zero_value','skipped_zero_value')) AS inventory_unlinked_after_cleanup;
