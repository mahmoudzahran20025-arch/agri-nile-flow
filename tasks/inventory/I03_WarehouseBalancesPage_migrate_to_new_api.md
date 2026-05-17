# WarehouseBalancesPage.tsx — check if it calls old /balances endpoint
- Read WarehouseBalancesPage.tsx. Find its useQuery / API call.
- If it calls inventoryApi.balances() (old unbounded): switch to inventoryApi.balancesList() which is paginated.
- Add warehouse filter dropdown and search input matching InventoryBalancesPage pattern.
Verification:
- Opening /inventory loads ≤200 rows. Warehouse filter works. No full-table scan in network tab.
