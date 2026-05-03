# InventoryPostingHealthPage — add GL status filter tabs
- Read InventoryPostingHealthPage.tsx. GL trace table shows all statuses mixed.
- Add filter tabs: الكل / معلق / فاشل / مرحّل (matching gl_posting_status values).
- Pass gl_status param to the backend and filter in SQL.
Verification:
- Selecting "فاشل" shows only failed postings. Count badge on tab matches row count.
