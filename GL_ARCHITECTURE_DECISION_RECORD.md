# ADR: GL Architecture Decision Record

**Status**: PROPOSED (Awaiting Approval)  
**Date**: 2026-04-28  
**Author**: Claude (AI Analysis Agent)  
**Decision**: Adopt **Ledger-Based GL Architecture** (Option 1)

---

## Context

### The Inconsistency
Production financial system has a **critical disconnection** between operational data and GL:

- ✅ **Operational Ledgers**: cash_transactions (69), supplier_transactions (274), inventory_movements (654)
  - These are "source of truth" — they have running balances and match Excel data
  - Sum of running balances = actual operational state

- ✅ **GL Entries**: journal_entry_lines (1,848) are created and balanced
  - Debits = Credits (proper GL invariant)
  - But GL balances DO NOT TRACE back to operational sources

- ❌ **Missing Link**: business_events (0 rows) — the intended event-source bridge is empty
  - No audit trail from GL entry to source transaction
  - Cannot answer: "What created this GL entry?"
  - Cannot reconcile: "Why is this GL balance different from operational balance?"

### Why This Happened
1. Excel data imported as operational ledgers (2025-04)
2. GL code written assuming event-sourced architecture (2026-02)
3. Gap: Operational data predates the event-sourcing model
4. **Schism**: Two parallel, unlinked systems

---

## Requirements

### Functional Requirements
1. **Auditability**: Trace any GL entry back to its source
2. **Reconciliation**: GL balances must match operational ledger balances
3. **No Data Loss**: Cannot delete or significantly transform existing data
4. **Backward Compatible**: Existing GL functionality must continue
5. **Future-Proof**: Should not block future enhancements

### Non-Functional Requirements
1. **Low Risk**: Minimal code changes, maximally safe
2. **Fast**: Can be implemented in hours, not weeks
3. **Reversible**: Can be rolled back if issues arise
4. **Performant**: No significant query slowdown

---

## Options Considered

### Option 1: Ledger-Based GL ✅ RECOMMENDED
**Link GL to operational sources via source_ledger + source_record_id**

**Architecture**:
```
cash_transactions → journal_entry_lines (source_ledger='cash', source_record_id=ct.id)
supplier_transactions → journal_entry_lines (source_ledger='supplier', source_record_id=st.id)
inventory_movements → journal_entry_lines (source_ledger='inventory', source_record_id=im.id)
manual entries → journal_entry_lines (source_ledger='manual', source_record_id=NULL)
```

**Implementation**:
- Add 2 columns: source_ledger, source_record_id
- Backfill by matching amount + date
- Update posting code to set source_ledger when creating GL lines

**Pros**:
- ✅ Matches reality (Excel data is ledger-based)
- ✅ Low risk (additive schema, no deletions)
- ✅ Fast (2-3 hours)
- ✅ 100% reversible
- ✅ Direct audit trail (GL→source is 1-to-1 or 1-to-few)
- ✅ Clear semantics (operational tables stay operational, GL is derivative)
- ✅ Good performance (single index lookup)

**Cons**:
- ⚠️ Not "pure" event sourcing (but Excel data shows this model works)
- ⚠️ Requires ongoing discipline (code must set source_ledger)

**Risk Assessment**: 🟢 LOW

---

### Option 2: Event-Sourced GL ⚠️ NOT RECOMMENDED
**Convert all operational data to business_events**

**Architecture**:
```
business_events (created from historical transactions)
  → journal_entries
  → journal_entry_lines
```

**Implementation**:
- Create business_events for all 997 operational records
- Link journal_entries to business_events
- Update code to go through business_events for all posts
- Eventually deprecate direct operational table posts

**Pros**:
- ✅ "Theoretically pure" event sourcing
- ✅ Full event audit trail (if events are immutable)

**Cons**:
- ❌ Requires transforming 997 existing records
- ❌ Risk of mismatching events to GL entries
- ❌ Refactoring working code (finance_core.ts, posting_engine.ts)
- ❌ Takes 3-4 days
- ❌ Risk of breaking existing functionality
- ❌ Event data becomes "synthetic" (created from GL, not source)
- ❌ Doesn't fix the fundamental issue: Excel data is ledger-based

**Risk Assessment**: 🟡 MEDIUM

---

### Option 3: Reset to Clean State ❌ NOT RECOMMENDED
**Truncate all GL and operational data, reimport cleanly**

**Pros**:
- ✅ Clean slate

**Cons**:
- ❌ Loses all historical GL data
- ❌ Loses all transaction history
- ❌ Breaks audit compliance
- ❌ Customer-facing impact (reports unavailable)
- ❌ Cannot be done in production

**Risk Assessment**: 🔴 CRITICAL

---

## Decision

### **ADOPT OPTION 1: Ledger-Based GL**

**Rationale**:

1. **Reality-Based**: Excel data proves operational ledgers work
   - Treasury (cash_transactions): 69 transactions with running balance = real data
   - Suppliers (supplier_transactions): 274 transactions, SUM = actual payable
   - Inventory (inventory_movements): 654 movements with running balance = actual stock

2. **Semantically Correct**: Operational tables ARE the source of truth
   - GL is a *derivative* view for reporting/compliance
   - Operational ledgers are *canonical* data (how accountants think)
   - This matches actual business process (Excel → operational ledger → GL report)

3. **Low Risk**: Minimal disruption
   - Just adding 2 columns + linking data
   - No deletions or transformations
   - 100% reversible
   - Can be rolled back in minutes

4. **Fast**: Implementable in hours
   - Phase 1: Schema (30 min)
   - Phase 2: Backfill (1 hour)
   - Phase 3: Verification (30 min)
   - Phase 4: Code changes (1 hour)

5. **Future-Proof**: Doesn't block alternatives
   - Can still add event sourcing later if business requirements change
   - business_events table remains available (unused, but preserved)

---

## Implementation Plan

### Phase 1: Schema (30 minutes)
1. Add source_ledger column to journal_entry_lines
2. Add source_record_id column to journal_entry_lines
3. Create index on (source_ledger, source_record_id)
4. Verify schema with PRAGMA table_info

**Migration**: `0053_gl_source_tracking_schema.sql`

### Phase 2: Backfill (1 hour)
1. Match GL entries to cash_transactions (by amount + date)
2. Match GL entries to supplier_transactions (by amount + date)
3. Match GL entries to inventory_movements (by amount + date)
4. Mark remaining as 'manual'

**Migration**: `0054_gl_backfill_source_tracking.sql`

### Phase 3: Verification (30 minutes)
1. Check link completeness (all entries have source_ledger)
2. Verify balances match (GL balance = operational ledger sum)
3. Verify no orphans (all GL entries are accounted for)

**Queries**: In `MIGRATION_PLAN_LEDGER_BASED.md` (Phase 3)

### Phase 4: Code Changes (1 hour)
1. Update finance_core.ts to set source_ledger on posting
2. Update posting_engine.ts resolvers to return source info
3. Test new postings (inventory, supplier, cash)

**Files to update**:
- src/lib/finance_core.ts
- src/lib/posting_engine.ts (optional)

---

## Success Criteria

✅ **Structural Integrity**
- All journal_entry_lines have source_ledger assigned
- Correct distribution: ~69 cash, ~274 supplier, ~654 inventory, ~851 manual

✅ **Balance Reconciliation**
- GL cash account balance = MAX(running_balance) from cash_transactions
- GL A/P account balance = SUM(balance_with_checks) from supplier_transactions
- GL inventory account balance = SUM(balance_value) from inventory_movements

✅ **Auditability**
- Can join journal_entry_lines to source tables by (source_ledger, source_record_id)
- No null source_record_id for cash/supplier/inventory entries

✅ **Backward Compatibility**
- Existing GL queries continue to work
- Trial balance reports unchanged
- Financial statements continue to balance

---

## Migration Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Backfill logic incorrect | Medium | High | Multi-step verification before code changes |
| Balance mismatch discovered | Low | High | Abort backfill, diagnose, adjust logic |
| Code integration breaks | Low | Medium | Test new postings in dev before deploy |
| Performance regression | Low | Low | Index on (source_ledger, source_record_id) |
| Rollback complications | Low | Low | Keep DROP script ready, test rollback first |

**Overall Risk**: 🟢 LOW (all mitigation clear)

---

## Deployment Strategy

### Pre-Deployment
1. Review this ADR with team
2. Approve Option 1 decision
3. Prepare rollback script (DROP columns)
4. Notify stakeholders: "GL schema maintenance window starting"

### Deployment (Phase 1 + 2)
1. Execute migration 0053 (schema)
2. Execute migration 0054 (backfill)
3. Run verification queries
4. If verification passes → proceed to Phase 3
5. If verification fails → rollback and diagnose

### Post-Deployment (Phase 3 + 4)
1. Update posting code (finance_core.ts)
2. Test new postings (deploy to dev first)
3. Manual testing of inventory/supplier/cash posts
4. Commit code changes
5. Deploy to production

### Rollback (If Needed)
```sql
ALTER TABLE journal_entry_lines DROP COLUMN source_ledger;
ALTER TABLE journal_entry_lines DROP COLUMN source_record_id;
DROP INDEX idx_journal_entry_lines_source;
```
Takes 5 minutes, GL continues to work.

---

## Future Considerations

### Not Required Now
- business_events table (keep for future, leave empty)
- Event sourcing (can be added later without breaking ledger model)
- Immutability enforcement (no triggers added now)

### Recommended Later (Separate ADRs)
1. **Event Sourcing 2.0** (if business requires full event audit)
2. **GL Immutability** (triggers to prevent accidental edits)
3. **Running Balance Cache** (store pre-computed balances for speed)

---

## Related Documents

- `REAL_BUSINESS_FLOW_ANALYSIS.md` — Why ledger-based architecture matches reality
- `MIGRATION_PLAN_LEDGER_BASED.md` — Detailed execution steps
- `EXECUTIVE_SUMMARY_GL_FIX.md` — High-level overview
- `migrations/0053_*.sql` + `0054_*.sql` — Runnable SQL

---

## Approval

- [ ] Product Owner
- [ ] Engineering Lead
- [ ] Finance/Compliance Officer
- [ ] CEO/Founder

**Approval By**: _________________ **Date**: _________

---

## Implementation Status

- [x] ADR written and documented
- [x] Migrations prepared (0053, 0054)
- [x] Verification queries prepared
- [x] Risk assessment completed
- [ ] Team approval obtained
- [ ] Deployment executed
- [ ] Verification passed
- [ ] Code changes merged
- [ ] Closure documentation

