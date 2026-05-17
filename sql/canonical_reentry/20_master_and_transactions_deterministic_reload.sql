-- Phase 3 deterministic canonical reload from backup tables
-- Source of truth: supplier_tx_bak, cash_tx_bak, inventory_bak
-- Company scope: company_id = 1


-- ------------------------------------------------------------------
-- 0) Canonical supplier master seed from backup activity
-- ------------------------------------------------------------------
INSERT OR IGNORE INTO suppliers (code, company_id, name, activity, notes, is_active)
SELECT
  src.supplier_code,
  1,
  'SUP-' || CAST(src.supplier_code AS TEXT),
  'UNCLASSIFIED',
  'Auto-seeded from backup source tables',
  1
FROM (
  SELECT DISTINCT supplier_code FROM supplier_tx_bak WHERE company_id = 1 AND supplier_code IS NOT NULL
  UNION
  SELECT DISTINCT supplier_code FROM cash_tx_bak WHERE company_id = 1 AND supplier_code IS NOT NULL
  UNION
  SELECT DISTINCT supplier_code FROM inventory_bak WHERE company_id = 1 AND supplier_code IS NOT NULL
) src;

-- Deterministic canonical names/activities for known suppliers.
UPDATE suppliers
SET
  name = CASE code
    WHEN 20100033 THEN 'عمرو السمالوسي - لودر'
    WHEN 20300086 THEN 'عيد شعبان - لودر'
    WHEN 20300121 THEN 'ميكنة احمد عبيد'
    WHEN 21400002 THEN 'احمد دسوقي - عمالة'
    WHEN 21400108 THEN 'ابراهيم رمضان الكيلاوي'
    WHEN 20900353 THEN 'شركة عرفة للتصدير والتنمية الزراعية'
    WHEN 20900151 THEN 'جهاز مستقبل مصر للتنمية المستدامة'
    WHEN 20800286 THEN 'مورد نقدي'
    ELSE name
  END,
  activity = CASE code
    WHEN 20100033 THEN 'SRV_MECH'
    WHEN 20300086 THEN 'SRV_MECH'
    WHEN 20300121 THEN 'SRV_MECH'
    WHEN 21400002 THEN 'SRV_LABOR'
    WHEN 21400108 THEN 'SRV_LABOR'
    WHEN 20900353 THEN 'SRV_SUPPLY'
    WHEN 20900151 THEN 'SRV_ADMIN'
    WHEN 20800286 THEN 'SRV_SPARE_PARTS'
    ELSE activity
  END
WHERE company_id = 1;

-- ------------------------------------------------------------------
-- 1) Clean operational target tables for deterministic replay
-- ------------------------------------------------------------------
DELETE FROM supplier_transactions WHERE company_id = 1;
DELETE FROM cash_transactions WHERE company_id = 1;
DELETE FROM inventory_movements WHERE company_id = 1;
DELETE FROM business_events WHERE company_id = 1;
UPDATE journal_entries SET is_posted = 0 WHERE company_id = 1;
DELETE FROM journal_entry_lines WHERE company_id = 1;
DELETE FROM journal_entries WHERE company_id = 1;

-- ------------------------------------------------------------------
-- 2) Reload supplier_transactions in canonical form
-- ------------------------------------------------------------------
INSERT INTO supplier_transactions (
  company_id, season_id, supplier_code, account_code, center_code, sub_code,
  transaction_date, entry_type, document_type, document_number,
  expense_category, equipment, amount, credit, debit, check_amount,
  due_date, balance_no_checks, balance_with_checks,
  year, month, notes, created_by_user_id,
  status, journal_entry_id, financial_account_id,
  service_type_code
)
SELECT
  s.company_id,
  s.season_id,
  s.supplier_code,
  s.account_code,
  s.center_code,
  s.sub_code,
  s.transaction_date,
  COALESCE(NULLIF(TRIM(s.entry_type), ''), CASE WHEN COALESCE(s.credit, 0) > COALESCE(s.debit, 0) THEN 'د' ELSE 'م' END),
  COALESCE(NULLIF(TRIM(s.document_type), ''), 'Legacy'),
  s.document_number,
  s.expense_category,
  s.equipment,
  COALESCE(s.amount, COALESCE(s.credit, 0) + COALESCE(s.debit, 0), 0),
  COALESCE(s.credit, 0),
  COALESCE(s.debit, 0),
  COALESCE(s.check_amount, 0),
  s.due_date,
  0,
  0,
  COALESCE(s.year, CAST(strftime('%Y', s.transaction_date) AS INTEGER)),
  COALESCE(s.month, CAST(strftime('%m', s.transaction_date) AS INTEGER)),
  COALESCE(NULLIF(TRIM(s.notes), ''), 'Supplier transaction migrated from backup #' || CAST(s.id AS TEXT)),
  COALESCE(s.created_by_user_id, 1),
  'posted',
  NULL,
  s.financial_account_id,
  COALESCE(
    NULLIF(TRIM(s.expense_category), ''),
    CASE
      WHEN s.supplier_code IN (20100033, 20300086, 20300121) THEN 'SRV_MECH'
      WHEN s.supplier_code IN (21400002, 21400108) THEN 'SRV_LABOR'
      WHEN s.supplier_code = 20800286 THEN 'SRV_SPARE_PARTS'
      WHEN s.supplier_code = 20900151 THEN 'SRV_ADMIN'
      WHEN s.supplier_code = 20900353
           AND (
             COALESCE(s.notes, '') LIKE '%اشراف%'
             OR COALESCE(s.notes, '') LIKE '%إشراف%'
             OR COALESCE(s.document_type, '') LIKE '%خدمات%'
           ) THEN 'SRV_SUPERVISION'
      WHEN s.supplier_code = 20900353 THEN 'SRV_SUPPLY'
      ELSE 'SRV_ADMIN'
    END
  )
FROM supplier_tx_bak s
WHERE s.company_id = 1;

-- ------------------------------------------------------------------
-- 3) Reload cash_transactions in canonical form
-- ------------------------------------------------------------------
INSERT INTO cash_transactions (
  company_id, season_id, supplier_code, center_code, expense_code, sub_code,
  transaction_date, direction, document_number, recipient_name, narration,
  amount, debit, credit, running_balance,
  year, month, notes, created_by_user_id,
  status, journal_entry_id, document_type, field_id, financial_account_id, partner_id
)
SELECT
  c.company_id,
  c.season_id,
  c.supplier_code,
  c.center_code,
  c.expense_code,
  c.sub_code,
  c.transaction_date,
  COALESCE(NULLIF(TRIM(c.direction), ''), CASE WHEN COALESCE(c.credit, 0) > COALESCE(c.debit, 0) THEN 'د' ELSE 'م' END),
  c.document_number,
  c.recipient_name,
  COALESCE(NULLIF(TRIM(c.narration), ''), 'Cash transaction migrated from backup #' || CAST(c.id AS TEXT)),
  COALESCE(c.amount, COALESCE(c.credit, 0) + COALESCE(c.debit, 0), 0),
  COALESCE(c.debit, 0),
  COALESCE(c.credit, 0),
  NULL,
  COALESCE(c.year, CAST(strftime('%Y', c.transaction_date) AS INTEGER)),
  COALESCE(c.month, CAST(strftime('%m', c.transaction_date) AS INTEGER)),
  COALESCE(NULLIF(TRIM(c.notes), ''), 'Cash transaction migrated from backup #' || CAST(c.id AS TEXT)),
  COALESCE(c.created_by_user_id, 1),
  'posted',
  NULL,
  COALESCE(NULLIF(TRIM(c.document_type), ''), 'Legacy'),
  c.field_id,
  c.financial_account_id,
  c.partner_id
FROM cash_tx_bak c
WHERE c.company_id = 1;

-- ------------------------------------------------------------------
-- 4) Reload inventory_movements in canonical form
-- ------------------------------------------------------------------
INSERT INTO inventory_movements (
  company_id, season_id, supplier_code, item_code, center_code, account_code, sub_code,
  movement_date, warehouse, movement_type,
  document_number, invoice_number, po_number,
  package_type, pack_capacity, pack_count,
  quantity, unit_price, qty_in, qty_out, balance_qty,
  value_in, value_out, balance_value,
  year, month, notes, field_id, work_order_id, work_task_id,
  purchase_delivery_id, sales_delivery_id,
  created_by_user_id, status, journal_entry_id,
  warehouse_id, dest_warehouse_id, related_movement_id,
  zero_value_reason, zero_value_approved_by_role, posting_mode,
  gl_posting_status, gl_posting_error, gl_posted_at,
  transaction_id, statement_text, service_type_code
)
SELECT
  i.company_id,
  i.season_id,
  i.supplier_code,
  i.item_code,
  i.center_code,
  i.account_code,
  i.sub_code,
  i.movement_date,
  i.warehouse,
  COALESCE(NULLIF(TRIM(i.movement_type), ''), CASE WHEN COALESCE(i.qty_in, 0) > 0 THEN 'GRN' ELSE 'ISSUE' END),
  i.document_number,
  i.invoice_number,
  i.po_number,
  i.package_type,
  i.pack_capacity,
  i.pack_count,
  COALESCE(i.quantity, 0),
  COALESCE(i.unit_price, 0),
  COALESCE(i.qty_in, 0),
  COALESCE(i.qty_out, 0),
  i.balance_qty,
  COALESCE(i.value_in, 0),
  COALESCE(i.value_out, 0),
  i.balance_value,
  COALESCE(i.year, CAST(strftime('%Y', i.movement_date) AS INTEGER)),
  COALESCE(i.month, CAST(strftime('%m', i.movement_date) AS INTEGER)),
  COALESCE(NULLIF(TRIM(i.notes), ''), 'Inventory movement migrated from backup #' || CAST(i.id AS TEXT)),
  i.field_id,
  i.work_order_id,
  i.work_task_id,
  i.purchase_delivery_id,
  i.sales_delivery_id,
  COALESCE(i.created_by_user_id, 1),
  COALESCE(NULLIF(TRIM(i.status), ''), 'posted'),
  NULL,
  i.warehouse_id,
  i.dest_warehouse_id,
  i.related_movement_id,
  i.zero_value_reason,
  i.zero_value_approved_by_role,
  COALESCE(i.posting_mode, 'normal'),
  'pending',
  NULL,
  NULL,
  i.transaction_id,
  COALESCE(NULLIF(TRIM(i.notes), ''), 'Inventory movement migrated from backup #' || CAST(i.id AS TEXT)),
  CASE
    WHEN COALESCE(NULLIF(TRIM(i.movement_type), ''), '') = 'ISSUE' THEN 'SRV_SUPPLY'
    WHEN i.supplier_code = 20900353 THEN 'SRV_SUPPLY'
    WHEN i.supplier_code = 20800286 THEN 'SRV_SPARE_PARTS'
    ELSE NULL
  END
FROM inventory_bak i
WHERE i.company_id = 1;

-- COMMIT removed (D1 file execution is atomic by default)

-- Quick post-load metrics
SELECT 'suppliers_loaded' AS metric, COUNT(*) AS cnt FROM suppliers WHERE company_id = 1;
SELECT 'supplier_transactions_loaded' AS metric, COUNT(*) AS cnt FROM supplier_transactions WHERE company_id = 1;
SELECT 'cash_transactions_loaded' AS metric, COUNT(*) AS cnt FROM cash_transactions WHERE company_id = 1;
SELECT 'inventory_movements_loaded' AS metric, COUNT(*) AS cnt FROM inventory_movements WHERE company_id = 1;
