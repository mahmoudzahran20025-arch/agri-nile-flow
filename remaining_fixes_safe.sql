-- Remaining Fixes SQL - Safe version without FK violations
-- Fix 1: Update items with warehouse and posting group
UPDATE items SET warehouse = 'اسمدة', prod_posting_group_code = 'FERT' WHERE code >= 1010000 AND code < 1020000;
UPDATE items SET warehouse = 'مبيدات', prod_posting_group_code = 'CHEM' WHERE code >= 1020000 AND code < 1030000;
UPDATE items SET warehouse = 'تقاوي وبذور', prod_posting_group_code = 'SEED' WHERE code >= 1030000 AND code < 1040000;
UPDATE items SET warehouse = 'زيوت ووقود', prod_posting_group_code = 'FERT' WHERE code >= 1040000 AND code < 1050000;
UPDATE items SET warehouse = 'شبكات ري', prod_posting_group_code = 'EQUIP' WHERE code >= 1050000 AND code < 1060000;
UPDATE items SET warehouse = 'معدات', prod_posting_group_code = 'EQUIP' WHERE code >= 1060000 AND code < 1070000;
UPDATE items SET warehouse = 'قطع غيار', prod_posting_group_code = 'EQUIP' WHERE code >= 1070000 AND code < 1080000;
UPDATE items SET warehouse = 'تعبئة وتغليف', prod_posting_group_code = 'FERT' WHERE code >= 1080000 AND code < 1090000;
UPDATE items SET warehouse = 'متنوعات', prod_posting_group_code = 'EQUIP' WHERE code >= 1090000 AND code < 1100000;

-- Fix 2: Link cash transactions to bank account (use id=2 for cash)
UPDATE cash_transactions SET financial_account_id = 2 WHERE company_id = 1 AND financial_account_id IS NULL;

-- Fix 3: Close old periods instead of deleting (to avoid FK issues)
UPDATE financial_periods SET is_closed = 1 WHERE id IN (1, 2, 4);

-- Fix 4: Update period 3 to be the active season period
UPDATE financial_periods SET name = 'الموسم الشتوي 2025-2026', start_date = '2025-10-01', end_date = '2026-03-31', is_closed = 0 WHERE id = 3;
