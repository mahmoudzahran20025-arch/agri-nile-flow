-- 0061_source_documents_bridge.sql
-- Add Source Document bridge tables for event-to-GL traceability.

CREATE TABLE IF NOT EXISTS source_documents (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  source_module TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  document_type TEXT NOT NULL,
  event_id INTEGER,
  event_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'posted', 'error', 'reversed')),
  payload_snapshot TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, source_module, source_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_source_documents_event
  ON source_documents(company_id, event_id);

CREATE INDEX IF NOT EXISTS idx_source_documents_lookup
  ON source_documents(company_id, source_module, source_id, document_type);

CREATE TABLE IF NOT EXISTS source_document_links (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  source_document_id INTEGER NOT NULL,
  journal_entry_id INTEGER NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'primary',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, source_document_id, journal_entry_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_source_document_links_entry
  ON source_document_links(company_id, journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_source_document_links_doc
  ON source_document_links(company_id, source_document_id);

-- Best-effort backfill for existing posted business events.
INSERT OR IGNORE INTO source_documents (
  company_id,
  source_module,
  source_id,
  document_type,
  event_id,
  event_date,
  status,
  payload_snapshot,
  created_by,
  created_at,
  updated_at
)
SELECT
  be.company_id,
  be.source_module,
  be.source_id,
  be.event_type,
  be.id,
  be.event_date,
  CASE
    WHEN be.status IN ('pending', 'posted', 'error', 'reversed') THEN be.status
    ELSE 'pending'
  END,
  be.payload,
  be.posted_by,
  COALESCE(be.created_at, datetime('now')),
  datetime('now')
FROM business_events be;

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
  be.journal_entry_id,
  'primary',
  datetime('now')
FROM source_documents sd
JOIN business_events be ON be.id = sd.event_id AND be.company_id = sd.company_id
WHERE be.journal_entry_id IS NOT NULL;
