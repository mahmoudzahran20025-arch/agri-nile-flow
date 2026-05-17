# All inventory_movements should have transaction_id after migration 0079
- SELECT count(*) FROM inventory_movements WHERE transaction_id IS NULL.
- If > 0: run the backfill logic from migration 0079 again (INSERT OR IGNORE headers, then UPDATE movements).
- Confirm result is 0.
Verification:
- COUNT returns 0. TransactionHistoryPage loads without null transaction entries.
