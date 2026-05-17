# PurchaseOrdersPage — add status filter (open/partial/closed/all)
- Read PurchaseOrdersPage.tsx. Check if status filter already exists.
- If missing: add status tab bar (الكل / مفتوح / جزئي / مغلق) matching the design in InventoryMovementsPage.
- Pass status param to backend GET /treasury/po and filter in SQL.
Verification:
- Selecting "مفتوح" shows only open POs. Count matches. Tab state persists on browser back.
