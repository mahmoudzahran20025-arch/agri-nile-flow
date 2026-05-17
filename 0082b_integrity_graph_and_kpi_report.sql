-- 0082b_integrity_graph_and_kpi_report.sql
-- Read-only reporting after reconstruction

-- Broken edges
SELECT 'BROKEN_BE_TO_PRR' AS edge, COUNT(*) AS n
FROM business_events be
WHERE be.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM posting_rule_resolutions prr
    WHERE prr.company_id = be.company_id
      AND prr.source_event_id = be.id
  );

SELECT 'BROKEN_PRR_TO_JE' AS edge, COUNT(*) AS n
FROM posting_rule_resolutions prr
WHERE prr.company_id = 1
  AND (
    prr.journal_entry_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM journal_entries je
      WHERE je.company_id = prr.company_id
        AND je.id = prr.journal_entry_id
    )
  );

SELECT 'BROKEN_JE_TO_JEL' AS edge, COUNT(*) AS n
FROM journal_entries je
WHERE je.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM journal_entry_lines jel
    WHERE jel.company_id = je.company_id
      AND jel.entry_id = je.id
  );

SELECT 'BROKEN_BE_TO_SD' AS edge, COUNT(*) AS n
FROM business_events be
WHERE be.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM source_documents sd
    WHERE sd.company_id = be.company_id
      AND sd.event_id = be.id
  );

SELECT 'BROKEN_SD_TO_SDL' AS edge, COUNT(*) AS n
FROM source_documents sd
WHERE sd.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM source_document_links sdl
    WHERE sdl.company_id = sd.company_id
      AND sdl.source_document_id = sd.id
  );

SELECT 'BROKEN_SDL_TO_JE' AS edge, COUNT(*) AS n
FROM source_document_links sdl
WHERE sdl.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.company_id = sdl.company_id
      AND je.id = sdl.journal_entry_id
  );

-- Missing nodes
SELECT 'MISSING_NODE_BE' AS node, COUNT(*) AS n
FROM posting_rule_resolutions prr
WHERE prr.company_id = 1
  AND prr.source_event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM business_events be
    WHERE be.company_id = prr.company_id
      AND be.id = prr.source_event_id
  );

SELECT 'MISSING_NODE_JE' AS node, COUNT(*) AS n
FROM source_document_links sdl
WHERE sdl.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.company_id = sdl.company_id
      AND je.id = sdl.journal_entry_id
  );

SELECT 'MISSING_NODE_SD' AS node, COUNT(*) AS n
FROM source_document_links sdl
WHERE sdl.company_id = 1
  AND NOT EXISTS (
    SELECT 1 FROM source_documents sd
    WHERE sd.company_id = sdl.company_id
      AND sd.id = sdl.source_document_id
  );

-- Duplicated chains
SELECT 'DUPLICATED_EVENT_CHAIN' AS chain_type, COUNT(*) AS n
FROM (
  SELECT be.id, je.id AS je_id
  FROM business_events be
  JOIN posting_rule_resolutions prr
    ON prr.company_id = be.company_id
   AND prr.source_event_id = be.id
  JOIN journal_entries je
    ON je.company_id = be.company_id
   AND je.id = prr.journal_entry_id
  WHERE be.company_id = 1
  GROUP BY be.id, je.id
  HAVING COUNT(prr.id) > 1
) x;

SELECT 'DUPLICATED_DOC_LINK_CHAIN' AS chain_type, COUNT(*) AS n
FROM (
  SELECT sd.id, sdl.journal_entry_id, sdl.link_type, COUNT(*) c
  FROM source_documents sd
  JOIN source_document_links sdl
    ON sdl.company_id = sd.company_id
   AND sdl.source_document_id = sd.id
  WHERE sd.company_id = 1
  GROUP BY sd.id, sdl.journal_entry_id, sdl.link_type
  HAVING COUNT(*) > 1
) y;

-- KPI blocks
SELECT 'KPI_VALID_ROWS' AS metric, COUNT(*) AS n
FROM tmp_integrity_classification
WHERE category = 'VALID';

SELECT 'KPI_TOTAL_ROWS' AS metric, COUNT(*) AS n
FROM tmp_integrity_classification;

SELECT 'KPI_ORPHAN_ROWS' AS metric, COUNT(*) AS n
FROM tmp_integrity_classification
WHERE category IN ('ORPHAN_EVENT','ORPHAN_TRACE','ORPHAN_SOURCE');

SELECT 'KPI_RECOVERY_UNRECOVERABLE' AS metric, COUNT(*) AS n
FROM data_integrity_recovery_log
WHERE company_id = 1
  AND status = 'UNRECOVERABLE_NOT_DELETABLE';

SELECT 'KPI_BE_POSTED_WITH_JE' AS metric, COUNT(*) AS n
FROM business_events
WHERE company_id = 1
  AND status = 'posted'
  AND journal_entry_id IS NOT NULL;

SELECT 'KPI_BE_TOTAL' AS metric, COUNT(*) AS n
FROM business_events
WHERE company_id = 1;

SELECT 'KPI_JE_BALANCED' AS metric, COUNT(*) AS n
FROM (
  SELECT je.id
  FROM journal_entries je
  JOIN journal_entry_lines jl
    ON jl.entry_id = je.id
   AND jl.company_id = je.company_id
  WHERE je.company_id = 1
  GROUP BY je.id
  HAVING ABS(COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0)) <= 0.01
) z;

SELECT 'KPI_JE_TOTAL' AS metric, COUNT(*) AS n
FROM journal_entries
WHERE company_id = 1;
