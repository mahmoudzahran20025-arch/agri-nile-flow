# Replace "جاري التحميل..." text with skeleton rows in inventory tables
- Find all `animate-pulse جاري التحميل` in inventory pages.
- Replace with a TableSkeleton component: renders 5 grey shimmer rows matching the table column count.
- Apply to: InventoryMovementsPage, ItemMasterPage, InventoryBalancesPage, AdjustmentDetailPage.
Verification:
- On slow network: skeleton rows appear instead of text. Column count matches real table.
