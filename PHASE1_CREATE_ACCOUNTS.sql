-- ============================================================================
-- PHASE 1: CREATE MISSING CHART OF ACCOUNTS
-- Safe migration step - creates accounts only, no posting setup changes
-- Date: April 30, 2026
-- ============================================================================

-- ============================================================================
-- 1. COGS ACCOUNTS (55xxxx) - MUST CREATE (Critical for posting engine)
-- ============================================================================
INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, description) VALUES
(1, '55010001', 'تكلفة مبيعات بنجر', 'expense', '55000000', 1, 'COGS للبنجر والمحاصيل الرئيسية'),
(1, '55010002', 'تكلفة مبيعات تقاوي وبذور', 'expense', '55000000', 1, 'COGS للتقاوي والبذور'),
(1, '55010003', 'تكلفة مبيعات أسمدة ومحسنات', 'expense', '55000000', 1, 'COGS للأسمدة والمخصبات الزراعية'),
(1, '55010004', 'تكلفة مبيعات خدمات زراعية', 'expense', '55000000', 1, 'COGS للخدمات الزراعية'),
(1, '55010005', 'تكلفة مبيعات وقود تشغيل', 'expense', '55000000', 1, 'COGS للوقود والطاقة');

-- ============================================================================
-- 2. OPERATING EXPENSES (62xxxx) - MUST CREATE
-- ============================================================================
INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, description) VALUES
(1, '62010001', 'مصروفات تشغيل معدات زراعية', 'expense', '62000000', 1, 'مصروفات تشغيل وصيانة المعدات الرأسمالية'),
(1, '62010002', 'مصروفات قطع غيار ومستهلكات', 'expense', '62000000', 1, 'مصروفات قطع الغيار والمستهلكات التشغيلية'),
(1, '62010003', 'مصروفات إدارية وعمومية تشغيلية', 'expense', '62000000', 1, 'المصروفات الإدارية والعمومية للعمليات الزراعية');

-- ============================================================================
-- 3. WIP & FINISHED GOODS ACCOUNTS - MUST CREATE
-- ============================================================================
INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, description) VALUES
(1, '13500001', 'مخزون تحت التشغيل - محاصيل زراعية', 'asset', '13000000', 1, 'WIP للمحاصيل الزراعية أثناء مراحل النمو (تحت التشغيل)'),
(1, '14070401', 'مخزون محاصيل تامة', 'asset', '14000000', 1, 'المحاصيل النهائية الجاهزة للبيع');

-- ============================================================================
-- 4. INVENTORY ACCOUNTS - SHOULD CREATE (for proper classification)
-- ============================================================================
INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, description) VALUES
(1, '14070107', 'مخزون وقود زراعي', 'asset', '14000000', 1, 'مخزون الوقود والزيوت للاستخدام الزراعي'),
(1, '14070108', 'مخزون وقود - تسويات', 'asset', '14000000', 1, 'حساب تسويات مخزون الوقود');

-- ============================================================================
-- 5. VAT ACCOUNTS - SHOULD CREATE (for Egyptian tax compliance)
-- ============================================================================
INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, description) VALUES
(1, '14040711', 'ضريبة قيمة مضافة مدخلات - مستردة', 'asset', '14000000', 1, 'VAT على المشتريات (input VAT - recoverable)'),
(1, '21060001', 'ضريبة قيمة مضافة مخرجات - مستحقة', 'liability', '21000000', 1, 'VAT على المبيعات (output VAT - payable)');

-- ============================================================================
-- 6. TRADE RECEIVABLES/PAYABLES - SHOULD CREATE (for clean separation)
-- ============================================================================
INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, description) VALUES
(1, '14030001', 'ذمم مدينة تجارية - عملاء', 'asset', '14000000', 1, 'AR Trade - مستحقات من العملاء'),
(1, '21100001', 'ذمم دائنة تجارية - موردين', 'liability', '21000000', 1, 'AP Trade - مستحقات للموردين');

-- ============================================================================
-- 7. DEPRECIATION ACCOUNTS - SHOULD CREATE (for fixed assets)
-- ============================================================================
INSERT OR IGNORE INTO chart_of_accounts (company_id, code, name, account_type, parent_code, is_active, description) VALUES
(1, '15900001', 'مجمع إهلاك معدات زراعية', 'asset', '15000000', 1, 'إهلاك المعدات والآلات الزراعية');

-- ============================================================================
-- 8. VERIFY CREATION
-- ============================================================================
SELECT 'PHASE 1 COMPLETED: Accounts Created' as status;

-- Show created accounts by category
SELECT 'COGS Accounts (55xxxx)' as category, COUNT(*) as count FROM chart_of_accounts WHERE company_id = 1 AND code LIKE '5501%';
SELECT 'Operating Expenses (62xxxx)' as category, COUNT(*) as count FROM chart_of_accounts WHERE company_id = 1 AND code LIKE '6201%';
SELECT 'WIP & Finished (135xxxx, 140704%)' as category, COUNT(*) as count FROM chart_of_accounts WHERE company_id = 1 AND (code LIKE '135%' OR code LIKE '140704%');
SELECT 'VAT Accounts' as category, COUNT(*) as count FROM chart_of_accounts WHERE company_id = 1 AND code IN ('14040711', '21060001');
SELECT 'Trade AR/AP' as category, COUNT(*) as count FROM chart_of_accounts WHERE company_id = 1 AND code IN ('14030001', '21100001');
SELECT 'Depreciation' as category, COUNT(*) as count FROM chart_of_accounts WHERE company_id = 1 AND code = '15900001';
