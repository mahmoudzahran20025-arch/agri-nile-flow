UPDATE journal_entries SET is_posted = 0 WHERE id IN (4525, 4524, 4522, 4520);
UPDATE journal_entry_lines SET account_code = '1110' WHERE id IN (9040, 9038, 9034, 9030);
UPDATE journal_entries SET is_posted = 1 WHERE id IN (4525, 4524, 4522, 4520);
UPDATE supplier_transactions SET status = 'draft' WHERE id = 3542;
