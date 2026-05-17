# FixedAssetsPage — add net book value column (cost - accumulated depreciation)
- In the assets list backend: add a computed column net_book_value = cost - COALESCE(SUM posted depreciation, 0).
- Join depreciation_schedules WHERE status='posted' to get accumulated amount.
- Show NBV column in the table. Add a footer row with total NBV.
Verification:
- Asset with cost=100,000 and 12 months posted depreciation shows correct NBV. Footer total matches.
