# Every item in `items` table should have a valid category_id
- SELECT count(*) FROM items WHERE category_id IS NULL OR category_id NOT IN (SELECT id FROM item_categories).
- For uncategorized items: assign to a default 'غير مصنف' category (create it if missing).
- Update items SET category_id = (default_id) WHERE category_id IS NULL.
Verification:
- Above query returns 0. ItemMasterPage shows no blank category column.
