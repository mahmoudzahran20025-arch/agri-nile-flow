# Show alert on PostingHealth page when any outbox row hits max retries (attempts >= 10)
- In the inventory_posting_outbox query in InventoryPostingHealthPage, check for status='failed' rows.
- If count > 0: show a red banner at top: "X حركات فشل ترحيلها نهائياً — تحتاج مراجعة يدوية" with a link to the failed rows.
- Add a "إعادة المحاولة" button that resets attempts=0 and status='pending' for all failed rows.
Verification:
- DB row with attempts=10 status='failed' triggers red banner. Reset button works.
