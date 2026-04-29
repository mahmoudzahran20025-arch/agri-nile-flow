-- =============================================================================
-- 0058_coa_hierarchy_enforcement_and_closure.sql
-- Enforce CoA parent rules at DB level and add closure table for scalable tree reads.
-- =============================================================================

PRAGMA foreign_keys = OFF;

-- Closure table (ancestor -> descendant) for fast tree traversal and rollups.
CREATE TABLE IF NOT EXISTS coa_closure (
  company_id      INTEGER NOT NULL,
  ancestor_code   TEXT    NOT NULL,
  descendant_code TEXT    NOT NULL,
  depth           INTEGER NOT NULL CHECK(depth >= 0),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, ancestor_code, descendant_code)
);

CREATE INDEX IF NOT EXISTS idx_coa_closure_ancestor
  ON coa_closure(company_id, ancestor_code, depth);

CREATE INDEX IF NOT EXISTS idx_coa_closure_descendant
  ON coa_closure(company_id, descendant_code, depth);

-- Parent validation trigger (insert): parent must exist, active, and header.
CREATE TRIGGER IF NOT EXISTS trg_coa_parent_guard_insert
BEFORE INSERT ON chart_of_accounts
WHEN NEW.parent_code IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM chart_of_accounts p
      WHERE p.company_id = NEW.company_id
        AND p.code = NEW.parent_code
    )
    THEN RAISE(ABORT, 'COA_PARENT_INVALID: parent account does not exist in same company')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM chart_of_accounts p
      WHERE p.company_id = NEW.company_id
        AND p.code = NEW.parent_code
        AND p.is_active = 0
    )
    THEN RAISE(ABORT, 'COA_PARENT_INVALID: parent account is inactive')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM chart_of_accounts p
      WHERE p.company_id = NEW.company_id
        AND p.code = NEW.parent_code
        AND p.is_header = 0
    )
    THEN RAISE(ABORT, 'COA_PARENT_INVALID: parent must be a header account')
  END;
END;

-- Parent validation trigger (update): parent must exist, active, and header.
CREATE TRIGGER IF NOT EXISTS trg_coa_parent_guard_update
BEFORE UPDATE OF parent_code ON chart_of_accounts
WHEN NEW.parent_code IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM chart_of_accounts p
      WHERE p.company_id = NEW.company_id
        AND p.code = NEW.parent_code
    )
    THEN RAISE(ABORT, 'COA_PARENT_INVALID: parent account does not exist in same company')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM chart_of_accounts p
      WHERE p.company_id = NEW.company_id
        AND p.code = NEW.parent_code
        AND p.is_active = 0
    )
    THEN RAISE(ABORT, 'COA_PARENT_INVALID: parent account is inactive')
  END;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM chart_of_accounts p
      WHERE p.company_id = NEW.company_id
        AND p.code = NEW.parent_code
        AND p.is_header = 0
    )
    THEN RAISE(ABORT, 'COA_PARENT_INVALID: parent must be a header account')
  END;
END;

-- Prevent deactivating header accounts that still have active children.
CREATE TRIGGER IF NOT EXISTS trg_coa_prevent_header_deactivate_with_children
BEFORE UPDATE OF is_active ON chart_of_accounts
WHEN OLD.is_active = 1 AND NEW.is_active = 0 AND OLD.is_header = 1
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM chart_of_accounts c
      WHERE c.company_id = OLD.company_id
        AND c.parent_code = OLD.code
        AND c.is_active = 1
    )
    THEN RAISE(ABORT, 'COA_DEACTIVATE_BLOCKED: header account has active children')
  END;
END;

-- Initial closure backfill (safe to rerun after cleanup via API sync).
DELETE FROM coa_closure;

INSERT INTO coa_closure (company_id, ancestor_code, descendant_code, depth)
WITH RECURSIVE closure(company_id, ancestor_code, descendant_code, depth) AS (
  SELECT company_id, code, code, 0
  FROM chart_of_accounts
  UNION ALL
  SELECT c.company_id, c.ancestor_code, child.code, c.depth + 1
  FROM closure c
  JOIN chart_of_accounts child
    ON child.company_id = c.company_id
   AND child.parent_code = c.descendant_code
)
SELECT company_id, ancestor_code, descendant_code, depth
FROM closure;

PRAGMA foreign_keys = ON;
