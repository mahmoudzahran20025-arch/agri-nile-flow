-- Cleanup only test journal residue before production-clean reseed.
-- Scope is limited to journal entries whose description starts with [TEST_UNPOSTED]%
-- plus direct dependent rows discovered during pre-reseed checks.

-- Delete operational row that still points to a test journal entry.
DELETE FROM cash_transactions
WHERE company_id = 1
  AND journal_entry_id IN (
    SELECT id
    FROM journal_entries
    WHERE company_id = 1
      AND description LIKE '[TEST_UNPOSTED]%'
  );

-- Delete bridge/link rows first.
DELETE FROM source_document_links
WHERE company_id = 1
  AND (
    journal_entry_id IN (
      SELECT id
      FROM journal_entries
      WHERE company_id = 1
        AND description LIKE '[TEST_UNPOSTED]%'
    )
    OR source_document_id IN (
      SELECT sd.id
      FROM source_documents sd
      JOIN journal_entries je
        ON je.ref_id = sd.event_id
       AND je.ref_type = 'business_event'
       AND je.company_id = sd.company_id
      WHERE sd.company_id = 1
        AND je.description LIKE '[TEST_UNPOSTED]%'
    )
  );

DELETE FROM source_documents
WHERE company_id = 1
  AND event_id IN (
    SELECT ref_id
    FROM journal_entries
    WHERE company_id = 1
      AND ref_type = 'business_event'
      AND description LIKE '[TEST_UNPOSTED]%'
  );

DELETE FROM posting_rule_resolutions
WHERE company_id = 1
  AND (
    journal_entry_id IN (
      SELECT id
      FROM journal_entries
      WHERE company_id = 1
        AND description LIKE '[TEST_UNPOSTED]%'
    )
    OR source_event_id IN (
      SELECT ref_id
      FROM journal_entries
      WHERE company_id = 1
        AND ref_type = 'business_event'
        AND description LIKE '[TEST_UNPOSTED]%'
    )
  );

DELETE FROM journal_entry_lines
WHERE company_id = 1
  AND entry_id IN (
    SELECT id
    FROM journal_entries
    WHERE company_id = 1
      AND description LIKE '[TEST_UNPOSTED]%'
  );

DELETE FROM business_events
WHERE company_id = 1
  AND id IN (
    SELECT ref_id
    FROM journal_entries
    WHERE company_id = 1
      AND ref_type = 'business_event'
      AND description LIKE '[TEST_UNPOSTED]%'
  );

DELETE FROM journal_entries
WHERE company_id = 1
  AND description LIKE '[TEST_UNPOSTED]%';
