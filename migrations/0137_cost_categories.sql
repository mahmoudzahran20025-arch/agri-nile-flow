-- Migration: 0137 — Cost categories master table
--
-- Replaces the hardcoded cost_category CHECK enum in wip_ledger.
-- Hybrid design: system categories (is_system=1) cannot be deleted; user-defined
-- sub-categories hang off them via parent_id. Reports aggregate by system_type
-- or parent chain — never by display name strings.
--
-- system_type mirrors the original enum values so existing wip_ledger rows
-- remain meaningful after migration 0138 adds the FK column.

CREATE TABLE IF NOT EXISTS cost_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  code        TEXT    NOT NULL,
  name_ar     TEXT    NOT NULL,
  name_en     TEXT,
  parent_id   INTEGER REFERENCES cost_categories(id),
  system_type TEXT    NOT NULL,
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK(is_system IN (0,1)),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cost_categories_company
  ON cost_categories(company_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_cost_categories_system_type
  ON cost_categories(company_id, system_type);

-- ── Seed system categories for every existing company ────────────────────────
-- One INSERT per category to keep SQLite syntax clean.

INSERT OR IGNORE INTO cost_categories (company_id, code, name_ar, name_en, system_type, is_system, sort_order)
  SELECT id, 'materials',    'مواد وخامات',         'Materials',    'materials',    1, 10  FROM companies;

INSERT OR IGNORE INTO cost_categories (company_id, code, name_ar, name_en, system_type, is_system, sort_order)
  SELECT id, 'labor',        'أجور وعمالة',         'Labor',        'labor',        1, 20  FROM companies;

INSERT OR IGNORE INTO cost_categories (company_id, code, name_ar, name_en, system_type, is_system, sort_order)
  SELECT id, 'equipment',    'آلات ومعدات',         'Equipment',    'equipment',    1, 30  FROM companies;

INSERT OR IGNORE INTO cost_categories (company_id, code, name_ar, name_en, system_type, is_system, sort_order)
  SELECT id, 'overhead',     'مصاريف عامة',         'Overhead',     'overhead',     1, 40  FROM companies;

INSERT OR IGNORE INTO cost_categories (company_id, code, name_ar, name_en, system_type, is_system, sort_order)
  SELECT id, 'depreciation', 'استهلاك أصول',        'Depreciation', 'depreciation', 1, 50  FROM companies;

INSERT OR IGNORE INTO cost_categories (company_id, code, name_ar, name_en, system_type, is_system, sort_order)
  SELECT id, 'land_rent',    'إيجار أراضي',         'Land Rent',    'land_rent',    1, 60  FROM companies;

INSERT OR IGNORE INTO cost_categories (company_id, code, name_ar, name_en, system_type, is_system, sort_order)
  SELECT id, 'utilities',    'مرافق (كهرباء/مياه)',  'Utilities',    'utilities',    1, 70  FROM companies;

INSERT OR IGNORE INTO cost_categories (company_id, code, name_ar, name_en, system_type, is_system, sort_order)
  SELECT id, 'transport',    'نقل وشحن',            'Transport',    'transport',    1, 80  FROM companies;

INSERT OR IGNORE INTO cost_categories (company_id, code, name_ar, name_en, system_type, is_system, sort_order)
  SELECT id, 'other',        'تكاليف أخرى',         'Other',        'other',        1, 90  FROM companies;
