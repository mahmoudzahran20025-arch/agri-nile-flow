-- Fix 1: Link bank accounts to GL chart of accounts
UPDATE bank_accounts SET gl_account_code = '14010101' WHERE id = 2;
UPDATE bank_accounts SET gl_account_code = '14010501' WHERE id = 1;

-- Fix 2: Link all cash transactions to cash account (id=2: نقدية/الخزينة)
-- All 69 treasury transactions link to bank_accounts.id=2
UPDATE cash_transactions SET financial_account_id = 2 WHERE company_id = 1 AND financial_account_id IS NULL;
