-- Fix 1: Link bank accounts to GL chart of accounts
UPDATE bank_accounts SET gl_account_code = '14010101' WHERE id = 2;
UPDATE bank_accounts SET gl_account_code = '14010501' WHERE id = 1;

-- Fix 2: Link all cash transactions to cash account (id=2: نقدية/الخزينة)
UPDATE cash_transactions SET financial_account_id = 2 WHERE company_id = 1 AND financial_account_id IS NULL;

-- Fix 3: Clean up duplicate financial periods
DELETE FROM financial_periods WHERE id = 4;

-- Fix 4: Close old periods, keep current open
UPDATE financial_periods SET is_closed = 1 WHERE id IN (1, 2);
UPDATE financial_periods SET is_closed = 0 WHERE id = 3;
