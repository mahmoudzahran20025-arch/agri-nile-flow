-- Bank Accounts Integration SQL
-- Generated: 2026-04-29T11:15:33.291Z

-- Create Bank Accounts
INSERT OR REPLACE INTO bank_accounts (account_code, company_id, name, account_type, is_active, is_default, created_at) VALUES ('14010101', 1, 'صندوق النقدية الرئيسي', 'cash', 1, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (account_code, company_id, name, account_type, is_active, is_default, created_at) VALUES ('14010201', 1, 'البنك الأهلي - الحساب الجاري', 'bank', 1, 0, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (account_code, company_id, name, account_type, is_active, is_default, created_at) VALUES ('14010301', 1, 'حساب جهاز مستقبل مصر', 'special', 1, 0, datetime('now'));

-- Update Cash Transactions with Bank Account
-- Default all to cash account (14010101)
UPDATE cash_transactions SET bank_account_id = '14010101' WHERE company_id = 1 AND bank_account_id IS NULL;

-- Update special transactions
UPDATE cash_transactions SET bank_account_id = '14010301' WHERE company_id = 1 AND narration LIKE '%جهاز مستقبل مصر%';

