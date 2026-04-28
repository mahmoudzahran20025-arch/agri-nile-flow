-- 0050_drop_legacy_posting_tables.sql
-- FINAL hard-cut migration.
-- Run only after verification window confirms all posting flows are reading posting_rules.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS gl_account_mappings;
DROP TABLE IF EXISTS general_posting_setup;
DROP TABLE IF EXISTS inventory_posting_setup;

PRAGMA foreign_keys = ON;
