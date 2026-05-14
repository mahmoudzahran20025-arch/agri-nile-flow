-- 1. Clear current stock quants
DELETE FROM stock_quants WHERE company_id = 1;

-- 2. Recalculate and Insert fresh quants from movements
INSERT INTO stock_quants (company_id, warehouse_id, item_code, quantity, value, last_updated)
SELECT 
  company_id, 
  warehouse_id, 
  item_code, 
  SUM(CASE WHEN movement_type = 'GRN' THEN quantity ELSE -quantity END) as quantity,
  SUM(CASE WHEN movement_type = 'GRN' THEN value_in ELSE -value_out END) as value,
  datetime('now')
FROM inventory_movements
WHERE company_id = 1
GROUP BY company_id, warehouse_id, item_code;

-- 3. Verify
SELECT COUNT(*) as active_quants, SUM(quantity) as total_physical_qty, SUM(value) as total_book_value
FROM stock_quants
WHERE company_id = 1;
