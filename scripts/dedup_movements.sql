-- Dedup inventory_movements: keep only MIN(id) per (document_number, movement_type, item_code, warehouse, quantity, center_code, movement_date)
-- Safe: only deletes rows where a lower id with identical business key already exists

-- Step 1: unlink JEs from dup rows so FK won't block (set je back to is_posted=0 for dup JEs)
UPDATE journal_entries SET is_posted = 0
WHERE ref_type = 'inventory_movement'
  AND ref_id IN (
    SELECT id FROM inventory_movements
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM inventory_movements
      GROUP BY company_id, document_number, movement_type, item_code, warehouse, quantity, center_code, movement_date
    )
  );

-- Step 2: delete JE lines for dup movements
DELETE FROM journal_entry_lines
WHERE entry_id IN (
  SELECT id FROM journal_entries
  WHERE ref_type = 'inventory_movement'
    AND ref_id IN (
      SELECT id FROM inventory_movements
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM inventory_movements
        GROUP BY company_id, document_number, movement_type, item_code, warehouse, quantity, center_code, movement_date
      )
    )
);

-- Step 3: delete JE headers for dup movements
DELETE FROM journal_entries
WHERE ref_type = 'inventory_movement'
  AND ref_id IN (
    SELECT id FROM inventory_movements
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM inventory_movements
      GROUP BY company_id, document_number, movement_type, item_code, warehouse, quantity, center_code, movement_date
    )
  );

-- Step 4: delete outbox entries for dup movements
DELETE FROM inventory_posting_outbox
WHERE movement_id IN (
  SELECT id FROM inventory_movements
  WHERE id NOT IN (
    SELECT MIN(id)
    FROM inventory_movements
    GROUP BY company_id, document_number, movement_type, item_code, warehouse, quantity, center_code, movement_date
  )
);

-- Step 5: delete business_events for dup movements
DELETE FROM business_events
WHERE source_module = 'inventory'
  AND source_id IN (
    SELECT id FROM inventory_movements
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM inventory_movements
      GROUP BY company_id, document_number, movement_type, item_code, warehouse, quantity, center_code, movement_date
    )
  );

-- Step 6: delete the duplicate movement rows themselves
DELETE FROM inventory_movements
WHERE id NOT IN (
  SELECT MIN(id)
  FROM inventory_movements
  GROUP BY company_id, document_number, movement_type, item_code, warehouse, quantity, center_code, movement_date
);

-- Step 7: rebuild inventory_balances from deduplicated movements (snapshot from last movement per item+warehouse)
DELETE FROM inventory_balances;

INSERT INTO inventory_balances (company_id, item_code, warehouse, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
SELECT m.company_id, m.item_code, m.warehouse, m.balance_qty, m.balance_value, 0, m.id, datetime('now'), 0
FROM inventory_movements m
JOIN (
  SELECT company_id, item_code, warehouse, MAX(id) AS max_id
  FROM inventory_movements
  GROUP BY company_id, item_code, warehouse
) x ON x.max_id = m.id;
