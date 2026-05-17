# Create a shared Pagination component for all paginated tables
- Inspect InventoryMovementsPage, ItemMasterPage, InventoryBalancesPage for their pagination UI.
- Extract into web/src/components/ui/Pagination.tsx: props: page, pageCount, total, onPageChange.
- Replace all three pages + SupplierDetailPage invoice tab with the shared component.
Verification:
- All paginated tables have identical pagination UI. Page/total numbers display correctly.
