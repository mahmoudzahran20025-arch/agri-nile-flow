SELECT 'items_total' AS metric, COUNT(*) AS value FROM items WHERE is_active=1
UNION ALL SELECT 'missing_ppg', COUNT(*) FROM items WHERE is_active=1 AND (prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code)='')
UNION ALL SELECT 'missing_ipg', COUNT(*) FROM items WHERE is_active=1 AND (inv_posting_group_code IS NULL OR TRIM(inv_posting_group_code)='')
UNION ALL SELECT 'movements_total', COUNT(*) FROM inventory_movements
UNION ALL SELECT 'movements_posted', COUNT(*) FROM inventory_movements WHERE gl_posting_status='posted'
UNION ALL SELECT 'movements_exempt', COUNT(*) FROM inventory_movements WHERE gl_posting_status='exempt_zero_value'
UNION ALL SELECT 'movements_pending', COUNT(*) FROM inventory_movements WHERE gl_posting_status='pending'
UNION ALL SELECT 'ghost_posted', COUNT(*) FROM inventory_movements WHERE gl_posting_status='posted' AND journal_entry_id IS NULL
UNION ALL SELECT 'future_movements', COUNT(*) FROM inventory_movements WHERE movement_date > date('now')
UNION ALL SELECT 'outbox_pending', COUNT(*) FROM inventory_posting_outbox WHERE status='pending'
UNION ALL SELECT 'journal_entries', COUNT(*) FROM journal_entries
UNION ALL SELECT 'je_lines', COUNT(*) FROM journal_entry_lines
UNION ALL SELECT 'inventory_balances', COUNT(*) FROM inventory_balances
UNION ALL SELECT 'chart_of_accounts', COUNT(*) FROM chart_of_accounts
UNION ALL SELECT 'posting_rules_active', COUNT(*) FROM posting_rules WHERE is_active=1
UNION ALL SELECT 'open_periods', COUNT(*) FROM financial_periods WHERE is_closed=0;
