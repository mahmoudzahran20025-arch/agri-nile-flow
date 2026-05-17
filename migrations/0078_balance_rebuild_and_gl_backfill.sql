-- ============================================================
-- 0078: Balance Rebuild & GL Backfill — Phase 2
-- ============================================================
-- Step 1: Rebuild inventory_balances from ledger SUM
-- Step 2: Backfill journal_entry_id on ghost-posted movements
-- Step 3: Downgrade residual ghosts to 'failed', enqueue outbox
-- Step 4: Seed opening balances from JSON source
-- ============================================================

-- ── Step 1: Full balance rebuild from movement ledger ──────
-- Delete stale/wrong snapshots, rebuild from authoritative SUM.
-- Preserves all movements (NO DELETE on movements table).
DELETE FROM inventory_balances WHERE company_id = 1;

INSERT INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
SELECT
  company_id,
  item_code,
  warehouse,
  COALESCE(SUM(qty_in)  - SUM(qty_out),  0) AS balance_qty,
  COALESCE(SUM(value_in) - SUM(value_out), 0) AS balance_value,
  1 AS version,
  MAX(id) AS last_movement_id,
  datetime('now') AS last_updated,
  0 AS is_stale
FROM inventory_movements
WHERE company_id = 1
GROUP BY company_id, item_code, warehouse
HAVING balance_qty > 0 OR balance_value > 0;

-- ── Step 2: Backfill journal_entry_id for ghost-posted movements ──
-- These movements have gl_posting_status = 'posted' but journal_entry_id IS NULL.
-- Match via journal_entries.source_id = movement.id and event_type.
UPDATE inventory_movements
SET journal_entry_id = (
  SELECT be.journal_entry_id
  FROM business_events be
  WHERE be.company_id = inventory_movements.company_id
    AND be.source_id  = inventory_movements.id
    AND be.event_type IN ('inventory_movement', 'inventory_transfer')
    AND be.journal_entry_id IS NOT NULL
  ORDER BY be.id DESC
  LIMIT 1
)
WHERE company_id = 1
  AND gl_posting_status = 'posted'
  AND journal_entry_id IS NULL;

-- ── Step 3: Enqueue ghost-posted movements for GL re-verification ──
-- Movements still showing 'posted' with no journal_entry_id after backfill
-- are suspicious. Enqueue them so the outbox worker can verify and
-- write back the correct journal_entry_id (or mark truly failed).
-- We do NOT downgrade the status here — the GL guard trigger prevents it
-- and these movements may have a valid GL entry not yet linked.
INSERT OR IGNORE INTO inventory_posting_outbox
  (company_id, event_type, movement_id, payload_json, status, attempts, idempotency_key, updated_at)
SELECT
  m.company_id,
  CASE
    WHEN m.movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'inventory_transfer'
    ELSE 'inventory_movement'
  END AS event_type,
  m.id AS movement_id,
  json_object(
    'company_id',     m.company_id,
    'ref_id',         m.id,
    'item_code',      m.item_code,
    'warehouse',      m.warehouse,
    'movement_type',  m.movement_type,
    'value',          m.value_in - m.value_out,
    'date',           m.movement_date,
    'item_name',      COALESCE(i.name, 'unknown')
  ) AS payload_json,
  'pending' AS status,
  0 AS attempts,
  'inventory_movement:' || m.id AS idempotency_key,
  datetime('now') AS updated_at
FROM inventory_movements m
LEFT JOIN items i ON i.company_id = m.company_id AND i.code = m.item_code
WHERE m.company_id = 1
  AND m.gl_posting_status = 'posted'
  AND m.journal_entry_id IS NULL;

-- ── Step 4: Seed opening balances from JSON source ─────────
-- Only for items with no existing balance row (INSERT OR IGNORE).
-- These 29 rows represent confirmed stock on-hand from the master sheet.
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010002, 'اسمدة', 6225, 301725, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010006, 'اسمدة', 11584, 191136, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010060, 'اسمدة', 1425, 99750, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010074, 'اسمدة', 102200, 2146200, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010095, 'اسمدة', 5000, 105000, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010189, 'اسمدة', 225, 29250, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010132, 'اسمدة', 50, 850, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010374, 'اسمدة', 525, 29375, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010439, 'اسمدة', 1125, 157500, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010437, 'اسمدة', 14.5, 17400, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010449, 'اسمدة', 800, 208000, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1010327, 'اسمدة', 500, 165000, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1050092, 'شبكات ري', 1, 4750, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1050095, 'شبكات ري', 9, 104, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1050316, 'شبكات ري', 5, 315, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1050197, 'شبكات ري', 2, 130, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1050401, 'شبكات ري', 2, 50, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1050364, 'شبكات ري', 2, 30, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1050149, 'شبكات ري', 4, 100, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1070010, 'قطع غيار', 60, 660, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1070317, 'قطع غيار', 1, 50, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1070844, 'قطع غيار', 12, 240, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1020361, 'مبيدات', 200, 11000, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1020259, 'مبيدات', 1780, 12460, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1020393, 'مبيدات', 60, 10200, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1020401, 'مبيدات', 75, 30000, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1090043, 'متنوعات', 10, 650, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1090168, 'متنوعات', 1, 80, 1, NULL, datetime('now'), 0);
INSERT OR IGNORE INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
  VALUES (1, 1080035, 'تعبئة وتغليف', 1, 150, 1, NULL, datetime('now'), 0);
