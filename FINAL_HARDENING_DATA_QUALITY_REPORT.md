# Final Hardening and Data Quality Report (Evidence-Based)

Date: 2026-05-10
Scope: company_id = 1 on remote D1 (agri-nile-flow-data-lake)
Method: live SQL snapshots + code-level governance enforcement verification

## 1) Executive Truth

System quality is strong on core posting-group coverage and account linking foundations, but not fully certified for dimensional completeness.

Current objective status:
- Governance objective 1 (block direct posting_rules edits): Implemented in API code path for posting setup routes (now pending-audit only).
- Governance objective 2 (flag-driven catch-all behavior in engine): Implemented in posting engine resolution logic.
- Governance objective 3 (baseline dynamic degraded/blocking): Implemented in hardening baseline API.

Operational truth from live data:
- Posting group coverage is high/complete in required domains.
- Account links for suppliers are complete and leaf-valid.
- Inventory actionable unlinked postings are zero.
- Major remaining quality gap is dimensional completeness (especially season_id / field_id).

## 2) Live Data Evidence (Remote D1)

### 2.1 Coverage and Linkage Strength
- suppliers_total = 10
- suppliers_with_bpg = 10
- suppliers_with_valid_leaf_gl = 10
- items_with_ppg = 4829 / 4829
- warehouses_with_ipg = 9 / 9
- inventory actionable unlinked posted events = 0
- supplier posted unlinked events = 27
- cash posted unlinked events = 0
- supplier_balance_snapshots rows = 10
- supplier drift rows = 0

### 2.2 Rule/Flag State Observed
- active_rules_total = 44
- active general catch-all rules = 1
- active inventory catch-all rules = 1
- active AP control rule = 1
- hardening flags:
  - strict_posting_mode = 0
  - catch_all_allowed = 1
  - report_fallback_mode = 1
- posting_rules_audit:
  - total = 2
  - pending = 0 (at snapshot time)
- idempotency uniqueness index present: uq_be_posting_source_exists = 1

### 2.3 Data Completeness Gaps (Primary Remaining Risk)
- issue_missing_season = 611
- issue_missing_season_linked = 576
- movement-level missing dimensions:
  - ISSUE missing season = 611
  - GRN missing season = 19
  - consumption_transactions missing season = 69
  - consumption_transactions missing field = 69
  - inventory_movements missing field = 700
  - inventory_movements missing season = 630
- supplier transactions with missing financial account = 43

Interpretation:
- Most posting and linking mechanics are functioning.
- The dominant risk is dimensional metadata incompleteness, not missing chart-link structure.

## 3) Account-Link Precision Checks

### 3.1 Passed Checks
- Supplier-level GL links exist and map to leaf accounts.
- AP control mapping is active.
- Inventory rules do not show active missing inventory-account slots.
- General rules do not show active missing required slot patterns.

### 3.2 Risks Still Present
- Posted but unlinked supplier events (27) indicate non-zero reconciliation tail.
- Missing financial account on supplier transactions (43) can create posting ambiguity.
- Active catch-all rules remain in configuration; runtime is now flag-controlled, but policy still depends on strict flag posture.

## 4) Governance Controls Implemented in Code

### 4.1 No Direct posting_rules Mutation from Setup Endpoints
Implemented: create/update setup endpoints now create pending audit records instead of direct INSERT/UPDATE to posting_rules.

Evidence file:
- [src/api/gl/posting-setup.ts](src/api/gl/posting-setup.ts)

Expected behavior:
- API returns pending approval workflow response.
- Actual posting_rules state changes should occur only after approval flow.

### 4.2 Catch-All Resolution Bound to Flags in Posting Engine
Implemented: null/null catch-all candidate in general/inventory resolution is skipped when strict_posting_mode is ON and catch_all_allowed is OFF.

Evidence file:
- [src/lib/posting_engine.ts](src/lib/posting_engine.ts)

### 4.3 Baseline Meta Reflects Real Degraded/Blocking State
Implemented: baseline endpoint now computes certification_status dynamically using live health metrics and pending audit count.

Evidence file:
- [src/api/gl/hardening.ts](src/api/gl/hardening.ts)

### 4.4 Approval Applies Change + Clears Engine Caches
Implemented: approve endpoint now applies approved posting_rules_audit changes to posting_rules and clears posting-engine caches.

Evidence file:
- [src/api/gl/hardening.ts](src/api/gl/hardening.ts)

## 5) Data Quality Improvement Plan (No New Accounting Entries)

Constraint honored: no creation of new journal entries purely for cleanup.

### 5.1 Dimension Repair (Highest Priority)
- Backfill season_id and field_id on source operational records where deterministically derivable.
- Prioritize records that are already posted and linked (e.g., ISSUE linked rows with missing season).
- Record provenance in audit columns (or dedicated repair log) for each repaired row.

### 5.2 Supplier Financial Account Completeness
- For supplier_transactions missing financial_account_id, backfill from supplier default payable linkage where deterministic.
- For ambiguous cases, route to exception queue for accountant decision (no auto-posting).

### 5.3 Unlinked Posted Supplier Events (27)
- Reconcile source dimensions and account mapping metadata for each event.
- Re-run deterministic linking pipeline only; do not generate additional accounting lines.

### 5.4 Catch-All Policy Hardening
- Move runtime posture to strict mode for controlled rollout:
  - strict_posting_mode = 1
  - catch_all_allowed = 0
- Keep temporary override process documented with explicit approval reason and expiry.

## 6) UI/UX Requirements to Prevent Recurrence

### 6.1 Mandatory Dimensions at Capture Time
- Block save/post when season or field is required by transaction type and absent.
- Show inline blocking error with exact missing dimension names.
- Support conditional requirement matrix by movement type (ISSUE, GRN, consumption).

### 6.2 Explainability Panels in Posting and Reports
- Expose resolved account source (direct rule vs fallback) and rule identifier.
- Surface certification and degraded reason directly on report headers.
- Show pending governance changes count and strict mode status in hardening dashboard.

### 6.3 Exception Workbench
- Add a focused list for:
  - posted but unlinked events
  - missing financial account
  - missing mandatory dimensions
- Include bulk-resolve actions with maker-checker workflow hooks.

## 7) Residual Risks

- If strict_posting_mode remains OFF and catch_all_allowed remains ON, catch-all can still mask mapping defects.
- Pending-audit-only setup enforcement is implemented at API route level; any other mutation path must be reviewed and aligned.
- Data completeness repair requires careful deterministic rules to avoid incorrect dimension imputation.

## 8) Certification Decision

Decision: Not fully certified yet.

Reason:
- Core account-link architecture is largely healthy.
- However, dimensional completeness defects are material (season/field gaps), and there is a remaining tail of posted supplier events not linked.

Target state for full certification:
- Zero material missing required dimensions on posted records.
- Zero posted-unlinked supplier events.
- strict_posting_mode ON and catch_all_allowed OFF in steady state.
- Pending audit queue operational with no direct mutation bypass.

## 9) Immediate Next Verification Checklist

1. Run live SQL after deployment of these API changes to confirm:
   - posting setup routes generate pending audit records only.
   - no direct posting_rules update path remains for those endpoints.
2. Approve a test pending change and verify:
   - posting_rules updated exactly once.
   - posting_engine caches invalidated and fresh resolution used.
3. Execute dimension-gap repair dry run and validate row counts before/after.
4. Recompute baseline meta and report certification status transition evidence.
