-- =============================================================
-- Backfill operational balances + safe inventory transaction links
-- Date: 2026-05-09
-- Scope: company_id = 1
-- Safety:
--   - Idempotent: recomputes deterministic balances from source rows
--   - Inventory linking only for UNIQUE exact aggregate matches
--   - Leaves ambiguous historical inventory headers untouched
-- =============================================================

-- -------------------------------------------------------------
-- 1) Supplier running balances
-- -------------------------------------------------------------
WITH supplier_recalc AS (
  SELECT
    id,
    ROUND(
      SUM(COALESCE(credit, 0) - COALESCE(debit, 0)) OVER (
        PARTITION BY company_id, supplier_code
        ORDER BY transaction_date ASC, id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ),
      2
    ) AS balance_no_checks,
    ROUND(
      SUM(COALESCE(credit, 0) - COALESCE(debit, 0) + COALESCE(check_amount, 0)) OVER (
        PARTITION BY company_id, supplier_code
        ORDER BY transaction_date ASC, id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ),
      2
    ) AS balance_with_checks
  FROM supplier_transactions
  WHERE company_id = 1
)
UPDATE supplier_transactions
SET balance_no_checks = (
      SELECT sr.balance_no_checks
      FROM supplier_recalc sr
      WHERE sr.id = supplier_transactions.id
    ),
    balance_with_checks = (
      SELECT sr.balance_with_checks
      FROM supplier_recalc sr
      WHERE sr.id = supplier_transactions.id
    )
WHERE company_id = 1;

-- -------------------------------------------------------------
-- 2) Treasury running balance
--    Posted rows only, partitioned by financial account when present.
-- -------------------------------------------------------------
WITH cash_recalc AS (
  SELECT
    id,
    CASE
      WHEN status = 'posted' THEN ROUND(
        SUM(
          CASE
            WHEN direction = 'د' THEN COALESCE(amount, 0)
            WHEN direction = 'م' THEN -COALESCE(amount, 0)
            ELSE 0
          END
        ) OVER (
          PARTITION BY company_id, COALESCE(financial_account_id, -1)
          ORDER BY transaction_date ASC, id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ),
        2
      )
      ELSE NULL
    END AS running_balance
  FROM cash_transactions
  WHERE company_id = 1
)
UPDATE cash_transactions
SET running_balance = (
      SELECT cr.running_balance
      FROM cash_recalc cr
      WHERE cr.id = cash_transactions.id
    )
WHERE company_id = 1;

-- -------------------------------------------------------------
-- 3) Historical inventory link backfill
--    Link only exact UNIQUE aggregate matches:
--      (date, warehouse, type, line_count, total_qty, total_value)
-- -------------------------------------------------------------
WITH unique_header_signatures AS (
  SELECT
    MIN(id) AS transaction_id,
    company_id,
    movement_date,
    warehouse,
    transaction_type,
    line_count,
    ROUND(COALESCE(total_qty, 0), 2) AS total_qty,
    ROUND(COALESCE(total_value, 0), 2) AS total_value
  FROM inventory_transactions
  WHERE company_id = 1
  GROUP BY
    company_id,
    movement_date,
    warehouse,
    transaction_type,
    line_count,
    ROUND(COALESCE(total_qty, 0), 2),
    ROUND(COALESCE(total_value, 0), 2)
  HAVING COUNT(*) = 1
),
movement_group_signatures AS (
  SELECT
    company_id,
    movement_date,
    warehouse,
    CASE
      WHEN movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER'
      ELSE movement_type
    END AS transaction_type,
    COUNT(*) AS line_count,
    ROUND(COALESCE(SUM(quantity), 0), 2) AS total_qty,
    ROUND(COALESCE(SUM(value_in + value_out), 0), 2) AS total_value
  FROM inventory_movements
  WHERE company_id = 1
    AND transaction_id IS NULL
  GROUP BY
    company_id,
    movement_date,
    warehouse,
    CASE
      WHEN movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER'
      ELSE movement_type
    END
),
exact_unique_matches AS (
  SELECT
    uhs.transaction_id,
    mgs.company_id,
    mgs.movement_date,
    mgs.warehouse,
    mgs.transaction_type,
    mgs.line_count,
    mgs.total_qty,
    mgs.total_value
  FROM movement_group_signatures mgs
  JOIN unique_header_signatures uhs
    ON uhs.company_id = mgs.company_id
   AND uhs.movement_date = mgs.movement_date
   AND uhs.warehouse = mgs.warehouse
   AND uhs.transaction_type = mgs.transaction_type
   AND uhs.line_count = mgs.line_count
   AND uhs.total_qty = mgs.total_qty
   AND uhs.total_value = mgs.total_value
)
UPDATE inventory_movements
SET transaction_id = (
      SELECT eum.transaction_id
      FROM exact_unique_matches eum
      WHERE eum.company_id = inventory_movements.company_id
        AND eum.movement_date = inventory_movements.movement_date
        AND eum.warehouse = inventory_movements.warehouse
        AND eum.transaction_type = CASE
          WHEN inventory_movements.movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER'
          ELSE inventory_movements.movement_type
        END
    )
WHERE company_id = 1
  AND transaction_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM exact_unique_matches eum
    WHERE eum.company_id = inventory_movements.company_id
      AND eum.movement_date = inventory_movements.movement_date
      AND eum.warehouse = inventory_movements.warehouse
      AND eum.transaction_type = CASE
        WHEN inventory_movements.movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER'
        ELSE inventory_movements.movement_type
      END
  );
