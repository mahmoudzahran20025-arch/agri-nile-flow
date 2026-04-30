-- ============================================================================
-- TEST JOURNAL ENTRIES - Validate Posting Engine
-- ============================================================================
-- These entries simulate real agricultural operations for beet farming

-- First get the period ID
-- (We'll use a variable-like approach with a known period)

-- ============================================================================
-- TEST ENTRY 1: Beet Seeds Purchase (AGRI-OP × BEET)
-- ============================================================================
-- Step 1: Create journal entry header
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, ref_id, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (
  1, 
  '2026-04-01', 
  'شراء تقاوي بنجر جوستاف - مركز 1',
  'JE-2026-0001',
  'supplier_invoice',
  1,
  50000.00,
  50000.00,
  1,
  1,  -- Using period_id = 1 (active period)
  datetime('now')
);

-- ============================================================================
-- TEST ENTRY 2: Beet Seeds Issuance to Field (AGRI-OP × BEET)
-- ============================================================================
-- Issuing beet seeds to cost center for planting
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, ref_id, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (
  1, 
  '2026-04-05', 
  'صرف تقاوي بنجر للزراعة - مركز 3',
  'JE-2026-0002',
  'inventory_movement',
  1,
  25000.00,
  25000.00,
  1,
  (SELECT id FROM financial_periods WHERE company_id = 1 AND is_closed = 0 LIMIT 1),
  datetime('now')
);

-- Debit: COGS / Work in Progress
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, description, debit, credit, cost_center_code, product_posting_group, business_posting_group)
VALUES (
  last_insert_rowid(),
  1,
  '611101',
  'تكلفة بنجر زراعي',
  'صرف تقاوي للحقل - 50 كجم',
  25000.00,
  0.00,
  '1006003',
  'BEET',
  'AGRI-OP'
);

-- Credit: Inventory
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, description, debit, credit, cost_center_code, product_posting_group, business_posting_group)
VALUES (
  last_insert_rowid(),
  2,
  '140201',
  'مخزون مواد خام',
  'إخراج من المخزن',
  0.00,
  25000.00,
  '1006003',
  'BEET',
  'AGRI-OP'
);

-- ============================================================================
-- TEST ENTRY 3: Fertilizer Purchase (AGRI-OP × FERT)
-- ============================================================================
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, ref_id, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (
  1, 
  '2026-04-10', 
  'شراء أسمدة نيتروجينية - جميع المراكز',
  'JE-2026-0003',
  'supplier_invoice',
  2,
  35000.00,
  35000.00,
  1,
  (SELECT id FROM financial_periods WHERE company_id = 1 AND is_closed = 0 LIMIT 1),
  datetime('now')
);

-- Debit: Inventory (Fertilizers)
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, description, debit, credit, cost_center_code, product_posting_group, business_posting_group)
VALUES (
  last_insert_rowid(),
  1,
  '140202',
  'مخزون أسمدة',
  'أسمدة نيتروجينية - 1000 كجم',
  35000.00,
  0.00,
  '1006001',
  'FERT',
  'AGRI-OP'
);

-- Credit: Suppliers
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, description, debit, credit, cost_center_code, product_posting_group, business_posting_group)
VALUES (
  last_insert_rowid(),
  2,
  '22010001',
  'موردين',
  'مستحقات مورد الأسمدة',
  0.00,
  35000.00,
  '1006001',
  'FERT',
  'AGRI-OP'
);

-- ============================================================================
-- TEST ENTRY 4: Fuel Purchase for Operations (AGRI-OP × FUEL)
-- ============================================================================
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, ref_id, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (
  1, 
  '2026-04-15', 
  'شراء سولار للمعدات الزراعية',
  'JE-2026-0004',
  'cash_transaction',
  1,
  15000.00,
  15000.00,
  1,
  (SELECT id FROM financial_periods WHERE company_id = 1 AND is_closed = 0 LIMIT 1),
  datetime('now')
);

-- Debit: Fuel Expense
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, description, debit, credit, cost_center_code, product_posting_group, business_posting_group)
VALUES (
  last_insert_rowid(),
  1,
  '611501',
  'تكلفة وقود زراعي',
  'سولار للآلات - 5000 لتر',
  15000.00,
  0.00,
  '1006005',
  'FUEL',
  'AGRI-OP'
);

-- Credit: Cash/Bank
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, description, debit, credit, cost_center_code, product_posting_group, business_posting_group)
VALUES (
  last_insert_rowid(),
  2,
  '14010101',
  'خزينة ج.م',
  'دفع نقدي',
  0.00,
  15000.00,
  '1006005',
  'FUEL',
  'AGRI-OP'
);

-- ============================================================================
-- TEST ENTRY 5: Equipment Maintenance (AGRI-OP × EQUIP)
-- ============================================================================
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, ref_id, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (
  1, 
  '2026-04-20', 
  'صيانة دورية للجرارات الزراعية',
  'JE-2026-0005',
  'supplier_invoice',
  3,
  8000.00,
  8000.00,
  1,
  (SELECT id FROM financial_periods WHERE company_id = 1 AND is_closed = 0 LIMIT 1),
  datetime('now')
);

-- Debit: Equipment Maintenance Expense
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, description, debit, credit, cost_center_code, product_posting_group, business_posting_group)
VALUES (
  last_insert_rowid(),
  1,
  '611401',
  'تكلفة معدات زراعية',
  'صيانة جرارات',
  8000.00,
  0.00,
  '1006002',
  'EQUIP',
  'AGRI-OP'
);

-- Credit: Suppliers
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, account_name, description, debit, credit, cost_center_code, product_posting_group, business_posting_group)
VALUES (
  last_insert_rowid(),
  2,
  '22010001',
  'موردين',
  'مستحقات شركة الصيانة',
  0.00,
  8000.00,
  '1006002',
  'EQUIP',
  'AGRI-OP'
);

-- ============================================================================
-- VERIFICATION: Show created entries
-- ============================================================================
SELECT 'Test journal entries created' as status, COUNT(*) as count FROM journal_entries WHERE company_id = 1 AND entry_number LIKE 'JE-2026-%';
