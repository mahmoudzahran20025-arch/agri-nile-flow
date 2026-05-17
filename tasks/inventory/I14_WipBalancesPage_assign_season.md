# WipBalancesPage — add "تخصيص لموسم" button per pending row
- Read WipBalancesPage.tsx. Currently shows WIP balances as read-only.
- Add a "تخصيص" button on each pending row that opens a small modal with a season selector.
- On confirm: call POST /config/wip/:id/assign with { to_season_id }.
Verification:
- Pending WIP row: clicking "تخصيص" → selecting season → confirming changes status to "محمول" immediately.
