-- Migration 0113: Freeze expense_types table
-- expense_types is deprecated in favour of service_types (canonical since 0100).
-- Existing rows are marked deprecated so no new usage can reference them.
-- The table is preserved (not dropped) for historical FK integrity.

ALTER TABLE expense_types ADD COLUMN is_deprecated INTEGER NOT NULL DEFAULT 0;

UPDATE expense_types SET is_deprecated = 1;
