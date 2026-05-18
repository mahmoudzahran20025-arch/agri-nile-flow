-- 0161: Semantic Governance Hardening
-- Enforces frozen rules from docs/SEMANTIC_GOVERNANCE.md at the DB layer.
--
-- Rules enforced here:
--   A) items.code is immutable after creation
--   B) items.base_unit_code is immutable once any inventory movement exists
--   C) inventory_posting_controls auto-seeded for every new company
--   D) sales_returns open-period guard (return_date must be in an open GL period)
--
-- All triggers use ABORT so the parent transaction rolls back cleanly.

-- ── A: items.code immutability ────────────────────────────────────────────────
-- An item code is the universal identifier referenced by every movement,
-- order, and WIP entry. Renumbering after transactions exist would orphan data.

CREATE TRIGGER IF NOT EXISTS trg_items_code_immutable
BEFORE UPDATE OF code ON items
BEGIN
  SELECT CASE
    WHEN NEW.code != OLD.code
    THEN RAISE(ABORT, 'SEMANTIC_VIOLATION: items.code is immutable — create a new item instead of renumbering')
  END;
END;

-- ── B: items.base_unit_code immutability after first movement ────────────────
-- Changing the base unit after movements exist silently corrupts all running
-- balances, conversion ratios, and COGS values. The guard checks for any
-- movement with this item_code before allowing the update.

CREATE TRIGGER IF NOT EXISTS trg_items_base_unit_immutable
BEFORE UPDATE OF base_unit_code ON items
BEGIN
  SELECT CASE
    WHEN NEW.base_unit_code != OLD.base_unit_code
     AND OLD.base_unit_code IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM inventory_movements
       WHERE item_code = OLD.code AND company_id = OLD.company_id
       LIMIT 1
     )
    THEN RAISE(ABORT, 'SEMANTIC_VIOLATION: items.base_unit_code is immutable after the first inventory movement exists — create a physical-count adjustment to reconcile instead')
  END;
END;

-- ── C: allow_negative_stock column + auto-seed trigger ───────────────────────
-- The application has been querying inventory_posting_controls.allow_negative_stock
-- since migration 0071 but the column was never formally added via migration.
-- This adds it with a safe default (0 = reject negative stock) and backfills
-- any existing rows.

ALTER TABLE inventory_posting_controls ADD COLUMN allow_negative_stock INTEGER NOT NULL DEFAULT 0;

-- Ensures every company has an explicit posting-controls row the moment the
-- company record is created. Without this, the application reads NULL (which
-- also means "disallow", but makes the policy invisible and non-auditable).

CREATE TRIGGER IF NOT EXISTS trg_company_seed_posting_controls
AFTER INSERT ON companies
BEGIN
  INSERT OR IGNORE INTO inventory_posting_controls (
    company_id,
    posting_mode,
    zero_value_require_reason,
    zero_value_approval_roles,
    allow_negative_stock,
    updated_at
  ) VALUES (
    NEW.id,
    'strict_sync',
    1,
    'super_admin,company_admin,accountant,field_supervisor',
    0,   -- do NOT allow negative stock by default
    datetime('now')
  );
END;

-- ── D: sales_returns must fall within an open GL period ──────────────────────
-- A return dated in a closed period would post a GL entry to a locked period,
-- corrupting the closed financials. This guard rejects the insert early.
-- Uses financial_periods (same table getOpenPeriod() queries: is_closed = 0).
-- Only blocks if a matching closed period row exists; new companies with no
-- periods configured yet are not blocked.

CREATE TRIGGER IF NOT EXISTS trg_sales_returns_open_period
BEFORE INSERT ON sales_returns
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM financial_periods fp
      WHERE fp.company_id = NEW.company_id
        AND fp.is_closed = 1
        AND NEW.return_date BETWEEN fp.start_date AND fp.end_date
      LIMIT 1
    )
    THEN RAISE(ABORT, 'GL_PERIOD_CLOSED: return_date falls within a closed fiscal period — use the current open period date')
  END;
END;
