# Delete confirmed test journal entries (ref_type='test' or description contains '[TEST]')
- Run: SELECT id, ref_type, description FROM journal_entries WHERE description LIKE '%[TEST]%' OR ref_type = 'test'.
- For each found: delete journal_entry_lines first, then journal_entries (FK order).
- Wrap in a transaction; rollback if count > 20 (safety guard).
Verification:
- Query returns 0 rows after cleanup. Balances in trial_balance unchanged for real accounts.
