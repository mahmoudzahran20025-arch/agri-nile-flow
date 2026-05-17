-- Migration 0136: form_templates + form_fields schema drift repair
--
-- Root cause: migration 0110 created form_templates without a `notes` column
-- and form_fields without a `width_hint` column. The /api/schema/forms handler
-- queries both columns, producing SQLITE_ERROR "no such column: ft.notes"
-- (confirmed via system_error_logs stack traces 2026-05-17).
--
-- These are nullable additive columns — zero risk, zero rollback required.

ALTER TABLE form_templates ADD COLUMN notes TEXT;

ALTER TABLE form_fields ADD COLUMN width_hint TEXT;
