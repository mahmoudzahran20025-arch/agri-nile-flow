# TransactionHistoryPage — add CSV export button
- Add a "تصدير CSV" button that calls GET /inventory/transactions with same filters but format=csv.
- Backend: detect format=csv, return text/csv with proper Arabic headers.
- Use the existing export pattern from other pages (check src/api/export.ts).
Verification:
- Clicking export downloads a .csv file. Opening in Excel shows Arabic headers and correct data.
