# GL Pages Audit Report

Date: 2026-04-27
Scope: web/src/pages/gl (13 pages), route wiring, legacy references

## Summary
- Total Pages: 13
- Keep and Enhance: 11
- Keep as Legacy Read-Only: 2
- Remove Now: 0

## Page Inventory and Decision
| Page | Decision | Priority | Notes |
|---|---|---|---|
| ChartOfAccountsPage.tsx | Keep and Enhance | High | Core GL master data UX can be improved gradually |
| AccountLedgerPage.tsx | Keep and Enhance | High | Core ledger analysis surface |
| JournalEntriesPage.tsx | Keep and Enhance | High | Core operational accounting page |
| FinancialStatementsPage.tsx | Keep and Enhance | High | Core financial reporting page |
| PeriodsPage.tsx | Keep and Enhance | Medium | Financial period governance |
| PostingGroupsPage.tsx | Keep and Enhance | Medium | Canonical posting model |
| PostingSetupPage.tsx | Keep and Enhance | High | Canonical setup matrix |
| PostingSetupHealthPage.tsx | Keep and Enhance | High | Production readiness gate |
| SetupWizardPage.tsx | Keep and Enhance | Medium | Onboarding flow |
| GLSettingsPage.tsx | Keep and Enhance | Medium | Hub behavior updated to prioritize active tabs |
| IntegrationControlPage.tsx | Keep and Enhance | Medium | Runtime control and governance |
| GLMappingsPage.tsx | Keep as Legacy Read-Only | Low | Deprecated backend writes (PUT returns 405), kept for historical visibility |
| SmartClassifierPage.tsx | Keep as Legacy Read-Only | Low | Legacy data cleanup tool, still linked and useful for historical reconciliation |

## Legacy Findings
- Legacy route endpoints still intentionally exposed for backward compatibility:
  - /gl/mappings
  - /gl/classifier
- GL mappings write API is deprecated and locked server-side.
- Frontend previously still exposed editable mapping UI; this was corrected in this execution slice.

## Immediate Safe Actions Completed
- Converted GLMappingsPage to strict read-only mode (removed save interactions).
- Changed GLSettings default tab from legacy mappings to integrations.
- Marked legacy tabs visually in GLSettings.

## Refusals and Deferrals (Intentional)
- Refused full 6-8 hour all-page redesign in one pass due regression risk and review overhead.
- Deferred creation of new major pages (GL dashboard, reconciliation, budget) to dedicated feature tickets.
- Deferred wide visual overhaul across all 13 pages until UX design baseline and acceptance criteria are approved.

## Estimated Next Iterations
1. Iteration A (1-2 days): high-impact filters and quick actions in Journal Entries and Ledger.
2. Iteration B (1-2 days): posting setup matrix UX and health quick-fix flows.
3. Iteration C (1 day): chart of accounts search, badges, and account usage insights.
