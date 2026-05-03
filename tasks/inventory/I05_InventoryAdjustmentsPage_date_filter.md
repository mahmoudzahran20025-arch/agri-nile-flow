# InventoryAdjustmentsPage has no date range filter — add one
- Add from_date / to_date query params in the backend GET /inventory/adjustments endpoint.
- Add date range inputs to the frontend filter bar (same pattern as InventoryMovementsPage).
- Default: last 30 days. Reset on filter clear.
Verification:
- Filtering by date range returns correct subset. Empty state shows when range has no data.
