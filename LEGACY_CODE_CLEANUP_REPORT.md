# Legacy Code Cleanup Report

Date: 2026-04-27
Status: Completed (safe slice)

## Files Modified
- web/src/pages/gl/GLMappingsPage.tsx
- web/src/pages/gl/GLSettingsPage.tsx
- web/src/pages/gl/IntegrationControlPage.tsx

## Changes Made
### 1) GLMappingsPage.tsx
- Removed mutation/write flow to deprecated endpoint.
- Removed save buttons and sticky save bar.
- Removed local edit state and dirty/saved tracking.
- Converted account selectors to read-only display mode (disabled select).
- Kept coverage and status visibility for historical/audit use.

### 2) GLSettingsPage.tsx
- Changed default tab from mappings to integrations.
- Reordered tabs to show active workflows first.
- Added explicit LEGACY labels for mappings and classifier tabs.
- Updated header description text to reflect active vs legacy areas.

### 3) IntegrationControlPage.tsx
- Replaced legacy readiness scoring based on `gl_account_mappings` count.
- Switched readiness source to `/gl/posting-setup/health` (canonical engine path).
- Updated action links from `/gl/mappings` to `/gl/posting-setup`.
- Reworded CTA text from "استكمال الربط" to "استكمال التهيئة" for posting-setup alignment.

## Legacy Patterns Removed
- Deprecated mapping write UX path (frontend) removed.
- Implicit legacy-first landing behavior removed from GL settings hub.
- Mapping-centric readiness logic removed from Integration Control dashboard.

## Verification
- TypeScript: PASS (npx tsc --noEmit)
- Build: PASS (npm run build)
- Backend compatibility: unchanged (legacy read routes still available)

## Notes
- No destructive deletion was performed.
- Legacy pages remain reachable for backward compatibility and historical support.
