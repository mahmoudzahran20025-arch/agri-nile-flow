-- ============================================================================
-- PHASE 1B: CREATE MISSING ACCOUNTS WITH NORMAL_BALANCE
-- ============================================================================

-- COGS Accounts (debit normal balance)
INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, normal_balance) VALUES
(1, '55010002', 'تكلفة مبيعات تقاوي وبذور', 'expense', '5501', 1, 'debit'),
(1, '55010003', 'تكلفة مبيعات أسمدة ومحسنات', 'expense', '5501', 1, 'debit'),
(1, '55010004', 'تكلفة مبيعات خدمات زراعية', 'expense', '5501', 1, 'debit'),
(1, '55010005', 'تكلفة مبيعات وقود تشغيل', 'expense', '5501', 1, 'debit');

-- Operating Expenses (debit)
INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, normal_balance) VALUES
(1, '62010001', 'مصروفات تشغيل معدات زراعية', 'expense', '6201', 1, 'debit'),
(1, '62010002', 'مصروفات قطع غيار ومستهلكات', 'expense', '6201', 1, 'debit'),
(1, '62010003', 'مصروفات إدارية وعمومية تشغيلية', 'expense', '6201', 1, 'debit');

-- WIP & Finished Goods (debit - assets)
INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, normal_balance) VALUES
(1, '13500001', 'مخزون تحت التشغيل - محاصيل زراعية', 'asset', '1350', 1, 'debit'),
(1, '14070401', 'مخزون محاصيل تامة', 'asset', '1407', 1, 'debit');

-- Inventory Accounts (debit - assets)
INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, normal_balance) VALUES
(1, '14070107', 'مخزون وقود زراعي', 'asset', '1407', 1, 'debit'),
(1, '14070108', 'مخزون وقود - تسويات', 'asset', '1407', 1, 'debit');

-- VAT Accounts
INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, normal_balance) VALUES
(1, '14040711', 'ضريبة قيمة مضافة مدخلات - مستردة', 'asset', '1404', 1, 'debit'),
(1, '21060001', 'ضريبة قيمة مضافة مخرجات - مستحقة', 'liability', '2106', 1, 'credit');

-- Trade AR/AP
INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, normal_balance) VALUES
(1, '14030001', 'ذمم مدينة تجارية - عملاء', 'asset', '1403', 1, 'debit'),
(1, '21100001', 'ذمم دائنة تجارية - موردين', 'liability', '2110', 1, 'credit');

-- Depreciation (credit - contra asset)
INSERT INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, normal_balance) VALUES
(1, '15900001', 'مجمع إهلاك معدات زراعية', 'asset', '1590', 1, 'credit');

-- Verification
SELECT 'PHASE 1B COMPLETED' as status;
SELECT code, name, account_type, normal_balance FROM chart_of_accounts WHERE company_id = 1 AND code IN ('55010001', '55010002', '55010003', '55010004', '55010005') ORDER BY code;
