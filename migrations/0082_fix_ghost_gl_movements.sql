-- =============================================================================
-- Migration 0082: Fix Ghost-GL Movements
-- Date: 2026-05-04
-- =============================================================================
-- 58 movements have gl_posting_status='posted' but journal_entry_id IS NULL.
-- These were set 'posted' by a backfill/migration script that did not create
-- GL entries. The outbox worker skips them (sees 'posted', marks outbox done).
--
-- Fix:
--   1. For every such movement that has a matching outbox row (status='done'),
--      flip the outbox row back to 'pending' so the worker retries it.
--   2. Reset the movement itself to 'outbox_pending' so the pre-flight guard
--      in process_outbox.ts no longer skips it.
--   3. For movements that have NO outbox row at all, insert one.
-- =============================================================================

-- Step 1: Reset outbox rows that were closed prematurely for these movements.
UPDATE inventory_posting_outbox
SET status      = 'pending',
    attempts    = 0,
    last_error  = 'reset by 0082: movement had posted status but no journal_entry_id',
    updated_at  = datetime('now')
WHERE movement_id IN (
  SELECT id FROM inventory_movements
  WHERE journal_entry_id IS NULL
    AND gl_posting_status = 'posted'
    AND (zero_value_reason IS NULL OR zero_value_reason = '')
)
AND status IN ('done', 'failed');

-- Step 2: Reset the movements themselves to outbox_pending.
UPDATE inventory_movements
SET gl_posting_status = 'outbox_pending',
    gl_posting_error  = 'reset by 0082: was posted without journal_entry_id'
WHERE journal_entry_id IS NULL
  AND gl_posting_status = 'posted'
  AND (zero_value_reason IS NULL OR zero_value_reason = '');

-- Step 3: Insert outbox rows for ghost movements that have no outbox row at all.
INSERT OR IGNORE INTO inventory_posting_outbox
  (company_id, event_type, movement_id, idempotency_key, payload_json, status, attempts, created_at, updated_at)
SELECT
  im.company_id,
  'inventory_movement',
  im.id,
  'movement:' || im.id,
  json_object(
    'company_id',    im.company_id,
    'ref_id',        im.id,
    'item_code',     im.item_code,
    'warehouse',     im.warehouse,
    'movement_type', im.movement_type,
    'value',         CASE WHEN im.qty_in > 0 THEN im.value_in ELSE im.value_out END,
    'date',          im.movement_date,
    'item_name',     COALESCE(i.name, CAST(im.item_code AS TEXT)),
    'created_by',    im.created_by_user_id
  ),
  'pending',
  0,
  datetime('now'),
  datetime('now')
FROM inventory_movements im
LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
LEFT JOIN inventory_posting_outbox ipo ON ipo.movement_id = im.id
WHERE im.journal_entry_id IS NULL
  AND im.gl_posting_status = 'outbox_pending'
  AND ipo.id IS NULL
  AND (im.zero_value_reason IS NULL OR im.zero_value_reason = '');

-- =============================================================================
-- Verification query (run after applying):
-- SELECT COUNT(*) FROM inventory_movements
-- WHERE journal_entry_id IS NULL AND gl_posting_status = 'posted'
--   AND (zero_value_reason IS NULL OR zero_value_reason = '');
-- Should return 0.
-- =============================================================================
