-- Migration 0037: Treasury & Partners Evolution v2
-- Unified Financial Accounts and Partner History

-- 1. Add missing columns to cash_transactions
ALTER TABLE cash_transactions ADD COLUMN financial_account_id INTEGER REFERENCES bank_accounts(id);
ALTER TABLE cash_transactions ADD COLUMN partner_id           INTEGER REFERENCES partners(id);

-- 2. Seed the default Main Cash Safe if it doesn't exist
INSERT INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, opening_balance, notes)
SELECT 1, 'نقدية', 'الخزينة الرئيسية', 'CASH-001', 'EGP', 0, 'الخزينة الافتراضية للنظام'
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE account_number = 'CASH-001');

-- 3. Update existing transactions to use the first bank account
UPDATE cash_transactions SET financial_account_id = (SELECT id FROM bank_accounts WHERE company_id = cash_transactions.company_id LIMIT 1)
WHERE financial_account_id IS NULL;

-- 4. GL Mapping for Partners
-- Add mapping key for partner current accounts in gl_account_mappings
INSERT INTO gl_account_mappings (company_id, mapping_key, account_code)
SELECT 1, 'partner_current_account', '2105'
WHERE NOT EXISTS (SELECT 1 FROM gl_account_mappings WHERE mapping_key = 'partner_current_account');
