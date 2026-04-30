-- ============================================================================
-- TEST JOURNAL ENTRIES - Matching Actual Schema
-- ============================================================================

-- Clear any existing test entries first
DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE entry_number LIKE 'TEST-%');
DELETE FROM journal_entries WHERE entry_number LIKE 'TEST-%';

-- ============================================================================
-- Test Entry Headers (without total_debit/total_credit columns)
-- ============================================================================

-- Entry 1: Beet Purchase
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_at)
VALUES (1, 1, 'TEST-001', '2026-04-01', 'Test: شراء تقاوي بنجر', 'supplier_invoice', 1, 1, datetime('now'));

-- Entry 2: Beet Issue to Field
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_at)
VALUES (1, 1, 'TEST-002', '2026-04-05', 'Test: صرف تقاوي للحقل', 'inventory_movement', 1, 1, datetime('now'));

-- Entry 3: Fertilizer Purchase
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_at)
VALUES (1, 1, 'TEST-003', '2026-04-10', 'Test: شراء أسمدة', 'supplier_invoice', 1, 1, datetime('now'));

-- Entry 4: Fuel Purchase
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_at)
VALUES (1, 1, 'TEST-004', '2026-04-15', 'Test: شراء سولار', 'cash_transaction', 1, 1, datetime('now'));

-- Entry 5: Equipment Maintenance
INSERT INTO journal_entries (company_id, period_id, entry_number, entry_date, description, ref_type, ref_id, is_posted, created_at)
VALUES (1, 1, 'TEST-005', '2026-04-20', 'Test: صيانة معدات', 'supplier_invoice', 1, 1, datetime('now'));

-- ============================================================================
-- Add Journal Entry Lines (using correct column names: center_code)
-- ============================================================================

-- Lines for Entry 1 (Beet Purchase) - Dr Inventory, Cr Suppliers
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '140201', 'مخزون تقاوي بنجر', 50000, 0, '1006001', 1 FROM journal_entries WHERE entry_number = 'TEST-001';
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '22010001', 'موردين', 0, 50000, '1006001', 1 FROM journal_entries WHERE entry_number = 'TEST-001';

-- Lines for Entry 2 (Beet Issue) - Dr COGS, Cr Inventory
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '611101', 'تكلفة بنجر زراعي', 25000, 0, '1006003', 1 FROM journal_entries WHERE entry_number = 'TEST-002';
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '140201', 'مخزون', 0, 25000, '1006003', 1 FROM journal_entries WHERE entry_number = 'TEST-002';

-- Lines for Entry 3 (Fertilizer) - Dr Inventory, Cr Suppliers
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '140202', 'مخزون أسمدة', 35000, 0, '1006001', 1 FROM journal_entries WHERE entry_number = 'TEST-003';
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '22010001', 'موردين', 0, 35000, '1006001', 1 FROM journal_entries WHERE entry_number = 'TEST-003';

-- Lines for Entry 4 (Fuel) - Dr Expense, Cr Cash
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '611501', 'تكلفة وقود', 15000, 0, '1006005', 1 FROM journal_entries WHERE entry_number = 'TEST-004';
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '14010101', 'خزينة', 0, 15000, '1006005', 1 FROM journal_entries WHERE entry_number = 'TEST-004';

-- Lines for Entry 5 (Maintenance) - Dr Expense, Cr Suppliers
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '611401', 'صيانة معدات', 8000, 0, '1006002', 1 FROM journal_entries WHERE entry_number = 'TEST-005';
INSERT INTO journal_entry_lines (entry_id, company_id, account_code, description, debit, credit, center_code, season_id)
SELECT id, 1, '22010001', 'موردين', 0, 8000, '1006002', 1 FROM journal_entries WHERE entry_number = 'TEST-005';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 'Test Entries Created' as status, COUNT(*) as count FROM journal_entries WHERE entry_number LIKE 'TEST-%';
