# SupplierListPage.tsx exists but is not imported in App.tsx
- Confirm App.tsx uses SupplierHubPage and SupplierDetailPage only.
- If SupplierListPage is not referenced anywhere, delete the file.
- Check if any component imports it as a sub-component before deleting.
Verification:
- `grep -rn "SupplierListPage" web/src/` returns zero after deletion. Build passes.
