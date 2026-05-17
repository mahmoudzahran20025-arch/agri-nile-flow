# Finance Frontend Integration Task Backlog

Status: Proposed
Date: 2026-05-01
Owner: Finance Frontend + GL Backend + QA

## Objective
Create a unified, trace-first Finance UX where users can move from business movement to GL entry traceability without dead ends, while aligning navigation with real operational workflows.

## Execution Principles
- Single active navigation source (no parallel legacy nav experiences).
- Traceability is a first-class action on all Finance operational screens.
- Keep ERP flow continuity: Source Movement -> GL Entry -> Trace -> Reversal Chain.
- Each task must ship with explicit acceptance criteria and smoke-test checklist.

## Delivery Waves
- Wave 1 (P0): Information architecture + route correctness + shared trace entry points.
- Wave 2 (P1): Cross-module drill-downs + consistency hardening.
- Wave 3 (P2): UX polish + observability enhancements.

---

## P0 Tasks (Must Ship First)

### FIN-UI-001: Unify Finance Navigation Source
Priority: P0
Type: Frontend
Estimate: 1.5 days
Dependencies: None

Scope:
- Keep only the active navigation model in the AppShell path.
- Migrate missing high-value Finance links from legacy sidebar definitions to active shell menu.
- Remove or clearly mark inactive/legacy navigation configs to prevent future drift.

Primary Files:
- web/src/components/shell/AppShell.tsx
- web/src/layouts/RootLayout.tsx
- web/src/components/Sidebar.tsx
- web/src/components/MobileNav.tsx

Acceptance Criteria:
- Every active Finance route in App router is discoverable from active shell navigation.
- No Finance link is present only in an unmounted navigation component.
- Mobile and desktop navigation expose the same Finance IA groups.

QA Checks:
- Navigate to all Finance sections from desktop sidebar/top navigation.
- Repeat on mobile nav.
- Verify no 404 or dead links.

---

### FIN-UI-002: Rebuild Finance IA into ERP Domain Groups
Priority: P0
Type: Frontend
Estimate: 1 day
Dependencies: FIN-UI-001

Scope:
- Group menu as: Operations, Health & Control, Reporting, Setup.
- Promote critical workflows: Reconciliation, Batch Posting, Period Close, Health & Integrity.
- De-emphasize transitional tools in primary navigation.

Primary Files:
- web/src/components/shell/AppShell.tsx

Acceptance Criteria:
- Finance menu is grouped by business intent, not technical page names.
- Reconciliation, Batch Posting, Period Close, and Integrity are first-level discoverable.
- Legacy/transitional pages are not top-priority entry points.

QA Checks:
- Time-to-discover test: user finds each critical screen in <= 2 clicks.

---

### FIN-UI-003: Correct Posting Health Route Mismatch
Priority: P0
Type: Frontend Routing
Estimate: 0.5 day
Dependencies: None

Scope:
- Route /gl/posting-setup/health to the actual PostingSetupHealth page.
- Move posting rules listing to an explicit and semantically correct route if needed.

Primary Files:
- web/src/App.tsx
- web/src/pages/gl/PostingSetupHealthPage.tsx
- web/src/pages/gl/PostingRulesPage.tsx

Acceptance Criteria:
- /gl/posting-setup/health renders health dashboard, not rules list.
- Rules page remains reachable via clear route and nav label.

QA Checks:
- Open route directly and confirm content type.
- Click through from setup and confirm consistency.

---

### FIN-UI-004: Standardize Trace Drawer Entry Points Across GL Screens
Priority: P0
Type: Frontend
Estimate: 2 days
Dependencies: FIN-UI-001

Scope:
- Reuse the GL trace drawer component beyond journal entries.
- Add trace action entry points on ledger and reconciliation rows.
- Remove fallback raw API trace links from user-facing interactions.

Primary Files:
- web/src/components/gl/GlEntryTraceDrawer.tsx
- web/src/pages/gl/JournalEntriesPage.tsx
- web/src/pages/gl/AccountLedgerPage.tsx
- web/src/pages/gl/ReconciliationPage.tsx

Acceptance Criteria:
- Users can open trace drawer from entries, ledger, and reconciliation.
- No screen requires exposing raw API URL as primary trace action.
- Trace drawer loads entry trace metadata consistently across origins.

QA Checks:
- Open same entry trace from all 3 screens and compare payload parity.

---

### FIN-UI-005: Enable Source Document Handoff from Trace Drawer
Priority: P0
Type: Frontend + Backend contract validation
Estimate: 2 days
Dependencies: FIN-UI-004

Scope:
- Implement source-module/source-type route mapping.
- Activate "Open Source" action in trace drawer.
- Provide fallback behavior for unknown source mappings.

Primary Files:
- web/src/components/gl/GlEntryTraceDrawer.tsx
- web/src/App.tsx
- web/src/api/gl.ts

Acceptance Criteria:
- For mapped source types, "Open Source" navigates to actual source screen with context.
- For unmapped types, user gets explicit informative fallback (not silent failure).
- Navigation preserves context (company, filters when possible).

QA Checks:
- Validate at least 3 source modules end-to-end (treasury, supplier, inventory).

---

### FIN-UI-006: Reversal Chain Visibility in Journal Entry UX
Priority: P0
Type: Frontend
Estimate: 1.5 days
Dependencies: FIN-UI-004

Scope:
- Render explicit reversal chain timeline in entry detail.
- Add quick actions: open original, open reversal, open trace for each chain node.

Primary Files:
- web/src/pages/gl/JournalEntriesPage.tsx
- web/src/components/gl/GlEntryTraceDrawer.tsx

Acceptance Criteria:
- Reversed entries clearly display linkage chain.
- Users can navigate chain nodes without leaving the entry workflow.

QA Checks:
- Use seeded reversed entry set and verify chain order + actions.

---

## P1 Tasks (High Value After P0)

### FIN-UI-007: Batch Posting Output-to-Trace Continuity
Priority: P1
Type: Frontend + Backend enhancement (if job response lacks entry IDs)
Estimate: 2 days
Dependencies: FIN-UI-004

Scope:
- Show resulting journal_entry_id per processed batch item.
- Add row actions: Open Entry, Open Trace.

Primary Files:
- web/src/pages/gl/BatchPostingCenterPage.tsx
- web/src/api/gl.ts

Acceptance Criteria:
- Completed job items expose produced journal entry references.
- User can continue to trace from batch context directly.

---

### FIN-UI-008: Add GL Drill-Down Actions in Supplier/AP Screens
Priority: P1
Type: Frontend
Estimate: 2 days
Dependencies: FIN-UI-004

Scope:
- On supplier balance and AP aging rows, add actions: View related GL entries, View trace where available.

Primary Files:
- web/src/pages/reports/SuppliersBalancePage.tsx
- web/src/pages/treasury/APAgingPage.tsx

Acceptance Criteria:
- Supplier and AP screens offer direct jump to related GL evidence.
- Filters/context are passed so destination is pre-scoped.

---

### FIN-UI-009: Shared Finance Page Composition Pattern
Priority: P1
Type: Frontend UX Standardization
Estimate: 2.5 days
Dependencies: FIN-UI-001

Scope:
- Standardize page structure: Header -> CommandBar -> Filters -> KPI -> Data Grid -> Side Panel.
- Apply to inconsistent pages first (reports and health derivatives).

Primary Files:
- web/src/pages/reports/ReportsPage.tsx
- web/src/pages/reports/SuppliersBalancePage.tsx
- web/src/pages/gl/HealthIntegrityPage.tsx

Acceptance Criteria:
- Targeted pages align with the same interaction skeleton.
- Action locations are consistent across Finance domain pages.

---

### FIN-UI-010: Consolidate Transaction Flow Reference as Shared Component
Priority: P1
Type: Frontend Maintainability
Estimate: 1 day
Dependencies: None

Scope:
- Extract duplicated transaction-flow explanatory UI into one shared GL component.
- Use it in posting health/rules/setup surfaces.

Primary Files:
- web/src/pages/gl/PostingSetupHealthPage.tsx
- web/src/pages/gl/PostingRulesPage.tsx
- web/src/components/gl (new shared component)

Acceptance Criteria:
- Flow reference content has one implementation source.
- Any update propagates consistently to all usages.

---

### FIN-UI-011: Fix Finance Text Encoding and Terminology Consistency
Priority: P1
Type: Frontend Content Quality
Estimate: 1 day
Dependencies: None

Scope:
- Fix mojibake/encoding issues in Arabic finance screens.
- Normalize key domain labels (health, integrity, reconciliation, close).

Primary Files:
- web/src/pages/reports/SuppliersBalancePage.tsx
- web/src/pages/gl/* (copy review)

Acceptance Criteria:
- No visible broken Arabic encoding on finance pages.
- Labels are consistent across nav, headers, and action buttons.

---

## P2 Tasks (Polish + Long-Term Coherence)

### FIN-UI-012: Domain-Aware Breadcrumb Labels
Priority: P2
Type: Frontend UX
Estimate: 1 day
Dependencies: FIN-UI-002

Scope:
- Replace route-segment formatting with route metadata labels for Finance breadcrumbs.

Primary Files:
- web/src/components/shell/Topbar.tsx
- web/src/App.tsx (route metadata source if added)

Acceptance Criteria:
- Breadcrumb labels are user-friendly and business-domain aligned.
- Hyphenated route keys never appear as user-facing crumb labels.

---

### FIN-UI-013: Cross-Screen Deep-Link Context Preservation
Priority: P2
Type: Frontend
Estimate: 2 days
Dependencies: FIN-UI-004, FIN-UI-008

Scope:
- Preserve filter and entity context when navigating Statements -> Ledger -> Entries -> Trace.
- Add return-path affordances for fast analyst workflows.

Primary Files:
- web/src/pages/gl/FinancialStatementsPage.tsx
- web/src/pages/gl/AccountLedgerPage.tsx
- web/src/pages/gl/JournalEntriesPage.tsx

Acceptance Criteria:
- Drill-down chain preserves main context through URL/query-state.
- Back navigation returns user to same scoped view.

---

### FIN-UI-014: Legacy Feature De-Prioritization in GL Settings
Priority: P2
Type: Frontend IA cleanup
Estimate: 0.5 day
Dependencies: FIN-UI-002

Scope:
- Mark legacy/transitional settings as advanced or internal.
- Keep primary settings flow aligned with production operational paths.

Primary Files:
- web/src/pages/gl/GLSettingsPage.tsx

Acceptance Criteria:
- First-time users are guided to production-critical settings.
- Legacy tools remain accessible but not visually dominant.

---

## Suggested Sprint Cut (Immediately Actionable)

Sprint A (7-9 dev days):
- FIN-UI-001
- FIN-UI-002
- FIN-UI-003
- FIN-UI-004
- FIN-UI-006

Sprint B (6-8 dev days):
- FIN-UI-005
- FIN-UI-007
- FIN-UI-008
- FIN-UI-010
- FIN-UI-011

Sprint C (3-4 dev days):
- FIN-UI-009
- FIN-UI-012
- FIN-UI-013
- FIN-UI-014

## Definition of Done (Global)
- TypeScript build passes in web package.
- No route regressions in Finance navigation smoke test.
- Trace action available from Entries, Ledger, Reconciliation.
- At least one end-to-end scenario validated per module: treasury, supplier, inventory.
- UX review sign-off for IA and action consistency.

## Risks and Mitigations
- Risk: Backend payload missing linkage fields for batch/source drill-down.
  Mitigation: Add minimal response extensions behind non-breaking optional fields.
- Risk: Legacy routes still referenced by older docs/user habits.
  Mitigation: Add temporary redirects and in-app deprecation hints.
- Risk: Navigation refactor causes hidden regressions.
  Mitigation: Add route audit checklist and click-through smoke automation.
