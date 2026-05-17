-- Migration 0114: Hard-freeze expense_types at the DB level
-- expense_types was deprecated in 0113 (is_deprecated = 1 for all rows).
-- This migration installs DB triggers that make write operations impossible,
-- regardless of what application code does. service_types is the sole authority
-- for all new expense/service classifications.

-- Block any new INSERTs
CREATE TRIGGER IF NOT EXISTS trg_expense_types_block_insert
BEFORE INSERT ON expense_types
BEGIN
  SELECT RAISE(ABORT, 'ERR_FROZEN: expense_types محظور. استخدم service_types لإضافة تصنيفات جديدة.');
END;

-- Block any UPDATEs (schema-level read-only)
CREATE TRIGGER IF NOT EXISTS trg_expense_types_block_update
BEFORE UPDATE ON expense_types
BEGIN
  SELECT RAISE(ABORT, 'ERR_FROZEN: expense_types محظور. لا يمكن تعديل السجلات المودعة.');
END;

-- Ensure all existing rows are marked deprecated (idempotent)
UPDATE expense_types SET is_deprecated = 1 WHERE is_deprecated = 0;
