-- Safe insert of bank accounts without DELETE
-- Using INSERT OR REPLACE to avoid foreign key issues

-- Cash Accounts (Treasury)
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'نقدية', 'نقدية - خزينة', '140101', 'EGP', '140101', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'نقدية', 'خزينة ج . م', '14010101', 'EGP', '14010101', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'نقدية', 'خزينة - دولار', '14010150', 'EGP', '14010150', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'نقدية', 'خزينة - يورو', '14010180', 'EGP', '14010180', 0, 1, datetime('now'));

-- Bank Accounts
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'نقدية - فيزا', '140102', 'EGP', '140102', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'فيزا - ج . م', '14010201', 'EGP', '14010201', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'نقدية - بنوك', '140103', 'EGP', '140103', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'بنك 1', '14010301', 'EGP', '14010301', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'بنك 2', '14010302', 'EGP', '14010302', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'بنك 3', '14010303', 'EGP', '14010303', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'بنك 4', '14010304', 'EGP', '14010304', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'ودائع لأجل', '140104', 'EGP', '140104', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'بنك 4 (ودائع)', '14010401', 'EGP', '14010401', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'بنك 5', '140105', 'EGP', '140105', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'بنك 6', '14010501', 'EGP', '14010501', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'غطاء خطاب ضمان بنك مصر', '14010502', 'EGP', '14010502', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'غطاء إعتمادات مستندية', '140106', 'EGP', '140106', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'غطاء إعتمادات مستندية', '14010601', 'EGP', '14010601', 0, 1, datetime('now'));
INSERT OR REPLACE INTO bank_accounts (company_id, bank_name, account_name, account_number, currency, gl_account_code, opening_balance, is_active, created_at) VALUES (1, 'بنك', 'اعتمادات مستنديه', '14010602', 'EGP', '14010602', 0, 1, datetime('now'));
