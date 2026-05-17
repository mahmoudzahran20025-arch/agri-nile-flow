# SupplierDetailPage — verify invoices tab loads paginated (not all at once)
- Read SupplierDetailPage.tsx invoice tab query. Check if it passes page/size params.
- If unbounded: add pagination (50/page) and Previous/Next controls.
- Also check payments tab for same issue.
Verification:
- Supplier with 200+ invoices: first load shows 50 rows. Pagination controls navigate correctly.
