# Create a shared PageHeader component used by all inventory+supplier pages
- Check if a reusable PageHeader already exists in web/src/components/ui/.
- If not: create PageHeader.tsx with props: title, subtitle, actions (slot).
- Replace the copy-paste `<div className="page-header">` blocks in at least: ItemMasterPage, InventoryMovementsPage, SupplierHubPage, APAgingPage.
Verification:
- `grep -rn "page-header" web/src/pages/` returns only the shared component reference, not inline divs.
