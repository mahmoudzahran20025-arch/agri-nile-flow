-- Cost Centers GL Mapping SQL
-- Generated: 2026-04-29T11:01:08.789Z
-- Total centers: 0

BEGIN TRANSACTION;

-- Insert/Update Cost Centers

-- Link Centers to GL Accounts (via posting_rules or center_accounts)
DELETE FROM center_account_mapping WHERE company_id = 1;

COMMIT;
