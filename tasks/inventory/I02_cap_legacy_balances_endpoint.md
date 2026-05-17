# GET /inventory/balances (items.ts:14) has no LIMIT — add safety cap
- Add LIMIT 200 to the vw_stock_balances query. Add a warning comment: "Legacy endpoint — use /inventory/balances (balances.ts) for paginated access."
- Verify WarehouseBalancesPage.tsx still works (it uses this endpoint).
- If WarehouseBalancesPage was already migrated to use balances.ts, remove the old endpoint.
Verification:
- `grep -n "vw_stock_balances\|GET /balances" src/api/inventory/items.ts` shows LIMIT in query.
