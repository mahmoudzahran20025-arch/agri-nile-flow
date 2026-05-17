# Supplier codes must be consistent across supplier_invoices, cash_transactions, inventory_movements
- SELECT DISTINCT supplier_code FROM supplier_invoices WHERE supplier_code NOT IN (SELECT code FROM suppliers).
- Repeat for cash_transactions, inventory_movements.
- Any orphan supplier_codes: either create supplier stub or null them with a logged UPDATE.
Verification:
- All three queries return 0 rows. Supplier hub shows no broken references.
