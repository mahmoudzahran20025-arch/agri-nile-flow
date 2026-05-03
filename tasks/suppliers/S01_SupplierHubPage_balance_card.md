# SupplierHubPage — add outstanding balance KPI card at top
- Query GET /suppliers returns supplier list. Add total_outstanding (sum of unpaid invoices) to the API response.
- Show a KPI card "إجمالي المديونيات" in EGP at the top of SupplierHubPage.
- Clicking it should filter the list to suppliers with balance > 0.
Verification:
- KPI card shows correct total matching SuppliersBalancePage total. Filter works.
