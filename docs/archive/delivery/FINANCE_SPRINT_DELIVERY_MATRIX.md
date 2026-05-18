# Finance Module Sprint Delivery Matrix

## Scope
- Module: Finance / General Ledger only
- Objective: Ship enterprise-grade Finance UX with full exposure of backend capabilities
- Source baseline: current Finance legacy/new audit and blueprint

## Sprint Plan (6 weeks)

| Sprint | Focus | Primary Screens | Outcome |
|---|---|---|---|
| Sprint 1 (Weeks 1-2) | Foundation and high-risk controls | Finance Home, Health and Integrity, GL Entries and Trace | Unified control plane, integrity visibility, trace drill-down |
| Sprint 2 (Weeks 3-4) | Posting and reconciliation operations | Posting Setup, Reconciliation Workbench, Period Close Cockpit | Configurability and close-readiness workflows |
| Sprint 3 (Weeks 5-6) | Reporting and scale operations | Financial Statements, Supplier Balance, Batch Posting Center | Executive-grade reporting and queue operations |

---

## Screen 1: Finance Home / Control Tower

### User Stories
- FIN-001: As a Finance Controller, I need one home view of integrity, period status, and posting readiness so I can decide if daily operations are safe.
- FIN-002: As a Chief Accountant, I need alert-driven drill links so I can move from symptom to root issue in one click.

### Acceptance Criteria
- Shows cards for integrity score, open period status, pending batch jobs, and posting setup readiness.
- Each alert card links to a specific downstream screen with pre-applied filter context.
- Refresh updates all widgets within one action and preserves current filter state.
- If any blocker exists, banner shows blocker count and highest severity.

### API Contracts
- GET /api/gl/integrity-check
  - Response: { success, health_score, summary, checks[] }
- GET /api/gl/system-integrity-score
  - Response: { success, overall_score, metrics, status }
- GET /api/gl/posting-setup/health
  - Response: { success, groups, setup, entities, issues[], warnings[], is_ready }
- GET /api/gl/batch-post/jobs?page=&size=&status=
  - Response: { success, data[], total, page, page_size }
- GET /api/gl/periods
  - Response: { success, data[] }

---

## Screen 2: Health and Integrity

### User Stories
- FIN-010: As an Auditor, I need issue lanes by severity so I can prioritize fixes.
- FIN-011: As a Finance Operator, I need direct links from each integrity issue to affected entries.

### Acceptance Criteria
- Tabs or filters for critical, high, and medium findings.
- Supports compact mode and detailed mode (detailed=1).
- Each issue row exposes action link and affected count.
- Exports issue list to CSV.

### API Contracts
- GET /api/gl/integrity-check?detailed=0|1
  - Response: { success, health_score, summary, checks[] }
- GET /api/gl/audit-log?page=&size=&table=&action=&from=&to=
  - Response: { success, data[], total, page, page_size }

---

## Screen 3: GL Entries and Trace

### User Stories
- FIN-020: As a GL Accountant, I need fast filtering of journal entries by date and source.
- FIN-021: As a Finance Analyst, I need to see full trace (source doc, business event, posting rule) for any entry.
- FIN-022: As a Senior Accountant, I need controlled reversal with reason and audit trail.

### Acceptance Criteria
- Entries grid supports paging, date filter, and ref_type filter.
- Selecting an entry opens detail panel with journal lines and totals.
- Trace panel shows source_event, source_document, and posting_rule_trace if available.
- Reverse action requires reason and returns reversal_entry_id.
- If entry is already reversed, action is disabled and message shown.

### API Contracts
- GET /api/gl/entries?page=&size=&start=&end=&ref_type=
  - Response: { success, data[], total, page, page_size }
- GET /api/gl/entries/:id
  - Response: { success, data: { entry fields, lines[] } }
- GET /api/gl/entries/:id/trace
  - Response: { success, data: { entry, lines[], trace, source_event, source_document, has_trace } }
- POST /api/gl/entries/:id/reverse
  - Request: { reason }
  - Response: { success, data: { reversal_entry_id, reversed_entry_id, lines_count, total_debit, total_credit } }

---

## Screen 4: Posting Setup

### User Stories
- FIN-030: As a Finance Admin, I need to maintain posting groups and posting rules safely.
- FIN-031: As an Implementer, I need transaction simulation before activating rules.

### Acceptance Criteria
- Supports CRUD for business/product/inventory posting groups.
- Supports CRUD for general and inventory posting setup rows.
- Prevents deactivation of groups used by active rules.
- Simulation panel shows resolved accounts and validation errors before save.
- Readiness indicator is visible on page header.

### API Contracts
- GET /api/gl/posting-groups/:type
- POST /api/gl/posting-groups/:type
  - Request: { code, name, description? }
- PATCH /api/gl/posting-groups/:type/:code
  - Request: { name?, description?, is_active? }
- GET /api/gl/posting-setup/general
- POST /api/gl/posting-setup/general
- PATCH /api/gl/posting-setup/general/:id
- GET /api/gl/posting-setup/inventory
- POST /api/gl/posting-setup/inventory
- PATCH /api/gl/posting-setup/inventory/:id
- GET /api/gl/posting-rules?rule_type=&active=&mapping_key=&page=&size=
- POST /api/gl/posting-setup/validate
  - Request: { type, bpg_code?, ppg_code?, ipg_code?, ap_code?, cash_code?, receivable_code?, amount? }
  - Response: { lines[], validationErrors[], warnings[], isBlocked }

---

## Screen 5: Reconciliation Workbench

### User Stories
- FIN-040: As a Reconciliation Officer, I need to detect mismatches between source documents, events, and journal links.
- FIN-041: As a Supervisor, I need a summary of mismatch categories for daily control.

### Acceptance Criteria
- Grid supports filters by source_module, status, date range, mismatch_only.
- Summary bar shows counts by reconciliation_status category.
- Row detail panel shows source document, event, and linked journal entry.
- Can deep-link into GL entry trace from a row.

### API Contracts
- GET /api/gl/reconciliation/source-documents?page=&size=&source_module=&status=&from=&to=&mismatch_only=1
  - Response: { success, data[], total, page, page_size, summary }

---

## Screen 6: Account Ledger

### User Stories
- FIN-050: As an Accountant, I need running balances and opening balance context per account.
- FIN-051: As an Analyst, I need to pivot quickly from ledger line to source trace.

### Acceptance Criteria
- Supports date filters and pagination.
- Shows opening balance and running balance per line.
- Shows debit/credit totals and net closing at footer.
- Entry id links to entry details and trace.
- CSV export respects applied filters.

### API Contracts
- GET /api/gl/ledger/:account?start=&end=&center=&leaf=&page=&size=
  - Response: { success, account, opening, lines[], total, page, page_size }

---

## Screen 7: Financial Statements

### User Stories
- FIN-060: As CFO, I need trial balance, income statement, and balance sheet in one consistent shell.
- FIN-061: As Controller, I need drill-through from report rows to ledger and entries.

### Acceptance Criteria
- Single shared filter bar and tab pattern across all three statements.
- Trial balance flags imbalance status clearly.
- Report rows drill to account ledger with carried filter context.
- Export works per active tab.

### API Contracts
- GET /api/gl/trial-balance?as_of=
- GET /api/gl/trial-balance-fast?as_of=
- GET /api/gl/income-statement?start=&end=
- GET /api/gl/balance-sheet?as_of=

---

## Screen 8: Supplier Balance (Finance View)

### User Stories
- FIN-070: As AP Lead, I need ranked supplier exposure and payment history impact.
- FIN-071: As Accountant, I need direct navigation from supplier balances to supporting ledger movements.

### Acceptance Criteria
- Supports season filter, sorting, and CSV export.
- Shows debit/credit/balance with clear polarity labels.
- Selecting supplier opens detailed ledger/payments context.

### API Contracts
- GET /api/reports/suppliers-balance?season_id=
  - Response: [{ code, name, activity, total_credit, total_debit, balance, last_balance, tx_count }]
- GET /api/reports/supplier-payments?supplier_code=&season_id=
  - Response: { data[], summary[] }

---

## Screen 9: Period Close Cockpit

### User Stories
- FIN-080: As Period Close Manager, I need a checklist of blockers before closing.
- FIN-081: As Finance Admin, I need to close/reopen periods with confidence and auditability.

### Acceptance Criteria
- Shows close readiness score and blocker list.
- Close action blocked if critical blockers exist.
- Reopen action available with warning message and audit event.
- All blockers link to filtered destination lists.

### API Contracts
- GET /api/gl/periods
- PATCH /api/gl/periods/:id/close
- PATCH /api/gl/periods/:id/reopen
- GET /api/gl/integrity-check
- GET /api/gl/reconciliation/source-documents?mismatch_only=1

---

## Screen 10: Batch Posting Center

### User Stories
- FIN-090: As Finance Operations, I need to enqueue and monitor batch posting jobs.
- FIN-091: As Support Engineer, I need item-level errors and retry controls.

### Acceptance Criteria
- Job list supports status filtering and pagination.
- Job details show item statuses (pending/processing/completed/failed).
- Can claim next, process, cancel, and retry failed items/jobs.
- Success and failure counts update live after process call.

### API Contracts
- POST /api/gl/batch-post/jobs
  - Request: { event_type, source_module, priority?, payload?, items: [{ source_id, payload? }] }
  - Response: { success, data: { job_id } }
- GET /api/gl/batch-post/jobs?page=&size=&status=
- GET /api/gl/batch-post/jobs/:id
- PATCH /api/gl/batch-post/jobs/:id/status
  - Request: { status, last_error? }
- POST /api/gl/batch-post/jobs/claim-next
- POST /api/gl/batch-post/jobs/:id/process
  - Request: { max_items? }
  - Response: { success, data: { processed, failed, errors[] } }

---

## Delivery Backlog Matrix (Priority and Effort)

| ID | Item | Type | Priority | Effort | Sprint |
|---|---|---|---|---|---|
| FIN-EPIC-01 | Finance Home / Control Tower | new | P0 | M | 1 |
| FIN-EPIC-02 | Health and Integrity | new | P0 | M | 1 |
| FIN-EPIC-03 | GL Entries trace drawer and reversal hardening | upgrade | P0 | M | 1 |
| FIN-EPIC-04 | Posting Setup simulator + governance polish | upgrade | P0 | M | 2 |
| FIN-EPIC-05 | Reconciliation Workbench | new | P0 | L | 2 |
| FIN-EPIC-06 | Period Close Cockpit | new | P1 | M | 2 |
| FIN-EPIC-07 | Financial Statements unified drill model | upgrade | P1 | M | 3 |
| FIN-EPIC-08 | Supplier Balance finance integration | upgrade | P1 | M | 3 |
| FIN-EPIC-09 | Batch Posting Center | new | P0 | L | 3 |
| FIN-EPIC-10 | Legacy route cleanup and endpoint contract cleanup | kill | P0 | S | 1 |

---

## Definition of Done (Finance)
- Every Finance screen uses unified shell pattern (command bar, filters, grid, detail panel).
- Every critical row supports drill to trace when lineage exists.
- No frontend calls remain to legacy-only GL endpoints.
- P0 screens have happy-path and failure-path QA scenarios documented.
- Security and role guards are verified for accountant, company_admin, super_admin, auditor.















Sprint-by-sprint implementation plan

Sprint 1 (Weeks 1-2): Foundation + controls
Primary epics: FIN-EPIC-01, FIN-EPIC-02, FIN-EPIC-03, FIN-EPIC-10

Frontend tasks
Build Finance Home page (Control Tower) and route wiring.
Epic: FIN-EPIC-01
Tasks:
Add page component under pages for Finance Home.
Add route in App.tsx:166 for finance home entry.
Add sidebar entry update in Sidebar.tsx:109 to prefer the new screen as Finance landing.
Reuse unified shell pattern from CommandBar.tsx, KpiStrip.tsx, SectionCard.tsx.
Build Health and Integrity screen.
Epic: FIN-EPIC-02
Tasks:
New page with severity lanes, compact/detailed toggle, CSV export.
Reuse existing audit path and integrate finance-focused filters.
Wire deep links to entries and trace pages.
Upgrade GL Entries with trace drawer flow.
Epic: FIN-EPIC-03
Tasks:
Extend JournalEntriesPage.tsx with right-side trace drawer and source lineage tabs.
Reuse entry detail query + add trace query composition.
Keep reversal flow in-page with robust disable states.
Remove legacy endpoint usage in screens touched by Sprint 1.
Epic: FIN-EPIC-10
Tasks:
Replace legacy score call usage from gl.ts:171 if it points to non-modular contracts.
Enforce all Sprint 1 screens to use canonical modular contracts only.
Add typed response guards around integrity and entries trace payloads.
Backend tasks
Normalize integrity contracts for one canonical shape.
Epic: FIN-EPIC-02, FIN-EPIC-10
Tasks:
Standardize response keys for integrity-check and system-integrity-score.
Ensure detailed flag behavior is consistent and documented.
Harden entries trace and reversal behavior.
Epic: FIN-EPIC-03
Tasks:
Confirm trace payload always includes nullable source_event/source_document fields.
Ensure reversal endpoint returns deterministic error codes for already-reversed and period-closed cases.
Confirm canonical /api/gl route paths.
Epic: FIN-EPIC-10
Tasks:
Verify modular route mounting in index.ts does not expose duplicated path segments.
Normalize to canonical paths used by frontend contracts.
Cross-cutting tasks
Create finance query hooks package.
Epic: FIN-EPIC-01, FIN-EPIC-02, FIN-EPIC-03
Tasks:
Add hooks folder under src for useGlIntegrity, useGlEntries, useGlEntryTrace.
Centralize invalidation keys and loading/error state patterns.
Unify alert-to-drill navigation contract.
Epic: FIN-EPIC-01
Tasks:
Add route-state helper for filter propagation from cards to detail pages.
Sprint 2 (Weeks 3-4): Posting + reconciliation operations
Primary epics: FIN-EPIC-04, FIN-EPIC-05, FIN-EPIC-06

Frontend tasks
Upgrade Posting Setup with simulator workbench.
Epic: FIN-EPIC-04
Tasks:
Extend PostingSetupPage.tsx with simulation side panel and cascade-step explanation.
Merge the strongest reference UX patterns from PostingRulesPage.tsx and PostingSetupHealthPage.tsx.
Build Reconciliation Workbench.
Epic: FIN-EPIC-05
Tasks:
New grid screen with summary KPIs, mismatch filters, row detail panel, trace deep-link.
Build Period Close Cockpit.
Epic: FIN-EPIC-06
Tasks:
New checklist screen with readiness score, blocker cards, close/reopen controls.
Integrate deep links to mismatches and integrity findings.
Backend tasks
Reconciliation summary hardening.
Epic: FIN-EPIC-05
Tasks:
Ensure summary buckets are complete and stable for dashboard cards.
Add consistent reconciliation_status enum in payload docs.
Posting validate contract hardening.
Epic: FIN-EPIC-04
Tasks:
Ensure stable schema for warnings, validationErrors, lines, and trace hints.
Period close safeguards.
Epic: FIN-EPIC-06
Tasks:
Ensure close endpoint enforces blockers (or returns precondition failures) consistently.
Cross-cutting tasks
Shared finance data grid primitives.
Epic: FIN-EPIC-04, FIN-EPIC-05, FIN-EPIC-06
Tasks:
Standardize filter bar, saved filter model, export action model.
Sprint 3 (Weeks 5-6): Reporting + scale operations
Primary epics: FIN-EPIC-07, FIN-EPIC-08, FIN-EPIC-09

Frontend tasks
Upgrade Financial Statements to unified drill model.
Epic: FIN-EPIC-07
Tasks:
Extend FinancialStatementsPage.tsx with consistent row drill to ledger and entries.
Prefer fast trial balance endpoint where appropriate.
Upgrade Supplier Balance to finance-integrated view.
Epic: FIN-EPIC-08
Tasks:
Upgrade SuppliersBalancePage.tsx into finance shell pattern.
Add linked supplier ledger/payments detail flow.
Build Batch Posting Center.
Epic: FIN-EPIC-09
Tasks:
New queue screen: list, details, process actions, retry/cancel control, error panel.
Backend tasks
Batch processing operation hardening.
Epic: FIN-EPIC-09
Tasks:
Ensure idempotent process behavior and deterministic per-item failure structures.
Confirm status transitions are validated server-side.
Reporting consistency.
Epic: FIN-EPIC-07, FIN-EPIC-08
Tasks:
Standardize pagination and export behavior across report endpoints used by finance screens.
Cross-cutting tasks
QA scenario implementation against DoD.
Epic: FIN-EPIC-07, FIN-EPIC-08, FIN-EPIC-09
Tasks:
Add screen-level happy path + failure path checklists and smoke scripts.
Legacy & API contracts checklist

A) Legacy routes/endpoints to remove, hide, or block after migration
Hide Finance navigation access to classifier flow.
Route: App.tsx:178 path /gl/classifier
Action: remove from finance navigation, keep admin-only migration access if needed.
Collapse standalone legacy integrations route into Finance Home governance cards.
Route: App.tsx:179 path /gl/integrations
Action: remove primary-nav exposure, keep backward redirect to new destination.
Remove frontend dependency on legacy-only integrity score contracts.
Current client call location: gl.ts:171
Action: replace with canonical modular endpoint contracts only.
Remove duplicate/legacy posting health page concepts from routing surface.
Legacy-style page: PostingSetupHealthPage.tsx
Action: preserve useful UX blocks but stop exposing duplicate route behavior.
B) Endpoint status against spec
Exists and usable now
/api/gl/integrity-check
/api/gl/audit-log
/api/gl/entries
/api/gl/entries/:id
/api/gl/entries/:id/trace
/api/gl/entries/:id/reverse
/api/gl/posting-groups/:type
/api/gl/posting-setup/general
/api/gl/posting-setup/inventory
/api/gl/posting-rules
/api/gl/posting-setup/health
/api/gl/posting-setup/validate
/api/gl/reconciliation/source-documents
/api/gl/batch-post/jobs and related job endpoints
/api/gl/periods close/reopen
/api/reports/suppliers-balance
/api/reports/supplier-payments
Exists but needs adjustment/normalization
/api/gl/system-integrity-score
/api/gl/ledger/:account contract shape and pagination consistency
/api/gl/trial-balance and /api/gl/trial-balance-fast consistent response schema
/api/gl/income-statement and /api/gl/balance-sheet consistent totals block
Must verify and normalize route mount behavior
Modular mount in index.ts should expose canonical paths exactly as spec, no duplicated path segments.
C) Contracts hardening checklist
Validation
Enforce strict query validation for page, size, date ranges, enums, and IDs.
Return 422 for semantic validation issues, 400 for malformed requests.
Error shape
Standard error envelope for all finance APIs:
success false
error code
message
details optional array
Pagination
Standard paginated response:
data
total
page
page_size
has_more optional
Security and role guards
Ensure roleGuard parity for accountant, company_admin, super_admin, auditor (where relevant).
Verify audit logging on all mutating endpoints.
Contract typing
Align frontend TypeScript interfaces in gl.ts and reports.ts with backend payload reality.
Trace drill consistency
Guarantee nullable lineage fields always present for predictable UI rendering.
Screen-by-screen execution notes

1) Finance Home / Control Tower
Final UI structure
Header, command bar, KPI strip, alert cards, operational widgets, quick drill actions.
API calls
GET /api/gl/integrity-check
GET /api/gl/system-integrity-score
GET /api/gl/posting-setup/health
GET /api/gl/batch-post/jobs
GET /api/gl/periods
Open questions
Final source of truth for integrity score card: integrity-check score vs system-integrity-score overall_score.
2) Health and Integrity
Final UI structure
Severity tabs, issue grid, summary chips, detailed toggle, export action.
API calls
GET /api/gl/integrity-check?detailed=0|1
GET /api/gl/audit-log
Open questions
Need explicit mapping from check key to destination route for every check type.
3) GL Entries and Trace
Final UI structure
Entries table, detail drawer, trace drawer with lineage tabs, reversal modal.
API calls
GET /api/gl/entries
GET /api/gl/entries/:id
GET /api/gl/entries/:id/trace
POST /api/gl/entries/:id/reverse
Open questions
Should trace drawer include raw payload JSON view for auditors by role.
4) Posting Setup
Final UI structure
Tabs for groups/rules/setup, matrix tables, simulation side panel, readiness indicator.
API calls
posting-groups CRUD
posting-setup general/inventory CRUD
GET posting-rules
POST posting-setup/validate
Open questions
Confirm whether control-rule editing is in this screen or read-only in v1.
5) Reconciliation Workbench
Final UI structure
Filter bar, reconciliation grid, mismatch summary bar, row detail panel.
API calls
GET /api/gl/reconciliation/source-documents
Open questions
Do we expose repair actions in v1 or read-only diagnostics only.
6) Account Ledger
Final UI structure
Date filter bar, KPI summary, running-balance table, pagination footer.
API calls
GET /api/gl/ledger/:account
Open questions
Confirm account lookup metadata returned inline vs separate account endpoint call.
7) Financial Statements
Final UI structure
Shared filter bar, tabs for TB/IS/BS, drill-through rows, export.
API calls
GET /api/gl/trial-balance
GET /api/gl/trial-balance-fast
GET /api/gl/income-statement
GET /api/gl/balance-sheet
Open questions
Policy for when fast trial balance diverges from full trial balance calculation.
8) Supplier Balance
Final UI structure
Filterable/sortable supplier exposure grid, KPI cards, detail drill links.
API calls
GET /api/reports/suppliers-balance
GET /api/reports/supplier-payments
Open questions
Confirm whether supplier detail should pivot to supplier module page or finance-native drawer.
9) Period Close Cockpit
Final UI structure
Readiness score panel, blocker checklist, close/reopen action rail.
API calls
GET /api/gl/periods
PATCH /api/gl/periods/:id/close
PATCH /api/gl/periods/:id/reopen
GET /api/gl/integrity-check
GET /api/gl/reconciliation/source-documents?mismatch_only=1
Open questions
Need explicit close precondition policy: hard-block vs warning override.
10) Batch Posting Center
Final UI structure
Jobs queue grid, job detail panel, item error table, process controls.
API calls
POST /api/gl/batch-post/jobs
GET /api/gl/batch-post/jobs
GET /api/gl/batch-post/jobs/:id
PATCH /api/gl/batch-post/jobs/:id/status
POST /api/gl/batch-post/jobs/claim-next
POST /api/gl/batch-post/jobs/:id/process
Open questions
Clarify whether UI should expose claim-next/process in production role scopes or admin only.
Next 2-3 days task list (very concrete, Sprint 1 only)

Day 1 morning: Route and shell setup for FIN-EPIC-01

Add Finance Home page file under pages and wire route in App.tsx:166.

Update finance navigation in Sidebar.tsx:109 to point Finance landing to new screen.

Reuse existing shell primitives from CommandBar.tsx, KpiStrip.tsx, SectionCard.tsx.

Day 1 afternoon: Add Sprint 1 data hooks and API alignment (FIN-EPIC-01, FIN-EPIC-02, FIN-EPIC-10)

Create finance hooks folder under src for:

useGlIntegrity
useGlIntegrityScore
usePostingHealth
useBatchPostJobs
Refactor gl.ts to remove or isolate legacy-only integrity score calls and align to canonical modular endpoints.

Add normalized frontend response types for integrity score/check and entries trace.

Day 2 morning: Implement Health and Integrity screen (FIN-EPIC-02)

Add page file under pages for Health and Integrity.

Build severity filters, detailed toggle, CSV export, row action links.

Wire to:

/api/gl/integrity-check
/api/gl/audit-log
Day 2 afternoon: Implement GL Entries trace drawer (FIN-EPIC-03)
Extend JournalEntriesPage.tsx with:
Trace drawer component
Source event/doc tabs
Reversal modal state hardening
Add reusable Trace drawer component under components for future reuse in ledger/reconciliation.

Day 3: Legacy cleanup and endpoint contract checks (FIN-EPIC-10)

Remove primary-nav access to classifier and standalone integrations paths in Sidebar.tsx:109.

Add redirect/deprecation handling in App.tsx:166 for legacy routes touched in Sprint 1.

Backend pass on index.ts, integrity.ts, entries.ts to ensure response consistency and canonical path behavior.

Run targeted type-check for frontend API clients and touched pages, then full check after endpoint alignment.