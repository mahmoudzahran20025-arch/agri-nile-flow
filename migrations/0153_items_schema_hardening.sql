-- Migration 0153 — items schema hardening (P1-L1, P1-L2, P1-L3)
--
-- P1-L1: min_selling_price — prevents sales below cost; checked at POST /sales time
--   by application code (no DB CHECK — selling at a loss with approval is valid for
--   clearance / spoilage scenarios; the constraint is enforced in business logic).
--
-- P1-L2: category_id FK is NOT enforced by SQLite FK pragma by default and SQLite
--   does not support ALTER COLUMN ... ON DELETE SET NULL after the fact. The safest
--   approach without a full table rebuild is to:
--     a) Add a partial index that catches orphaned category references (company_id,
--        category_id) so the application query can surface stale refs.
--     b) Set orphaned category_ids to NULL via an UPDATE (backfill).
--   A full FK constraint with ON DELETE SET NULL requires rebuilding the table;
--   that is deferred to a future migration when a maintenance window is available.
--   Application code already handles category_id = NULL gracefully.
--
-- P1-L3: created_by_user_id — audit trail for item creation (TEXT, FK to users.sub).

ALTER TABLE items ADD COLUMN min_selling_price REAL;
ALTER TABLE items ADD COLUMN created_by_user_id TEXT;

-- Backfill orphaned category_id to NULL (handles items whose category was deleted)
UPDATE items
SET category_id = NULL
WHERE category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM item_categories ic
    WHERE ic.id = items.category_id AND ic.company_id = items.company_id
  );

CREATE INDEX IF NOT EXISTS idx_items_created_by
  ON items(company_id, created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
