# Create EmptyState component to replace copy-paste empty table messages
- Find all `p-16 text-center text-slate-400` patterns in inventory pages — these are ad-hoc empty states.
- Create web/src/components/ui/EmptyState.tsx with props: icon, title, subtitle, action.
- Replace in: ItemMasterPage, InventoryMovementsPage, InventoryBalancesPage, TransactionHistoryPage, CostByFieldPage.
Verification:
- All replaced pages show consistent empty state styling. No more inline p-16 divs.
