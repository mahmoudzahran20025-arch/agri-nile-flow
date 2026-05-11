# 6-Week Hardening Execution TODO
Date: 2026-05-10
Scope: Production-scale accounting hardening
Status: Approved assumptions and ready to execute

## 0) Agreement Check (Current-State Baseline)
The following assumptions are accepted as true and will be treated as hard constraints:
- System is operationally working.
- System is not yet architecturally complete ERP accounting.
- Critical gaps exist now:
  - suppliers missing BPG: 10/10
  - inventory movements missing center_code: 70/700
  - reliance on catch-all plus fallback logic in critical paths

Target in 6 weeks:
- Move from operationally working to controlled accounting platform ready for production scale.
- Enforce posting policy, strict traceability, and single financial truth model (GL-first).

## 1) Non-Negotiables (Must Hold)
- Mandatory BPG/PPG/IPG at write-time and posting-time.
- Remove null/null routing from supplier and purchase paths.
- Disable catch-all in strict mode (allow only guarded migration mode).
- Close critical dimensional gaps before scale.
- GL-first certified financial truth. Fallback can exist only as degraded operational view.

## 2) Workstreams
- WS1: Posting Engine Hardening
- WS2: Dimensional Accounting Enforcement
- WS3: Subledger Architecture Discipline
- WS4: Reporting Truth Unification
- WS5: Controls, Monitoring, and Safe Rollout

## 3) Week-by-Week Execution TODO

### Week 1: Freeze, Baseline, Safety Rails
Owner: Platform + Finance Architecture

TODO:
- Implement posting-rules change freeze policy with approval gate.
- Add auditable change path for posting rules (who/when/why).
- Stand up daily baseline jobs for:
  - posting success rate
  - missing groups coverage
  - dimensional completeness
  - reconciliation drift
- Introduce feature flags:
  - strict_posting_mode
  - report_fallback_mode
  - catch_all_allowed
- Apply no silent fallback policy:
  - any fallback response must include degraded_mode=true
  - all degraded responses must be observable in logs and dashboard

Exit Criteria:
- Every fallback path is tagged and monitored.
- Daily baseline dashboard live.
- No direct rule edits outside audited path.

### Week 2: Posting Groups Enforcement (Core)
Owner: API + Finance Core

TODO:
- Suppliers:
  - make bus_posting_group_code mandatory on create/update
  - block supplier invoice posting if BPG is missing
- Items/Warehouses:
  - enforce prod_posting_group_code for new items
  - enforce inv_posting_group_code for new warehouses
- Resolver wiring:
  - remove null/null routing in supplier and purchase resolver paths
  - always pass effective BPG/PPG/IPG into posting engine
- Data remediation:
  - fix 10 suppliers with missing BPG
  - run PPG quality scan and correction batch

Exit Criteria:
- Supplier BPG coverage = 100%.
- New postings never route through default null/null for required flows.
- Missing mandatory group is blocked at API level.

### Week 3: Catch-all Decommission and Rule Governance
Owner: GL Setup + Governance

TODO:
- In strict mode, disallow catch-all resolution for certified posting.
- Keep catch-all only behind migration/recovery guard flag.
- Add posting_rules governance model:
  - valid_from, valid_to
  - changed_by, change_reason
  - maker-checker approval status
- Add rule integrity checks:
  - reject active rules with null required account slots
  - validate account exists, active, and leaf account

Exit Criteria:
- Strict mode works without catch-all dependency.
- Every rule change is approved and auditable.
- No active critical rule with missing required accounts.

### Week 4: Dimensional Strictness and Subledger Integrity
Owner: Inventory + Ledger

TODO:
- Define dimension policy matrix by transaction type:
  - where center_code is mandatory
  - where season_id and field_id are mandatory
- Remediate 70 historical inventory rows missing center_code using approved mapping policy.
- Enforce uniqueness against duplicate posting at journal layer:
  - uniqueness key for ref_type plus ref_id plus company_id
- Strengthen idempotency at journal_entries level, not outbox-only.
- Enforce trace condition for posted rows:
  - linked JE OR explicit exempt class with reason

Exit Criteria:
- New postings center completeness >= 99.5%.
- Duplicate JE by same business reference = 0.
- Ambiguous posted rows = 0.

### Week 5: Reporting Truth Hardening
Owner: Reporting + Finance Controls

TODO:
- Enforce GL-first financial certification model.
- Keep source-table fallback as operational degraded view only.
- UI separation:
  - Financial Certified
  - Operational Degraded
- If AP mapping is missing:
  - no certified financial output
  - return warning plus degraded badge plus certification_blocked=true
- Automate reconciliation invariant:
  - linked + exempt + unresolved = total
  - auto-incident on drift breach

Exit Criteria:
- No financial endpoint presents fallback data as certified truth.
- Daily reconciliation automation green.
- Any drift creates incident automatically.

### Week 6: Scale Readiness and Go/No-Go
Owner: SRE + Finance Ops + Engineering

TODO:
- Run scale tests:
  - posting concurrency
  - retry/idempotency behavior
  - outbox stress
- Run control drills:
  - rule rollback drill
  - degraded-mode drill
  - reconciliation-failure drill
- Finalize operational readiness pack:
  - runbooks
  - on-call alerts
  - tested rollback plan
- Hold final board:
  - Finance plus Engineering plus Operations sign-off

Mandatory Exit Criteria:
- posting failure rate < 0.2%
- unbalanced JEs = 0
- unresolved actionable = 0
- missing mandatory dimensions on new postings = 0
- supplier BPG coverage = 100%
- no certified financial report depends on fallback path

## 4) Strong Recommendations from Project Context
- Do not switch strict_posting_mode globally on day one. Use shadow mode first, then hard enforcement.
- Treat fallback as an operational continuity mechanism, never as accounting truth.
- Prioritize resolver wiring fixes before broad data remediation to stop new architectural debt.
- Introduce accounting certification pipeline per endpoint:
  - uncertified when degraded_mode=true
  - certified only when GL-first checks pass
- Use weekly kill criteria:
  - if core KPI worsens week-over-week, freeze feature work and remediate architecture first.
- Keep migration/recovery path explicit and temporary with expiry date.

## 5) First 72-Hour Startup Plan
Day 1:
- enable freeze policy for posting rules
- publish baseline metrics query pack
- add degraded_mode flag in all fallback responses

Day 2:
- implement mandatory BPG validation on suppliers create/update
- implement posting block for supplier invoice without BPG
- patch resolver paths to stop null/null routing for supplier flows

Day 3:
- execute supplier BPG remediation batch for all 10 suppliers
- run regression tests for supplier and reporting flows
- publish first hardening checkpoint report

## 6) Definition of Done (Program Level)
Program is done only when:
- policy is enforced in code and database constraints
- controls are measurable and automated
- reporting truth is unified (GL-first)
- architecture can scale without hidden accounting drift

End of document.
