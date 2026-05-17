# GET /item/:code/card returns unbounded movement history
- In src/api/inventory/items.ts:105 add LIMIT 500 OFFSET ? and accept page query param.
- Return { data, total, page, has_more } in the response shape.
- Update ItemCardPage.tsx to show "عرض المزيد" button when has_more=true.
Verification:
- Item with 1000+ movements: first load returns 500 rows. "عرض المزيد" loads next 500.
