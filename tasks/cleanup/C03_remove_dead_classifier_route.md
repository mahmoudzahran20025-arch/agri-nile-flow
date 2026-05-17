# Remove the /gl/classifier dead route and its redirect
- In App.tsx line ~228: `<Route path="gl/classifier" element={<Navigate to="/gl" replace />}` — confirm no inbound link exists.
- Search AppShell.tsx and all nav files for "classifier" — if zero hits, remove the Route.
- Same for /gl/integrations redirect if no links point to it.
Verification:
- `grep -rn "classifier" web/src/` returns zero results after removal.
