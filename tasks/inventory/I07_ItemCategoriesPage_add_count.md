# ItemCategoriesPage shows categories without item count — add count badge
- In GET /inventory/categories (items.ts:118): add LEFT JOIN items count to the query.
- Return item_count per category. Show as a grey badge in the category list.
- Clicking a category should navigate to ItemMasterPage filtered by that category.
Verification:
- Each category row shows item count. Clicking "أسمدة (45)" opens ItemMasterPage with category filter active.
