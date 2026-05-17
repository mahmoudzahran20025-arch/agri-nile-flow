# ✅ Posting Engine V2 — Master Checklist

**Document:** Comprehensive Pre-Implementation & Execution Checklist  
**Last Updated:** May 1, 2026  
**Status:** Ready for Kickoff

---

## PRE-IMPLEMENTATION (Before Any Code)

### Legal & Approvals
- [ ] Project sponsor approval obtained
- [ ] Technical steering committee approved
- [ ] Finance/Accounting team aware of timeline
- [ ] Data protection review completed (GDPR/Privacy if applicable)

### Stakeholder Alignment
- [ ] Finance team understands scope
- [ ] Operations prepared for testing involvement
- [ ] IT/Infrastructure ready (D1 database access)
- [ ] Support team briefed on changes

### Environment Setup
- [ ] Development environment isolated
- [ ] Staging database clone available
- [ ] Git feature branch created: `feature/posting-engine-v2`
- [ ] CI/CD pipeline configured for new migrations
- [ ] Backup solution tested

---

## PHASE 0: ASSESSMENT & PREP

### Data Audit
- [ ] Row count documented for posting_rules
- [ ] Row count documented for journal_entries
- [ ] Row count documented for journal_entry_lines
- [ ] Row count documented for business_events
- [ ] Total data size < 100MB
- [ ] No corrupted records identified
- [ ] Foreign key integrity verified

### Backup & Recovery
- [ ] Full database backup created (with timestamp)
- [ ] Backup verified (test restore)
- [ ] Backup stored in at least 2 locations
- [ ] Rollback procedure documented
- [ ] Rollback tested (in staging)

### Risk Assessment
- [ ] Risk register completed
- [ ] Mitigation strategies identified
- [ ] Escalation path documented
- [ ] On-call schedule established for go-live

### Documentation
- [ ] Current system architecture documented
- [ ] Data flow diagrams created
- [ ] Existing posting rules catalogued
- [ ] GL account mapping documented

### Team Preparation
- [ ] Backend dev: Familiar with D1 SQL
- [ ] Frontend dev: React + TanStack Query proficiency confirmed
- [ ] QA: Test case template prepared
- [ ] DBA: Migration strategy reviewed

---

## PHASE 1: SCHEMA & MASTER DATA

### Migration Files
- [ ] Migration 0051_posting_engine_phase1_basics.sql created
- [ ] Migration 0051 reviewed by DBA
- [ ] Migration 0051 tested in staging
- [ ] Migration 0051 syntax validated

- [ ] Migration 0052_master_data_tables.sql created
- [ ] Migration 0052 reviewed by DBA
- [ ] Migration 0052 tested in staging
- [ ] Migration 0052 foreign keys verified

### TypeScript Implementation
- [ ] src/types/posting_v2.ts created
- [ ] All types defined (PostingRuleV2, JournalLineV2, etc.)
- [ ] Types align with database schema
- [ ] No naming conflicts with existing types
- [ ] TypeScript compilation passes: `npx tsc --noEmit`

### Backend API
- [ ] New API endpoints defined (5 minimum):
  - [ ] GET /gl/posting-setup/material-groups
  - [ ] POST /gl/posting-setup/material-groups
  - [ ] GET /gl/posting-setup/business-units
  - [ ] POST /gl/posting-setup/business-units
  - [ ] GET /gl/posting-setup/event-types

- [ ] All endpoints have proper auth middleware
- [ ] Input validation implemented
- [ ] Error messages user-friendly
- [ ] API documentation updated

### Frontend API Client
- [ ] web/src/api/gl.ts updated
- [ ] New API methods exported: glApi.materialGroups(), etc.
- [ ] Error handling consistent with existing patterns
- [ ] TypeScript types imported from posting_v2.ts

### UI Components
- [ ] MasterDataPage.tsx created with tabs
- [ ] MaterialGroupsTab component implemented
- [ ] BusinessUnitsTab component implemented
- [ ] Add/Edit modals implemented
- [ ] Form validation working
- [ ] Error displays user-friendly

### Routing
- [ ] Route added to web/src/App.tsx: /gl/master-data
- [ ] Navigation menu updated
- [ ] Breadcrumbs working correctly
- [ ] Mobile responsive tested

### Unit Tests (Backend)
- [ ] API endpoint tests written (Jest)
- [ ] Migration rollback test
- [ ] Foreign key constraint test
- [ ] Authorization tests
- [ ] All tests passing

### Component Tests (Frontend)
- [ ] MasterDataPage renders correctly
- [ ] Add form validates inputs
- [ ] API calls mocked correctly
- [ ] Error states display properly
- [ ] All tests passing

### Integration Tests
- [ ] Migration applies successfully
- [ ] Old engine still produces correct entries
- [ ] New columns are accessible
- [ ] NULL defaults work as expected
- [ ] Indexes created and functional

### Backward Compatibility
- [ ] Existing posting rules still resolve correctly
- [ ] Journal entries created pre-Phase1 still readable
- [ ] No breaking changes to existing endpoints
- [ ] Old UI pages still functional
- [ ] TypeScript compiles without errors (including existing code)

### Documentation
- [ ] POSTING_ENGINE_MODERNIZATION_ROADMAP.md reviewed
- [ ] POSTING_ENGINE_V2_IMPLEMENTATION_GUIDE.md reviewed
- [ ] Phase 1 architecture diagram created
- [ ] API documentation updated
- [ ] Team training materials prepared

### Sign-Off
- [ ] Tech lead review completed
- [ ] DBA sign-off obtained
- [ ] Product manager approval
- [ ] Ready to proceed to Phase 2

---

## PHASE 2: MULTI-CURRENCY & EVENTS

### Migration Files
- [ ] Migration 0053_multi_currency_support.sql created
- [ ] Migration 0053 tests exchange rate insertion
- [ ] Migration 0053 verified in staging

- [ ] Migration 0054_event_type_standardization.sql created
- [ ] Event types seeded with 15+ entries
- [ ] Transaction types seeded
- [ ] Migration 0054 verified in staging

### Posting Engine V2
- [ ] posting_engine_v2.ts skeleton created
- [ ] resolveGeneralSetupV2() with validity dates implemented
- [ ] resolveInventorySetupV2() implemented
- [ ] Currency conversion helpers implemented
- [ ] Cascade logic (4-level priority) working
- [ ] Cache invalidation for V2 rules

### Currency Support
- [ ] Exchange rate storage working
- [ ] convertCurrency() function accurate
- [ ] Rate interpolation for missing dates
- [ ] Revaluation logic designed (not yet implemented)

### Event Types
- [ ] md_event_types populated (15+ types)
- [ ] Event type flags correct (affects_inventory, etc.)
- [ ] business_events properly categorized
- [ ] Event queries efficient (< 50ms)

### API Endpoints (Phase 2)
- [ ] GET /gl/posting-setup/event-types
- [ ] POST /gl/posting-setup/exchange-rates
- [ ] GET /gl/posting-setup/exchange-rates
- [ ] GET /gl/posting-setup/transaction-types

### UI Components (Phase 2)
- [ ] ExchangeRatesPage.tsx created
- [ ] Currency selector dropdown
- [ ] Rate entry form with date picker
- [ ] Historical rates table
- [ ] Revaluation simulation UI

### Integration Tests (Phase 2)
- [ ] Multi-currency transaction reconciliation
- [ ] Exchange rate lookup by date
- [ ] Event type resolution in GL posting
- [ ] Performance test: 1000 multi-currency transactions < 120s

### Performance Tests
- [ ] Single transaction < 100ms
- [ ] Batch of 100 transactions < 10s
- [ ] Exchange rate lookup < 5ms
- [ ] Memory usage stable over 1000 transactions

### Load Testing
- [ ] 100 TPS sustained
- [ ] 500 TPS spike handling
- [ ] Database connection pooling working
- [ ] No memory leaks detected

### Parity Tests (V1 vs V2)
- [ ] V1 rules produce same accounts in V2
- [ ] Journal entry amounts match exactly
- [ ] No rounding differences
- [ ] NULL validity dates work like V1

### Documentation (Phase 2)
- [ ] Multi-currency flow diagram
- [ ] Event type catalog
- [ ] Exchange rate update procedure
- [ ] Troubleshooting guide

### Sign-Off (Phase 2)
- [ ] Performance metrics approved
- [ ] Parity tests signed off
- [ ] Load test results acceptable
- [ ] Ready for Phase 3 decision

---

## PHASE 3: ACCOUNT ROLES (OPTIONAL)

### Decision Gate
- [ ] Phase 3 approved by steering committee ✓/✗
- [ ] If YES, continue checklist below
- [ ] If NO, skip to Phase 4

### Migration Files
- [ ] Migration 0055_account_role_mapping.sql created
- [ ] Backfill query tested (V1 → V2 account mapping)
- [ ] Foreign key constraints verified
- [ ] Migration 0055 tested in staging

### Engine Refactoring
- [ ] posting_engine_v3_roles.ts created
- [ ] Role-based account lookup implemented
- [ ] Cascade logic updated for roles
- [ ] All 16 account roles fully supported
- [ ] Validation for mandatory roles
- [ ] Performance optimized with caching

### UI Implementation
- [ ] AccountRoleMappingPage.tsx created
- [ ] Role assignment form
- [ ] Matrix view (Rules × Roles × Accounts)
- [ ] Bulk import from CSV
- [ ] Duplicate detection

### Testing (Phase 3)
- [ ] All account roles covered by tests
- [ ] Transition from flat columns to roles verified
- [ ] No data loss in migration
- [ ] Role-based resolution matches old flat mapping
- [ ] Edge cases tested (missing mandatory roles, etc.)

### Sign-Off (Phase 3)
- [ ] Role architecture approved
- [ ] Test coverage > 90%
- [ ] Performance acceptable
- [ ] Migration from Phase 2 reversible
- [ ] Ready for Phase 4

---

## PHASE 4: QUALITY ASSURANCE

### Comprehensive Test Suite
- [ ] Functional tests (70+)
- [ ] Integration tests (30+)
- [ ] Performance tests (10+)
- [ ] Security tests (15+)
- [ ] All tests automated in CI/CD

### Parity Testing (V1 vs V2)
- [ ] Sample of 100 historical transactions reprocessed
- [ ] Journal entries match exactly (Debit/Credit)
- [ ] GL account codes identical
- [ ] Dimensions (cost center, field, etc.) preserved
- [ ] No discrepancies logged

### Functional Test Cases

#### GL Posting
- [ ] Supplier invoice creates 2 lines (DR AP, CR Purchases)
- [ ] Inventory movement creates 2 lines
- [ ] Harvest revenue creates 2 lines
- [ ] Currency conversion correct
- [ ] Business unit dimension preserved
- [ ] Cost center dimension preserved

#### Master Data
- [ ] Can create material group
- [ ] Can create business unit
- [ ] Can assign material group to item
- [ ] Can assign business unit to entry
- [ ] Deactivate prevents new usage
- [ ] Reactivate allowed

#### Multi-Currency (if Phase 2)
- [ ] Create entry in USD
- [ ] Amount converted to EGP
- [ ] Exchange rate lookup correct
- [ ] Revaluation entry created monthly
- [ ] Gain/loss calculation accurate

#### Account Roles (if Phase 3)
- [ ] Role assignment to accounts
- [ ] Mandatory role validation
- [ ] Role-based account resolution
- [ ] Duplicate role prevention

### Performance Testing
- [ ] 1 transaction: avg 85ms, p95 110ms, p99 150ms
- [ ] 100 transactions batch: < 10s
- [ ] Exchange rate lookup: < 5ms
- [ ] Master data queries: < 20ms
- [ ] Memory: stable, no leaks

### Load Testing
- [ ] 100 concurrent users: OK
- [ ] 1000 TPS burst: handled
- [ ] Database connection pool: tuned
- [ ] API response time under load: acceptable
- [ ] No 500 errors in 1-hour test

### Security Testing
- [ ] SQL injection prevented
- [ ] Authorization enforced (role-based)
- [ ] Sensitive data not logged
- [ ] Audit trail functional
- [ ] No backdoors found

### UAT with Stakeholders
- [ ] Finance team performs 2-day UAT
- [ ] User acceptance sign-off obtained
- [ ] Edge cases tested by domain experts
- [ ] Business rules validated
- [ ] No blocking issues found

### Bug Resolution
- [ ] All critical bugs fixed
- [ ] All major bugs fixed
- [ ] Minor bugs logged for Phase 2 sprint
- [ ] Regression tests added for all bugs

### Documentation Finalization
- [ ] User guide for MasterData UI
- [ ] Admin guide for exchange rates
- [ ] Troubleshooting guide
- [ ] FAQ document
- [ ] Training video (if applicable)

### Go-Live Checklist
- [ ] Rollback plan tested and documented
- [ ] Deployment procedure documented step-by-step
- [ ] Monitoring/alerting configured
- [ ] On-call team trained
- [ ] Support team briefed

### Sign-Off (Phase 4)
- [ ] QA manager: All tests passing
- [ ] Finance lead: UAT approved
- [ ] Tech lead: Code quality acceptable
- [ ] Operations: Infrastructure ready
- [ ] Project sponsor: Clear to proceed

---

## PHASE 5: PRODUCTION CUTOVER

### Pre-Cutover (48 hours before)
- [ ] Final backup created
- [ ] Backup verified and tested
- [ ] Dry-run migration completed in staging
- [ ] Dry-run results validated
- [ ] All team members briefed

### Pre-Cutover Verification
- [ ] Database row counts documented
- [ ] GL account mapping verified
- [ ] Current GL balances recorded (P&L, Balance Sheet)
- [ ] Exchange rates current as of cutover date
- [ ] No pending transactions > 24 hours old

### Cutover Day (Morning)
- [ ] All users notified of maintenance window
- [ ] System placed in read-only mode
- [ ] Final backup created (pre-cutover)
- [ ] All transactions aged > 24 hours verified
- [ ] Database health check passed

### Migration Execution
- [ ] Migration 0051 applied: ✓
- [ ] Migration 0052 applied: ✓
- [ ] Migration 0053 applied: ✓ (if Phase 2)
- [ ] Migration 0054 applied: ✓ (if Phase 2)
- [ ] Migration 0055 applied: ✓ (if Phase 3)
- [ ] Data integrity check: PASS
- [ ] Foreign keys: VALID
- [ ] Indexes: CREATED

### Code Deployment
- [ ] New backend code deployed
- [ ] New frontend code deployed
- [ ] API endpoints responding: YES
- [ ] UI pages loading: YES
- [ ] TypeScript compilation: PASS

### Post-Cutover Validation (First 4 hours)
- [ ] 10 random historical entries reconciled with GL
- [ ] P&L balances match pre-cutover (within rounding)
- [ ] Balance sheet balances: TRUE
- [ ] Trial balance: BALANCED
- [ ] No error logs with ERROR or FATAL level

### System Return to Normal
- [ ] Read-only mode disabled
- [ ] Users can create new transactions
- [ ] Posting logic working correctly
- [ ] Audit trail recording changes
- [ ] Monitoring/alerting active

### 24-Hour Monitoring
- [ ] On-call team monitoring alerts
- [ ] < 5 support tickets
- [ ] No critical issues reported
- [ ] Performance metrics normal
- [ ] User feedback positive

### Post-Cutover Validation (24 hours)
- [ ] 100 new transactions posted correctly
- [ ] GL balances stable (no wild swings)
- [ ] All dimensions (BU, cost center) recorded
- [ ] Multi-currency entries accurate (if Phase 2)
- [ ] Daily reconciliation: PASS

### Sign-Off (Phase 5)
- [ ] Operations manager: All systems normal
- [ ] Finance manager: GL reconciles
- [ ] IT manager: Infrastructure stable
- [ ] Project sponsor: Go-live successful

---

## POST-IMPLEMENTATION (Weeks after go-live)

### Week 1
- [ ] Monitor system 24/7
- [ ] Log all issues (even minor)
- [ ] Respond to support tickets within 2 hours
- [ ] Daily reconciliation: GL vs Source Systems
- [ ] Performance monitoring: Alert thresholds normal

### Week 2
- [ ] Issue retrospective meeting
- [ ] Document lessons learned
- [ ] Update runbooks based on actual go-live
- [ ] Training: Round 2 for latecomers
- [ ] Performance optimization if needed

### Month 1
- [ ] Financial close cycle completed with new engine
- [ ] External audit (if applicable) sign-off
- [ ] Long-term performance metrics established
- [ ] Knowledge transfer documentation completed
- [ ] Celebration! 🎉

### 3 Months
- [ ] Full financial year with V2
- [ ] Strategic decision: Phase 3 (Account Roles) now or later?
- [ ] Plan for V3 enhancements
- [ ] Team retrospective on project success

---

## FINAL APPROVALS

### Sign-Off Requirements

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Sponsor | _____________ | _____________ | ___/___/___ |
| Technical Lead | _____________ | _____________ | ___/___/___ |
| QA Manager | _____________ | _____________ | ___/___/___ |
| Finance Lead | _____________ | _____________ | ___/___/___ |
| Operations Manager | _____________ | _____________ | ___/___/___ |

---

## NOTES & CONTINGENCIES

### If Migration Fails
1. Restore from latest backup immediately
2. Investigate root cause (check migration logs)
3. Fix issue in development environment
4. Test fix in staging thoroughly
5. Retry migration after stakeholder approval

### If Performance Degradation Detected
1. Enable detailed query logging
2. Identify slow queries
3. Add indexes if necessary
4. Consider query optimization
5. Retest before proceeding

### If Data Integrity Issues Found
1. Stop further posting immediately
2. Verify backup integrity
3. Analyze discrepancy root cause
4. Determine rollback vs repair
5. Execute appropriate action with stakeholder approval

---

## DOCUMENT HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | May 1, 2026 | [Your Name] | Initial checklist |

---

**This checklist is a living document. Update as you progress through each phase.**

✅ **Ready to kickoff?** Print this, grab a pen, and let's go! 🚀
