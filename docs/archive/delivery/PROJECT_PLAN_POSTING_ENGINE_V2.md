# Project Plan: Posting Engine Modernization
**Version 1.0 | 1 May 2026**

---

## Executive Summary

Upgrade Agri-Nile Flow's posting engine from V1 (single-dimensional, flat rules) to V2 (multi-dimensional, standards-aligned). Zero breaking changes during development phase.

**Total Duration:** 8-10 weeks  
**Risk Level:** Low-Medium (data is dev/staging only)  
**Resource Requirement:** 1 backend dev + 1 frontend dev  

---

## Deliverables by Phase

### Phase 0: Assessment (Week 1)
**Start:** May 6, 2026 | **End:** May 12, 2026

| Task | Owner | Est. Hours | Completed |
|------|-------|-----------|-----------|
| Database backup strategy | DBA | 2 | ☐ |
| Row count audit | Analyst | 2 | ☐ |
| Risk assessment | TL | 3 | ☐ |
| Stakeholder alignment | PM | 4 | ☐ |
| **Phase 0 Total** | | **11 hrs** | |

**Deliverable:** Phase0_Assessment_Report.md

---

### Phase 1: Schema Foundation (Weeks 2-3)
**Start:** May 13, 2026 | **End:** May 26, 2026

| Task | Owner | Est. Hours | Completed |
|------|-------|-----------|-----------|
| Write migration 0051 | Backend Dev | 3 | ☐ |
| Write migration 0052 | Backend Dev | 4 | ☐ |
| Create TypeScript types | Backend Dev | 3 | ☐ |
| Test migrations on D1 | QA | 4 | ☐ |
| Create API types (client) | Frontend Dev | 2 | ☐ |
| Update API client | Frontend Dev | 3 | ☐ |
| Create MasterDataPage.tsx | Frontend Dev | 5 | ☐ |
| Integrate UI routes | Frontend Dev | 2 | ☐ |
| Add backend endpoints | Backend Dev | 6 | ☐ |
| Unit tests (backend) | Backend Dev | 4 | ☐ |
| Component tests (frontend) | Frontend Dev | 3 | ☐ |
| **Phase 1 Total** | | **39 hrs** | |

**Deliverables:**
- ✅ migrations/0051_posting_engine_phase1_basics.sql
- ✅ migrations/0052_master_data_tables.sql
- ✅ src/types/posting_v2.ts
- ✅ web/src/pages/gl/MasterDataPage.tsx
- ✅ Backend API endpoints (5 new)
- ✅ Phase1_Test_Results.md

**Success Criteria:**
- [ ] All migrations apply without error
- [ ] No production data loss
- [ ] API endpoints respond correctly
- [ ] UI renders without errors
- [ ] TypeScript compiles cleanly
- [ ] Backward compatibility maintained

---

### Phase 2: Multi-Currency & Events (Weeks 4-6)
**Start:** May 27, 2026 | **End:** June 16, 2026

| Task | Owner | Est. Hours | Completed |
|------|-------|-----------|-----------|
| Design exchange rate strategy | Architect | 4 | ☐ |
| Write migration 0053 | Backend Dev | 4 | ☐ |
| Write migration 0054 | Backend Dev | 3 | ☐ |
| Rewrite posting_engine_v2.ts | Backend Dev | 12 | ☐ |
| Currency conversion helper | Backend Dev | 5 | ☐ |
| Event type resolution | Backend Dev | 4 | ☐ |
| API endpoints for rates | Backend Dev | 4 | ☐ |
| ExchangeRatesPage.tsx | Frontend Dev | 6 | ☐ |
| Currency selector UI | Frontend Dev | 4 | ☐ |
| Event type visualization | Frontend Dev | 4 | ☐ |
| Integration tests | QA | 6 | ☐ |
| Performance testing | QA | 3 | ☐ |
| **Phase 2 Total** | | **59 hrs** | |

**Deliverables:**
- ✅ migrations/0053_multi_currency_support.sql
- ✅ migrations/0054_event_type_standardization.sql
- ✅ src/lib/posting_engine_v2.ts (complete rewrite)
- ✅ web/src/pages/gl/ExchangeRatesPage.tsx
- ✅ Phase2_Test_Results.md
- ✅ Multi-Currency_Testing_Report.md

**Success Criteria:**
- [ ] Exchange rates stored and retrieved correctly
- [ ] Currency conversions accurate (verified against rates)
- [ ] Event types drive posting logic
- [ ] Performance < 150ms per transaction
- [ ] All existing transactions reconcile

---

### Phase 3: Account Roles (Weeks 7-8) — **OPTIONAL**
**Start:** June 17, 2026 | **End:** June 30, 2026

⚠️ **Decision Point:** Only if flexibility in account mappings is critical

| Task | Owner | Est. Hours | Completed |
|------|-------|-----------|-----------|
| Design role-based architecture | Architect | 6 | ☐ |
| Write migration 0055 | Backend Dev | 6 | ☐ |
| Refactor engine (role-based) | Backend Dev | 16 | ☐ |
| Role mapping UI | Frontend Dev | 8 | ☐ |
| Validation rules | Backend Dev | 4 | ☐ |
| Integration tests | QA | 8 | ☐ |
| **Phase 3 Total** | | **48 hrs** | |

**Deliverables:**
- ✅ migrations/0055_account_role_mapping.sql
- ✅ posting_engine_v2_roles.ts (role-driven resolution)
- ✅ AccountRoleMappingPage.tsx
- ✅ Phase3_Test_Results.md

**Success Criteria:**
- [ ] Roles are flexible and extensible
- [ ] All account types supported
- [ ] No performance degradation
- [ ] Migration from flat columns successful

---

### Phase 4: Quality Assurance (Week 9)
**Start:** July 1, 2026 | **End:** July 7, 2026

| Task | Owner | Est. Hours | Completed |
|------|-------|-----------|-----------|
| Comprehensive test suite | QA | 12 | ☐ |
| Parity testing (V1 vs V2) | QA | 8 | ☐ |
| Load testing | QA | 6 | ☐ |
| Security audit | Security | 4 | ☐ |
| UAT with stakeholders | Stakeholders | 8 | ☐ |
| Bug fixes | Backend/Frontend | 8 | ☐ |
| Documentation finalization | Tech Writer | 6 | ☐ |
| **Phase 4 Total** | | **52 hrs** | |

**Deliverables:**
- ✅ QA_Test_Report_V2_Final.md
- ✅ Parity_Analysis_V1_vs_V2.md
- ✅ User_Training_Materials.pdf
- ✅ Go-Live_Checklist.md

**Success Criteria:**
- [ ] 100% test pass rate
- [ ] V1 and V2 produce identical journal entries
- [ ] Load tested: 1000 TPS
- [ ] Security review passed
- [ ] UAT sign-off obtained

---

### Phase 5: Production Cutover (1 day)
**Start:** July 8, 2026 | **End:** July 8, 2026

| Task | Owner | Est. Hours | Completed |
|------|-------|-----------|-----------|
| Pre-cutover verification | DBA | 2 | ☐ |
| Migration execution | Backend Dev | 1 | ☐ |
| Deployment | DevOps | 1 | ☐ |
| Post-cutover validation | QA | 2 | ☐ |
| 24h monitoring | On-Call | 4 | ☐ |
| **Phase 5 Total** | | **10 hrs** | |

**Deliverables:**
- ✅ Cutover_Execution_Report.md
- ✅ Go-Live_Verification_Results.md

**Success Criteria:**
- [ ] Zero downtime
- [ ] All transactions processed correctly
- [ ] No P&L discrepancies
- [ ] Performance acceptable

---

## Timeline Visualization

```
May                June               July
├─Phase 0─┬─Phase 1──┬─Phase 2─────┬─Phase 3┬─Phase 4──┬─Phase 5─
  (1w)     (2w)       (3w)           (2w)    (1w)       (1d)
                      └─Optional──────┘
  
Development        Dev Complete      UAT        Production
│                  │                 │           │
May 6         May 26            June 30       July 8
```

---

## Resource Allocation

| Role | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|------|---------|---------|---------|---------|---------|---------|
| Backend Dev | 20% | 60% | 80% | 80% | 40% | 50% |
| Frontend Dev | 0% | 40% | 50% | 40% | 30% | 20% |
| QA | 20% | 20% | 30% | 40% | 100% | 100% |
| DBA | 50% | 30% | 20% | 10% | 20% | 50% |
| Architect | 20% | 10% | 20% | 30% | 10% | 0% |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| D1 Foreign Key Conflict | Medium | High | Test migrations in staging first |
| Performance Regression | Low | Medium | Load test Phase 2 completion |
| Data Migration Error | Low | High | Dry-run with production data copy |
| TypeScript Breaking Changes | Low | Medium | Comprehensive type testing |
| Scope Creep (Phase 3) | High | Medium | Decide Phase 3 by end of Phase 1 |
| Team Availability | Medium | Medium | Cross-training on posting_engine |

---

## Decision Points

### Decision 1: Phase 3 Inclusion
**When:** End of Week 3 (May 26)  
**Owner:** Product Manager + Tech Lead  
**Decision:**
- [ ] Include Phase 3 (Account Roles)
- [ ] Defer Phase 3 to Phase 2 upgrade (next year)

**Impact:** +2 weeks if included

### Decision 2: Cutover Timing
**When:** End of Week 9 (July 1)  
**Owner:** Operations + Finance  
**Decision:**
- [ ] Go-live on July 8 (scheduled)
- [ ] Delay for additional UAT
- [ ] Pilot with single company first

---

## Communication Plan

| Stakeholder | Frequency | Format | Owner |
|-------------|-----------|--------|-------|
| Development Team | Daily | Standup | Tech Lead |
| Project Sponsor | Weekly | Status Update | PM |
| Finance Team (UAT) | Bi-weekly | Demo | Product Manager |
| Operations | Weekly | Technical Deep-Dive | Architect |
| All Staff (Go-Live) | 1 week before | Training + Announcement | Communications |

---

## Budget Estimate

| Phase | Backend (hrs) | Frontend (hrs) | QA (hrs) | Other (hrs) | Total (hrs) |
|-------|--------------|----------------|----------|-----------|-----------|
| 0 | 2 | 0 | 2 | 7 | 11 |
| 1 | 20 | 10 | 4 | 5 | 39 |
| 2 | 30 | 14 | 9 | 6 | 59 |
| 3 | 26 | 8 | 8 | 6 | 48 |
| 4 | 8 | 6 | 30 | 8 | 52 |
| 5 | 4 | 2 | 4 | 4 | 14 |
| **TOTAL** | **90** | **40** | **57** | **36** | **223 hrs** |

**Cost Estimate (@ $75/hr):** $16,725  
**Actual investment with management/coordination:** ~$20,000-22,000

---

## Success Metrics

### Technical Metrics
- ✅ Zero test failures in Phase 4
- ✅ V1/V2 parity: 100% match
- ✅ Performance: < 120ms avg per transaction
- ✅ Availability: 99.95% uptime
- ✅ TypeScript: Zero compilation errors

### Business Metrics
- ✅ UAT sign-off: 100%
- ✅ Go-live without incidents: True
- ✅ User adoption: 100% within week 1
- ✅ P&L reconciliation: 100% match
- ✅ Support tickets: < 5 in first 48 hours

---

## Assumptions

1. **Data Volume:** Current posting_rules < 100 rows, journal_entries < 5000 rows
2. **Team Availability:** Backend dev, Frontend dev, QA available full-time
3. **No External Dependencies:** No vendor/third-party integrations affected
4. **Test Environment:** Staging/D1 database available for testing
5. **Rollback Window:** 24 hours (if needed)
6. **No Major Feature Freeze:** No competing priorities during Phase 1-4

---

## Approval Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Project Sponsor | [Name] | __/__/26 | ____________ |
| Tech Lead | [Name] | __/__/26 | ____________ |
| Product Manager | [Name] | __/__/26 | ____________ |
| Finance Lead | [Name] | __/__/26 | ____________ |

---

**Document Version:** 1.0  
**Last Updated:** May 1, 2026  
**Next Review:** May 26, 2026 (end of Phase 1)
