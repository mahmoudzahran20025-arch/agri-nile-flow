# WipBalancesPage and FixedAssetsPage have routes but no nav links
- Search AppShell.tsx for "wip" and "fixed-assets" — confirm nav items exist.
- If missing: add nav entries under the inventory section: "الأصول الثابتة" → /inventory/fixed-assets, "إنتاج جاري" → /inventory/wip.
- Verify App.tsx routes for both pages are present (they were added in a prior commit).
Verification:
- Both pages are reachable from sidebar. Breadcrumb shows correct path.
