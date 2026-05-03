# InventoryBalancesPage — stale badge has no explanation tooltip
- Find the is_stale badge in InventoryBalancesPage.tsx.
- Add a title tooltip: "الرصيد قديم — سيتم إعادة الحساب تلقائياً عند الاستخدام التالي".
- Also change badge color: is_stale=1 → orange, is_stale=0 → green.
Verification:
- Hovering the orange badge shows the Arabic tooltip. Green badges show for fresh rows.
