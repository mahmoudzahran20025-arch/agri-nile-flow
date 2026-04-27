-- =============================================================================
-- FIX_ghost_mappings.sql
-- =============================================================================
-- PURPOSE:  Correct the 8 gl_account_mappings entries that reference account
--           codes absent from chart_of_accounts (discovered in audit A-03).
--
-- STATUS:   ⚠️  DO NOT RUN WITHOUT MANUAL REVIEW  ⚠️
--           Review each replacement account below against the live CoA before
--           executing. Run AUDIT queries first to confirm codes still exist.
--
-- SAFE TO RUN:  Yes — only UPDATE statements, no DELETE/DROP/INSERT.
-- REVERSIBLE:   Yes — store original values before applying (see ROLLBACK block).
-- WHEN TO RUN:  After confirming replacement accounts with the accountant,
--               and BEFORE enabling ENABLE_POSTING_ENGINE if using hybrid mode.
--
-- AUDIT QUERIES (run these first to verify replacements still exist):
--   SELECT code, name, account_type, is_active FROM chart_of_accounts
--   WHERE code IN ('45010001','51200034','140701','41010001','51010001');
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ROLLBACK REFERENCE (run these to undo if needed):
-- -----------------------------------------------------------------------------
-- UPDATE gl_account_mappings SET account_code = '5110'  WHERE mapping_key = 'cogs'            AND company_id = 1;
-- UPDATE gl_account_mappings SET account_code = '5410'  WHERE mapping_key = 'expense'          AND company_id = 1;
-- UPDATE gl_account_mappings SET account_code = '5410'  WHERE mapping_key = 'expense_default'  AND company_id = 1;
-- UPDATE gl_account_mappings SET account_code = '1130'  WHERE mapping_key = 'inventory'        AND company_id = 1;
-- UPDATE gl_account_mappings SET account_code = '5110'  WHERE mapping_key = 'purchases'        AND company_id = 1;
-- UPDATE gl_account_mappings SET account_code = '4210'  WHERE mapping_key = 'revenue'          AND company_id = 1;
-- UPDATE gl_account_mappings SET account_code = '4210'  WHERE mapping_key = 'revenue_default'  AND company_id = 1;
-- UPDATE gl_account_mappings SET account_code = '5210'  WHERE mapping_key = 'wages'            AND company_id = 1;
-- -----------------------------------------------------------------------------

-- 1. COGS — تكلفة المبيعات
--    Ghost: 5110  →  Replacement: 45010001 (تكلفة المبيعات, account_type=revenue)
--    Used by: glInventoryMovement (withdrawal+work_order), glWorkOrderLabor
UPDATE gl_account_mappings
SET account_code = '45010001'
WHERE mapping_key = 'cogs'
  AND company_id  = 1
  AND account_code = '5110';

-- 2. EXPENSE — مصروفات متنوعة
--    Ghost: 5410  →  Replacement: 51200034 (مصروفات متنوعة, account_type=expense)
--    Used by: glSupplierTransaction ('د' debit side), fallback in multiple functions
UPDATE gl_account_mappings
SET account_code = '51200034'
WHERE mapping_key = 'expense'
  AND company_id  = 1
  AND account_code = '5410';

-- 3. EXPENSE_DEFAULT — مصروفات متنوعة (same as expense)
--    Ghost: 5410  →  Replacement: 51200034 (مصروفات متنوعة, account_type=expense)
--    Used by: glCashTransaction (expense direction), prepareCashMovement, glInventoryMovement fallback
UPDATE gl_account_mappings
SET account_code = '51200034'
WHERE mapping_key = 'expense_default'
  AND company_id  = 1
  AND account_code = '5410';

-- 4. INVENTORY — المخزون المحصول (parent summary account)
--    Ghost: 1130  →  Replacement: 140701 (المخزون -المحصول, account_type=asset)
--    NOTE: If sub-account routing is desired, use inventory_posting_setup instead.
--    Used by: glInventoryMovement (both DR and CR sides), processPOReceipt, postHarvestLedger
UPDATE gl_account_mappings
SET account_code = '140701'
WHERE mapping_key = 'inventory'
  AND company_id  = 1
  AND account_code = '1130';

-- 5. PURCHASES — تكلفة المبيعات
--    Ghost: 5110  →  Replacement: 45010001 (تكلفة المبيعات, account_type=revenue)
--    ALTERNATIVE: 51200024 (مقاولات نقل - مشتريات) if purchases should be operating expense.
--    Used by: glSupplierInvoice (primary DR side)
UPDATE gl_account_mappings
SET account_code = '45010001'
WHERE mapping_key = 'purchases'
  AND company_id  = 1
  AND account_code = '5110';

-- 6. REVENUE — إيراد نشاط المحصول
--    Ghost: 4210  →  Replacement: 41010001 (إيراد نشاط المحصول, account_type=revenue)
--    Used by: glCashTransaction (income direction) via contraAccountOverride chain
UPDATE gl_account_mappings
SET account_code = '41010001'
WHERE mapping_key = 'revenue'
  AND company_id  = 1
  AND account_code = '4210';

-- 7. REVENUE_DEFAULT — إيراد نشاط المحصول (same as revenue)
--    Ghost: 4210  →  Replacement: 41010001 (إيراد نشاط المحصول, account_type=revenue)
--    Used by: glCashTransaction fallback, prepareCashMovement cash-in default
UPDATE gl_account_mappings
SET account_code = '41010001'
WHERE mapping_key = 'revenue_default'
  AND company_id  = 1
  AND account_code = '4210';

-- 8. WAGES — الأجور والمرتبات
--    Ghost: 5210  →  Replacement: 51010001 (الأجور والمرتبات, account_type=expense)
--    Used by: glPayroll (DR wages expense side)
UPDATE gl_account_mappings
SET account_code = '51010001'
WHERE mapping_key = 'wages'
  AND company_id  = 1
  AND account_code = '5210';

-- =============================================================================
-- POST-FIX VERIFICATION QUERIES (run after applying):
-- =============================================================================
-- SELECT m.mapping_key, m.account_code, coa.name, coa.account_type, coa.is_active
-- FROM gl_account_mappings m
-- LEFT JOIN chart_of_accounts coa
--   ON coa.company_id = m.company_id AND coa.code = m.account_code
-- WHERE coa.code IS NULL OR coa.is_active = 0
-- ORDER BY m.mapping_key;
-- Expected result: 0 rows (all ghost mappings resolved)
-- =============================================================================
