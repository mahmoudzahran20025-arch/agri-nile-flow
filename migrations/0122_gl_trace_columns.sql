-- =============================================================================
-- Migration 0122 — GL Trace Columns for Regeneration Engine
-- Date: 2026-05-15
--
-- Adds the missing trace/audit columns that enhanced_ledger.ts and
-- journal_entry_regeneration.ts reference but were never added to the schema.
--
-- journal_entries additions:
--   business_event_id   — FK-by-value to business_events.id (TEXT, not INTEGER,
--                         because business_events.id is INTEGER but we store as
--                         TEXT for flexibility in the regeneration engine)
--   business_event_type — mirrors business_events.ref_type for query convenience
--   posting_rule_id     — which posting rule resolved this entry
--   generated_by        — engine version tag when regenerated
--
-- journal_entry_lines additions:
--   business_event_id   — propagated from parent entry
--   source_module       — 'inventory_movement' | 'supplier' | 'cash' | 'manual'
--   posting_rule_id     — rule that produced this specific line
--   rule_classification — 'debit' | 'credit' | 'balancing'
--   generated_at        — ISO timestamp of last regeneration run
--
-- All columns default NULL — existing rows are unaffected and will show
-- NULL until the /api/gl/journal-entry-regeneration/rebuild endpoint is run.
--
-- Rollback: DROP COLUMN is not supported in SQLite / D1; to undo,
-- recreate the tables without these columns (destructive — not recommended).
-- =============================================================================

-- ── journal_entries ──────────────────────────────────────────────────────────
ALTER TABLE journal_entries ADD COLUMN business_event_id   TEXT    DEFAULT NULL;
ALTER TABLE journal_entries ADD COLUMN business_event_type TEXT    DEFAULT NULL;
ALTER TABLE journal_entries ADD COLUMN posting_rule_id     TEXT    DEFAULT NULL;
ALTER TABLE journal_entries ADD COLUMN generated_by        TEXT    DEFAULT NULL;

-- ── journal_entry_lines ──────────────────────────────────────────────────────
ALTER TABLE journal_entry_lines ADD COLUMN business_event_id   TEXT    DEFAULT NULL;
ALTER TABLE journal_entry_lines ADD COLUMN source_module       TEXT    DEFAULT NULL;
ALTER TABLE journal_entry_lines ADD COLUMN posting_rule_id     TEXT    DEFAULT NULL;
ALTER TABLE journal_entry_lines ADD COLUMN rule_classification TEXT    DEFAULT NULL;
ALTER TABLE journal_entry_lines ADD COLUMN generated_at        TEXT    DEFAULT NULL;

-- ── Index: fast lookup of untraced entries for regeneration batches ──────────
CREATE INDEX IF NOT EXISTS idx_je_business_event_id
  ON journal_entries(company_id, business_event_id)
  WHERE business_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jel_source_module
  ON journal_entry_lines(company_id, source_module)
  WHERE source_module IS NOT NULL;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT
  'migration_0122_complete'                                        AS status,
  (SELECT COUNT(*) FROM pragma_table_info('journal_entries')
   WHERE name = 'business_event_id')                              AS je_business_event_id,
  (SELECT COUNT(*) FROM pragma_table_info('journal_entries')
   WHERE name = 'generated_by')                                   AS je_generated_by,
  (SELECT COUNT(*) FROM pragma_table_info('journal_entry_lines')
   WHERE name = 'source_module')                                  AS jel_source_module,
  (SELECT COUNT(*) FROM pragma_table_info('journal_entry_lines')
   WHERE name = 'rule_classification')                            AS jel_rule_classification;
