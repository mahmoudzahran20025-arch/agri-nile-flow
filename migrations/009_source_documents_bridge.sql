-- Migration 009: Source Documents Bridge Tables
-- Adds the reconciliation bridge tables used by business_events.ts and gl/reconciliation.ts

CREATE TABLE IF NOT EXISTS source_documents (
  id              INTEGER PRIMARY KEY,
  company_id      INTEGER NOT NULL,
  source_module   TEXT    NOT NULL,
  source_id       TEXT    NOT NULL,
  document_type   TEXT    NOT NULL,
  event_id        INTEGER,
  event_date      TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending',
  payload_snapshot TEXT,
  created_by      INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, source_module, source_id, document_type)
);

CREATE TABLE IF NOT EXISTS source_document_links (
  id                  INTEGER PRIMARY KEY,
  company_id          INTEGER NOT NULL,
  source_document_id  INTEGER NOT NULL,
  journal_entry_id    INTEGER NOT NULL,
  link_type           TEXT    NOT NULL DEFAULT 'primary',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, source_document_id, journal_entry_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_source_docs_company_module   ON source_documents(company_id, source_module);
CREATE INDEX IF NOT EXISTS idx_source_docs_status           ON source_documents(company_id, status);
CREATE INDEX IF NOT EXISTS idx_source_doc_links_doc         ON source_document_links(source_document_id);
CREATE INDEX IF NOT EXISTS idx_source_doc_links_entry       ON source_document_links(journal_entry_id);
