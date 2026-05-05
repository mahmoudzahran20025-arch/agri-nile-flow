-- 1) Allow deleting posted JEs tied to the cutoff scope.
UPDATE journal_entries
SET is_posted = 0
WHERE (
  ref_type = 'inventory_movement'
  AND ref_id IN (
    SELECT id FROM inventory_movements WHERE movement_date > '2026-04-24'
  )
) OR (
  ref_type = 'business_event'
  AND ref_id IN (
    SELECT id
    FROM business_events
    WHERE source_module = 'inventory'
      AND source_id IN (
        SELECT id FROM inventory_movements WHERE movement_date > '2026-04-24'
      )
  )
);

-- 2) Delete JE lines first, then JE headers.
DELETE FROM journal_entry_lines
WHERE entry_id IN (
  SELECT id FROM journal_entries
  WHERE (
    ref_type = 'inventory_movement'
    AND ref_id IN (
      SELECT id FROM inventory_movements WHERE movement_date > '2026-04-24'
    )
  ) OR (
    ref_type = 'business_event'
    AND ref_id IN (
      SELECT id
      FROM business_events
      WHERE source_module = 'inventory'
        AND source_id IN (
          SELECT id FROM inventory_movements WHERE movement_date > '2026-04-24'
        )
    )
  )
);

DELETE FROM journal_entries
WHERE (
  ref_type = 'inventory_movement'
  AND ref_id IN (
    SELECT id FROM inventory_movements WHERE movement_date > '2026-04-24'
  )
) OR (
  ref_type = 'business_event'
  AND ref_id IN (
    SELECT id
    FROM business_events
    WHERE source_module = 'inventory'
      AND source_id IN (
        SELECT id FROM inventory_movements WHERE movement_date > '2026-04-24'
      )
  )
);

-- 3) Delete posting queue and event artifacts for the same scope.
DELETE FROM inventory_posting_outbox
WHERE movement_id IN (
  SELECT id FROM inventory_movements WHERE movement_date > '2026-04-24'
);

DELETE FROM business_events
WHERE source_module = 'inventory'
  AND source_id IN (
    SELECT id FROM inventory_movements WHERE movement_date > '2026-04-24'
  );

-- 4) Delete future-dated inventory movement facts and headers.
DELETE FROM inventory_movements
WHERE movement_date > '2026-04-24';

DELETE FROM inventory_transactions
WHERE movement_date > '2026-04-24';

-- 5) Rebuild balances from remaining latest movement snapshots.
DELETE FROM inventory_balances;

INSERT INTO inventory_balances (
  company_id,
  item_code,
  warehouse,
  balance_qty,
  balance_value,
  version,
  last_movement_id,
  last_updated,
  is_stale
)
SELECT
  m.company_id,
  m.item_code,
  m.warehouse,
  m.balance_qty,
  m.balance_value,
  0,
  m.id,
  datetime('now'),
  0
FROM inventory_movements m
JOIN (
  SELECT company_id, item_code, warehouse, MAX(id) AS max_id
  FROM inventory_movements
  GROUP BY company_id, item_code, warehouse
) x ON x.max_id = m.id;
