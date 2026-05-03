# APAgingPage — add toggle to hide suppliers with zero balance
- Read APAgingPage.tsx. Find the supplier aging table.
- Add a "إخفاء الأرصدة الصفرية" checkbox toggle (default: on — only show non-zero).
- Filter client-side since aging data is already loaded per-page.
Verification:
- Toggling shows/hides zero-balance rows instantly. Count in header updates accordingly.
