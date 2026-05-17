-- 0092_operation_types.sql
-- Goal: Create operation_types lookup table so operation type dropdowns
--       are driven by DB data and configurable from the admin panel
--       without future migrations.

CREATE TABLE IF NOT EXISTS operation_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_operation_types_company ON operation_types(company_id, sort_order);

-- ── Seed default types for company_id = 1 ────────────────────
-- Uses INSERT OR IGNORE so re-running this migration is safe.
INSERT OR IGNORE INTO operation_types (company_id, name, sort_order) VALUES
  (1, 'ري',      1),
  (1, 'تسميد',   2),
  (1, 'رش',      3),
  (1, 'حراثة',   4),
  (1, 'زراعة',   5),
  (1, 'حصاد',    6),
  (1, 'أخرى',    99);
