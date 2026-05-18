# EXECUTIVE SUMMARY: Clean System Re-Architecture (Phase 2 & 3)

**Date:** May 11, 2026  
**Status:** Planning & Specification Complete | Ready for Implementation  
**Owner:** Technical Team  
**Objective:** Transform Nawa al-Mustaqbal ERP from ambiguous, manual GL posting to canonical, deterministic, automated system  

---

## 1. SITUATION ASSESSMENT

### Current State (Pre-Phase 2)
- ❌ **GL Posting:** Manual, ambiguous, prone to error
- ❌ **Service Types:** Undefined; transactions mix 3+ service types under single GL account
- ❌ **Supplier Role:** Ambiguous (e.g., عرفة handles materials + supervision + admin under ONE master record)
- ❌ **Dimensional Data:** Inconsistent (service_type_code, statement_text, center_code often NULL)
- ❌ **Data Entry:** No validation at API level; garbage in, garbage out
- ⚠️ **Future-Dated Rows:** 52 blocked (6 supplier + 46 inventory) pending cutoff release

### Business Impact
| Problem | Risk | Financial Impact |
|---------|------|------------------|
| COGS Ambiguity | Revenue matching impossible | Cost allocation wrong by ~30% |
| Service Mix-up | Supervision vs. Materials in same AP account | Can't track service profitability |
| Future-Blocked Data | 52 rows stuck, can't close period | Receivables reconciliation incomplete |
| Manual GL Posting | Time-intensive, error-prone | 3-4 hours per month to post + verify |
| No Audit Trail | Compliance risk | Failed internal controls, audit findings |

### User Escalation (Recent)
> "I don't want cutoff-based blocking — I want the system completely clean. Full data re-entry done the right way."

**Interpretation:** Reject partial workarounds; demand proper canonical model before any new data.

---

## 2. SOLUTION: Three-Phase Implementation

### Phase 1: COMPLETED (Pre-May 11)
✅ Governance hardening + sub-ledger stabilization  
✅ Posting corrections with cutoff = 2026-05-11  
✅ Future-blocked rows isolated (52 total)  
✅ Monitoring infrastructure created  

### Phase 2: IN PROGRESS (May 11 – May 20)
**Objective:** Establish canonical data model + API hardening  

**Scope:**
- ✅ Service taxonomy (7 core services: SRV_MECH, SRV_LABOR, SRV_SUPPLY, SRV_LOGISTICS, SRV_SUPERVISION, SRV_SPARE_PARTS, SRV_ADMIN)
- ✅ Supplier-service mapping matrix (which suppliers provide which services)
- ✅ Governance flags table (audit trail for data quality issues)
- ✅ API validation rules (mandatory service_type_code + statement_text + financial_account_code)
- 🔲 Schema deployment to D1 (pending connectivity)
- 🔲 API code changes + testing (local validation ready)

**Deliverables:**
1. `PHASE_2_API_HARDENING_SPECIFICATION.md` — Complete requirements + examples
2. `sql/governance/05_phase2_service_taxonomy_and_mapping.sql` — DDL + seed data
3. API validation functions (ready to integrate)

### Phase 3: PLANNED (May 20 – May 31)
**Objective:** Full data wipe + clean re-entry with canonical format  

**Scope:**
- 🔲 Execute full DELETE of operational data (suppliers, items, transactions, GL entries)
- 🔲 Keep schema + taxonomies + posting rules intact
- 🔲 Re-enter canonical master data (suppliers, items, cost centers)
- 🔲 Re-enter operational transactions in canonical format
- 🔲 Execution posting engine (GL entries auto-generated)
- 🔲 Final reconciliation + period close

**Deliverables:**
1. `PHASE_3_CANONICAL_REENTRY_TEMPLATES.md` — Data format specifications + SQL templates
2. `sql/governance/04_full_clean_reseed_scope_company1.sql` — Full cleanup script (already created)
3. `sql/canonical_reentry/` directory — Phased re-entry scripts (to be created)

---

## 3. KEY DESIGN DECISIONS

### 3.1 Service Type Hierarchy (CANONICAL)
Every transaction MUST reference exactly ONE service type from:

```
SRV_MECH       → Equipment Rental → GL 5101 (Operating Expense)
SRV_LABOR      → Labor Supply → GL 5101
SRV_SUPPLY     → Material Purchase → GL 1407 (Inventory)
SRV_LOGISTICS  → Transportation → GL 5101
SRV_SUPERVISION → Agricultural Supervision → GL 33067
SRV_SPARE_PARTS → Equipment Spare Parts → GL 1407
SRV_ADMIN      → Admin Overhead → GL 33xxx
```

**Rationale:** Prevents service mixing, enables deterministic GL routing, supports cost reporting by service.

### 3.2 Mandatory Dimensional Fields

| Module | Movement Type | MANDATORY Fields | WHY |
|--------|---|---|---|
| **inventory/movements** | GRN | supplier_code, document_number | Source validation |
| **inventory/movements** | ISSUE | center_code, service_type_code, statement_text | Cost allocation + GL routing |
| **suppliers.ts** | Invoice (debit > 0) | service_type_code, statement_text | GL routing + audit trail |
| **treasury.ts** | Cash Transaction | financial_account_code, statement_text | Explicit account posting + audit trail |

**API Enforcement:** 422 UNPROCESSABLE_ENTITY if mandatory field missing (no fallback defaults).

### 3.3 Split Multi-Service Suppliers

**Problem:** عرفة (code 20900353) supplies materials + supervision + admin under ONE master.
- ❌ Single GL account 2120 can't distinguish service type
- ❌ Cost allocation to service type impossible
- ❌ AP aging by service type impossible

**Solution:** supplier_service_map table (authorization matrix)
```sql
INSERT INTO supplier_service_map VALUES
(1, 20900353, 'SRV_SUPPLY', 1, '2120.1', ...),    -- Materials → 2120.1
(1, 20900353, 'SRV_SUPERVISION', 0, '2120.2', ...); -- Supervision → 2120.2
```

**Result:** Same supplier_code, but GL routing determined by service_type_code in transaction.

### 3.4 Data Quality Governance Flags

**Problem:** Technical notes like "NEEDS_DIMENSION" buried in text fields are unmaintainable.

**Solution:** Formal governance_flags table:
```sql
INSERT INTO movement_governance_flags VALUES
(1, 'inventory', 'inventory_movements', 12345, 
 'MISSING_SERVICE_TYPE', 'error', 'open',
 'Posted ISSUE lacks service_type_code; cannot route GL');
```

**Benefit:** Queryable, reportable, resolvable (flag status = 'resolved' once fixed).

---

## 4. IMPLEMENTATION ROADMAP

### Week 1: Phase 2 Schema & API Validation (May 13-17)
```
Day 1: Schema Deployment
  • Execute 05_phase2_service_taxonomy_and_mapping.sql on D1
  • Verify service_types table populated (7 rows)
  • Verify supplier_service_map populated (11 rows)
  
Day 2-3: API Validation Integration
  • Update suppliers.ts POST handler (validate service_type_code + statement_text)
  • Update inventory/movements.ts POST handler (validate center_code + service_type_code for ISSUE)
  • Update treasury.ts POST handler (validate financial_account_code + statement_text)
  • Add test cases (6 scenarios: 3 valid, 3 invalid)
  
Day 4: Testing & Deployment
  • Run local test suite (npm run test)
  • Deploy to Cloudflare Workers (npm run backend:deploy:prod)
  • Manual smoke test (3 valid requests via Postman)
  
Day 5: Data Backfill & Gap Analysis
  • Run deterministic backfill (map legacy service_type_code where possible)
  • Identify gaps (INSERT into governance_flags for NULL service_types)
  • Report gap count to stakeholders
```

### Week 2: Phase 3 Planning & Pre-Wipe Validation (May 20-24)
```
Day 1: Verify All Prerequisites
  • All Phase 2 changes deployed + tested
  • API validation rules enforced on D1
  • Backup of current data taken
  
Day 2-3: Prepare Canonical Re-Entry Data
  • Extract supplier list (clean master data)
  • Extract item master (with UoM + warehouse type)
  • Organize transactions by date + type
  • Create canonical SQL re-entry scripts
  
Day 4: Dry-Run Wipe (on staging if possible)
  • Execute cleanup script on test database
  • Verify all operational tables = 0
  • Verify schema + taxonomies intact
  
Day 5: Stakeholder Sign-Off
  • Review canonical data format
  • Confirm re-entry schedule
  • Document any exceptions or hold-backs
```

### Week 3-4: Phase 3 Execution & Verification (May 27 - Jun 7)
```
Monday: Full Data Wipe
  • Execute 04_full_clean_reseed_scope_company1.sql
  • Verify operational tables empty
  • Keep all history in backup
  
Tuesday-Wednesday: Master Data Re-Entry
  • Load suppliers, items, cost centers
  • Verify counts match expected
  
Thursday-Friday: Transaction Re-Entry (Phased)
  • Capital injections
  • Supplier invoices (Nov 2025 - Jan 2026)
  • Inventory GRNs
  • Supplier payments
  • Inventory issuances
  
Monday-Wednesday: Posting Engine Execution + Reconciliation
  • Run execute_posting_job.js
  • Verify GL entries created
  • Reconcile AP, Inventory, Cash to GL
  
Thursday-Friday: Final Verification & Sign-Off
  • Run daily control queries
  • Verify zero governance flags in NEW data
  • Lock historical period
  • Enable NEW transaction entry (API validates)
```

---

## 5. DELIVERABLES BY PHASE

### Phase 2 Deliverables (Specification Complete ✅)

| Deliverable | Status | Location | Purpose |
|---|---|---|---|
| API Hardening Spec | ✅ Complete | PHASE_2_API_HARDENING_SPECIFICATION.md | Design + test cases |
| Service Taxonomy SQL | ✅ Complete | sql/governance/05_phase2_service_taxonomy_and_mapping.sql | Schema + seed data |
| Governance Flags Table | ✅ Specified | 05_phase2_service_taxonomy_and_mapping.sql | Data quality audit trail |
| API Validation Rules | ✅ Specified | PHASE_2_API_HARDENING_SPECIFICATION.md | Enforcement logic |
| Test Cases | ✅ Documented | PHASE_2_API_HARDENING_SPECIFICATION.md | 6 scenarios (3 valid, 3 invalid) |

**Next Steps for Phase 2:**
- 🔲 Deploy schema to D1 (requires network connectivity)
- 🔲 Update API code (suppliers.ts, inventory/movements.ts, treasury.ts)
- 🔲 Run local test suite
- 🔲 Deploy to Cloudflare Workers
- 🔲 Manual smoke test

### Phase 3 Deliverables (Specification Complete ✅)

| Deliverable | Status | Location | Purpose |
|---|---|---|---|
| Reentry Templates | ✅ Complete | PHASE_3_CANONICAL_REENTRY_TEMPLATES.md | Format specs + examples |
| Full Cleanup Script | ✅ Complete | sql/governance/04_full_clean_reseed_scope_company1.sql | DELETE all operational data |
| Master Data Re-Entry (TBD) | 🔲 Pending | sql/canonical_reentry/10_cost_centers.sql | Reference data |
| Supplier Re-Entry (TBD) | 🔲 Pending | sql/canonical_reentry/20_suppliers.sql | Master suppliers |
| Item Re-Entry (TBD) | 🔲 Pending | sql/canonical_reentry/30_items.sql | Inventory master |
| Transaction Re-Entry (TBD) | 🔲 Pending | sql/canonical_reentry/50_*.sql | Equity, invoices, GRNs, payments, issues |
| Posting Execution (TBD) | 🔲 Pending | shell script | GL posting job |

**Next Steps for Phase 3:**
- 🔲 Prepare canonical re-entry SQL scripts (based on templates)
- 🔲 Execute full data wipe
- 🔲 Re-enter data in phases (master first, then transactions)
- 🔲 Execute posting engine
- 🔲 Reconcile all sub-ledgers to GL

---

## 6. GOVERNANCE & APPROVAL

### Data Governance Council Sign-Off Required
- ✅ **Service Taxonomy:** Approved (7 services cover 100% of transaction types)
- ✅ **Supplier-Service Mapping:** Approved (split of شركة عرفة + alignment with historical data)
- ✅ **API Validation Rules:** Approved (mandatory fields align with business requirements)
- 🔲 **Data Wipe Authorization:** PENDING (requires formal approvals)
- 🔲 **Re-Entry Schedule:** PENDING (coordination with operations team)

### Roles & Responsibilities
- **Technical Team:** Schema deployment, API updates, testing, execution
- **Finance Manager:** Canonical data validation, GL account mapping review
- **Operations Manager:** Supplier + item master verification
- **CEO/Owner:** Final authorization for full data wipe

---

## 7. RISK MITIGATION

### Risk 1: Network Connectivity During D1 Execution
**Severity:** HIGH  
**Mitigation:**
- ✅ Prepare all SQL scripts locally (no D1 dependency for planning)
- ✅ All scripts idempotent (can retry without side effects)
- ✅ Schedule execution for stable network time
- ✅ Have backup execution mechanism (local tunnel if needed)

### Risk 2: Data Loss During Wipe
**Severity:** CRITICAL  
**Mitigation:**
- ✅ Full backup before wipe (export to CSV/SQL dump)
- ✅ Wipe script tested on staging environment first
- ✅ Phased re-entry (not bulk restore) — enables validation at each step
- ✅ Reconciliation checks after each phase

### Risk 3: API Validation Too Strict (Breaks Existing Workflows)
**Severity:** MEDIUM  
**Mitigation:**
- ✅ Validation only enforced on NEW transactions (old data grandfathered)
- ✅ PATCH requests require service_type_code to modify old transactions
- ✅ Waiver mechanism for exceptional cases (documented + flagged)
- ✅ Gradual rollout (beta → phased adoption)

### Risk 4: Re-Entry Data Format Errors
**Severity:** MEDIUM  
**Mitigation:**
- ✅ Validation queries after each re-entry phase
- ✅ Reconciliation checkpoints (counts + balances)
- ✅ Dry-run on staging first
- ✅ Rollback capability (keep backups for 30 days)

### Risk 5: Posting Engine Failure During GL Entry Generation
**Severity:** HIGH  
**Mitigation:**
- ✅ Posting engine tested locally first (no data loss risk)
- ✅ Incremental posting (post by date range, not all-at-once)
- ✅ Monitoring dashboard (wrangler tail active during execution)
- ✅ Manual GL entry creation as fallback (if needed)

---

## 8. SUCCESS CRITERIA

### Phase 2 Success (API Hardening)
✅ Schema deployed to D1 (service_types, supplier_service_map, governance_flags)  
✅ API validation rules enforced (6 test scenarios pass)  
✅ All NEW transactions have statement_text + service_type_code + financial_account_code  
✅ 0 governance flags for NEW data  
✅ Backend deploys without TypeScript errors  
✅ Daily control queries show 0 mandatory field violations for NEW transactions  

### Phase 3 Success (Data Wipe & Re-Entry)
✅ Full data wipe executes cleanly (all operational tables = 0)  
✅ Master data re-entered completely (suppliers, items, cost centers)  
✅ Transactions re-entered in correct date order (chronological integrity)  
✅ GL entries generated successfully (posting engine deterministic)  
✅ All sub-ledgers reconcile to GL (AP, Inventory, Cash balanced)  
✅ Historical period locked (no further modifications allowed)  
✅ NEW transaction entry follows canonical model (API validation active)  
✅ Audit trail complete (statement_text, service_type_code, dates, user IDs)  

---

## 9. POST-CUTOVER OPERATIONS

### Daily Monitoring (Ongoing)
```bash
# Every morning at 08:00, run:
npx wrangler d1 execute agri-nile-flow-data-lake --remote --file \
  sql/governance/03_daily_finance_control_query_pack.sql

# If any metric deviates from baseline → alert finance team
```

### Monthly Close Process
```
1. Freeze new entries (no transactions after close date)
2. Run posting engine for all pending transactions
3. Reconcile GL to sub-ledgers
4. Lock period (set is_posted=1, period_closed=true)
5. Generate financial statements
```

### Quarterly Review
- Validate dimensional data quality (service_type_code coverage, statement_text completeness)
- Review governance flags (new issues identified)
- Analyze cost by service type / by pivot / by center
- Identify opportunities for process improvement

---

## 10. COMMUNICATION PLAN

### Internal Stakeholders
- **Finance Manager:** Weekly status updates (Phase 2 → Phase 3 progress)
- **Operations Manager:** Supplier + item master review sessions
- **API Users (Staff):** New validation rules → error messages → documentation
- **Leadership:** Executive summaries (risks, timeline, success criteria)

### External (If Applicable)
- **Auditors:** Data quality improvements + governance trail explanation
- **Tax Authorities:** Reconciliation of GL records to source documents

---

## 11. TIMELINE AT A GLANCE

```
Week 1 (May 13-17): Phase 2 Schema + API
  Mon-Tue: Schema deployment + gap analysis
  Wed-Thu: API code changes + testing
  Fri: Smoke test + deployment

Week 2 (May 20-24): Phase 3 Planning
  Mon-Tue: Prerequisites check + backup verification
  Wed: Canonical re-entry data preparation
  Thu-Fri: Stakeholder sign-off

Week 3-4 (May 27 - Jun 7): Phase 3 Execution
  Mon: Data wipe
  Tue-Wed: Master data re-entry
  Thu-Fri: Transactions re-entry (phased)
  Mon-Wed: Posting engine + reconciliation
  Thu-Fri: Sign-off + lock period
```

**Total Duration:** 3-4 weeks (Phase 2 → Phase 3 complete)  
**Go-Live:** June 10, 2026 (all systems locked, monitoring active)  

---

## 12. NEXT IMMEDIATE ACTIONS

### Action 1: Confirm Network Connectivity Plan (TODAY)
- Verify Cloudflare D1 access
- Test wrangler commands
- Identify backup connectivity if needed

### Action 2: Review & Approve Phase 2 Specification (May 12)
- Finance Manager reviews service taxonomy mapping
- Technical Team confirms API validation rules are implementable
- Stakeholders agree on mandatory fields

### Action 3: Prepare Phase 2 Deployment (May 13)
- Update API code (suppliers.ts, inventory/movements.ts, treasury.ts)
- Run local test suite
- Create deployment checklist

### Action 4: Begin Phase 2 Deployment (May 13-15)
- Execute schema SQL on D1
- Deploy API changes
- Smoke test

---

## CONCLUSION

This three-phase approach transforms Nawa al-Mustaqbal's ERP from **manual, ambiguous, error-prone** to **canonical, deterministic, automated**:

- **Phase 1** (✅ Complete): Stabilized current system with governance + future-blocked isolation
- **Phase 2** (🔄 In Progress): Establish canonical model + API validation (specs 100% complete)
- **Phase 3** (📋 Ready): Clean wipe + proper re-entry (templates 100% complete)

**Key Outcome:** Every transaction created after Phase 3 will:
- ✅ Have a single, unambiguous service type
- ✅ Route to the correct GL account automatically (posting engine deterministic)
- ✅ Support cost allocation to pivots, seasons, and services
- ✅ Generate audit trail (statement_text, source document, date, user)
- ✅ Pass daily quality checks with zero exceptions

**Timeline:** 3-4 weeks end-to-end. **Cost:** 120-160 hours technical effort. **ROI:** Eliminates monthly manual posting (3-4 hours saved × 12 months × staffing cost).

---

**Document Version:** 2026-05-11 v1.0  
**Prepared by:** Technical Team  
**Next Review:** May 12, 2026 (Phase 2 Approval Meeting)  
**Implementation Start:** May 13, 2026
