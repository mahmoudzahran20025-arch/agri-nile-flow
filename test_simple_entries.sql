-- ============================================================================
-- SIMPLE TEST JOURNAL ENTRIES - For Posting Engine Validation
-- ============================================================================

-- Clear any existing test entries first
DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE entry_number LIKE 'TEST-%');
DELETE FROM journal_entries WHERE entry_number LIKE 'TEST-%';

-- ============================================================================
-- Test Entry Headers Only (Lines added separately)
-- ============================================================================

-- Entry 1: Beet Purchase
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (1, '2026-04-01', 'Test: شراء تقاوي بنجر', 'TEST-001', 'supplier_invoice', 50000, 50000, 1, 1, datetime('now'));

-- Entry 2: Beet Issue to Field
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (1, '2026-04-05', 'Test: صرف تقاوي للحقل', 'TEST-002', 'inventory_movement', 25000, 25000, 1, 1, datetime('now'));

-- Entry 3: Fertilizer Purchase
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (1, '2026-04-10', 'Test: شراء أسمدة', 'TEST-003', 'supplier_invoice', 35000, 35000, 1, 1, datetime('now'));

-- Entry 4: Fuel Purchase
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (1, '2026-04-15', 'Test: شراء سولار', 'TEST-004', 'cash_transaction', 15000, 15000, 1, 1, datetime('now'));

-- Entry 5: Equipment Maintenance
INSERT INTO journal_entries (company_id, entry_date, description, entry_number, ref_type, total_debit, total_credit, is_posted, period_id, created_at)
VALUES (1, '2026-04-20', 'Test: صيانة معدات', 'TEST-005', 'supplier_invoice', 8000, 8000, 1, 1, datetime('now'));

-- ============================================================================
-- Add Journal Entry Lines
-- ============================================================================

-- Lines for Entry 1 (Beet Purchase) - Dr Inventory, Cr Suppliers
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 1, '140201', 'مخزون تقاوي بنجر', 50000, 0, '1006001' FROM journal_entries WHERE entry_number = 'TEST-001';
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 2, '22010001', 'موردين', 0, 50000, '1006001' FROM journal_entries WHERE entry_number = 'TEST-001';

-- Lines for Entry 2 (Beet Issue) - Dr COGS, Cr Inventory
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 1, '611101', 'تكلفة بنجر زراعي', 25000, 0, '1006003' FROM journal_entries WHERE entry_number = 'TEST-002';
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 2, '140201', 'مخزون', 0, 25000, '1006003' FROM journal_entries WHERE entry_number = 'TEST-002';

-- Lines for Entry 3 (Fertilizer) - Dr Inventory, Cr Suppliers
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 1, '140202', 'مخزون أسمدة', 35000, 0, '1006001' FROM journal_entries WHERE entry_number = 'TEST-003';
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 2, '22010001', 'موردين', 0, 35000, '1006001' FROM journal_entries WHERE entry_number = 'TEST-003';

-- Lines for Entry 4 (Fuel) - Dr Expense, Cr Cash
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 1, '611501', 'تكلفة وقود', 15000, 0, '1006005' FROM journal_entries WHERE entry_number = 'TEST-004';
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 2, '14010101', 'خزينة', 0, 15000, '1006005' FROM journal_entries WHERE entry_number = 'TEST-004';

-- Lines for Entry 5 (Maintenance) - Dr Expense, Cr Suppliers
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 1, '611401', 'صيانة معدات', 8000, 0, '1006002' FROM journal_entries WHERE entry_number = 'TEST-005';
INSERT INTO journal_entry_lines (entry_id, line_number, account_code, description, debit, credit, cost_center_code)
SELECT id, 2, '22010001', 'موردين', 0, 8000, '1006002' FROM journal_entries WHERE entry_number = 'TEST-005';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 'Test Entries Created' as status, COUNT(*) as count FROM journal_entries WHERE entry_number LIKE 'TEST-%';
SELECT entry_number, description, total_debit FROM journal_entries WHERE entry_number LIKE 'TEST-%' ORDER BY entry_number;
