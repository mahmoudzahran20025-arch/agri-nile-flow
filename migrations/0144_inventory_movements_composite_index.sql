-- Composite covering index for the most common inventory query pattern:
-- list by company + warehouse + item filtered by date range.
-- Also covers the balance-rebuild scan (company_id, item_code, warehouse_id ORDER BY movement_date).
-- Also covers the backdating propagation UPDATE:
--   UPDATE inventory_movements SET running_balance = ?
--   WHERE company_id = ? AND item_code = ? AND warehouse_id = ? AND movement_date >= ?
-- The (company_id, item_code, warehouse_id, movement_date) prefix matches this filter exactly.
CREATE INDEX IF NOT EXISTS idx_inv_movements_company_item_wh_date
  ON inventory_movements(company_id, item_code, warehouse_id, movement_date);

-- Secondary index for the GL-trace / outbox processor scan (company + posting status).
CREATE INDEX IF NOT EXISTS idx_inv_movements_company_gl_status
  ON inventory_movements(company_id, gl_posting_status)
  WHERE gl_posting_status NOT IN ('posted', 'exempt_zero_value');
