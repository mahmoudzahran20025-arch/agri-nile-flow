# Identify items with negative balance_qty in inventory_balances snapshot
- SELECT item_code, warehouse, balance_qty FROM inventory_balances WHERE balance_qty < 0.
- For each: cross-check against movement ledger SUM(qty_in - qty_out).
- If ledger also negative: flag for ops review. If only snapshot negative: set is_stale=1 for self-heal.
Verification:
- A report file lists all negative items. No item has snapshot negative while ledger positive.
