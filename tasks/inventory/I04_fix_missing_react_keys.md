# Several inventory table maps are missing key props (React warning)
- Grep: `grep -n "\.map(" web/src/pages/inventory/*.tsx` — find any map() without key={item.id} or key={item.code}.
- Fix each: use item.id, movement.id, or composite key as appropriate.
- Check AdjustmentDetailPage, ItemCategoriesPage, WarehouseBalancesPage specifically.
Verification:
- Browser console shows zero "Each child in a list should have a unique key" warnings on inventory pages.
