# TrialBalancePage.tsx in reports/ — confirm if routed or dead
- Check App.tsx for a route to /reports/trial-balance or similar.
- If no route exists and no component imports it, delete the file.
- If it IS useful, add a route and link from ReportsPage navigation.
Verification:
- Either the page is reachable via a route, or it's deleted. No orphan file remains.
