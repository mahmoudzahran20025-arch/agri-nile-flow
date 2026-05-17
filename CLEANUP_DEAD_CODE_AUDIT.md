# Cleanup: Dead Code & Obsolete Migration Audit
**Date:** May 6, 2026  
**Status:** Post-Deployment Phase  
**Priority:** Medium (technical debt cleanup)

---

## 1. Deprecated GL Modules

### 1.1 `gl_account_mappings` Table (DEPRECATED)
**Status:** Sunset planned (Aug 2026 per docs)  
**Reason:** Superseded by `posting_rules` + `posting_engine.ts` architecture  
**Current Usage:**  
- `src/lib/gl.ts` — Legacy key→account mapping (read-only fallback)
- `src/api/gl.ts` — GET /gl/mappings returns 19 rows, all flagged `deprecated=1`
- **PUT /gl/mappings → 405 Method Not Allowed** (intentionally disabled)

**What to Do:**
- [✓] Keep table for audit trail (don't delete from D1)
- [ ] Remove from FinanceCore resolvers (already done — not called)
- [ ] Update frontend to hide "GL Mappings" admin panel (if it exists)
- [ ] Document transition path for customers still using it

**Lines of Code Affected:**
- `src/lib/gl.ts:1-111` — Comments indicate these builders are removed (marked as "NOTE")
- No active imports to dead functions

---

### 1.2 Legacy GL Builders (Removed Functions) 
**File:** `src/lib/gl.ts`  
**Status:** Already removed, only comments remain  
**Removed Functions:**
```
- glCashTransaction() — use FinanceCore.resolveCashLedger instead
- glSupplierTransaction() — use FinanceCore.resolveSupplierInvoice instead
- glSupplierInvoice() — use FinanceCore.resolveSupplierInvoice instead
- glInventoryMovement() — use FinanceCore.resolveInventoryMovement instead
- glWorkOrderLabor() — use FinanceCore.resolveWorkOrderLabor instead
- glWagesPayment() — use FinanceCore.resolvePayrollPayment instead
- glContractAdvance() — use FinanceCore.resolveContractAdvance instead
```

**Action:** ✓ Already migrated. No cleanup needed.

---

## 2. Obsolete Migration Files

### 2.1 Schema Bootstrap Files (May Be Obsolete)
| File | Size | Created | Status | Notes |
|------|------|---------|--------|-------|
| `schema.sql` | ~5KB | Initial setup | ✓ Active | Base tables only |
| `schema_phase2.sql` | ~3KB | Early phase | ? Unclear | Fields, employees, contracts (redundant?) |
| `schema_phase3.sql` | ~4KB | Early phase | ? Unclear | GL tables (redundant?) |
| `migrations/0084_phase0_foundations.sql` | Large | Recent | ✓ Active | Phase 0 rewrite (supersedes above) |

**Recommendation:**  
Phase2/3 schema files are likely **NOT applied to live D1** (migrations are authoritative).  
- Keep them for historical reference only
- Add note: "These are pre-migration bootstrap files. Use migrations/ for current schema."
- Don't delete yet (may be referenced in docs)

### 2.2 Likely Obsolete Migrations (Verify Before Deleting)
| File | Purpose | Age | Override Indicators |
|------|---------|-----|-------------------|
| `FIX_ghost_mappings.sql` | Fix 8 gl_account_mappings with invalid account codes | Old | ⚠️ May not be applied; check D1 |
| `0043_gl_performance_indexes.sql` | Indexes on GL tables | Old | ✓ Applied (check via D1 schema query) |
| `0020_cleanup_and_consistency.sql` | Early consistency fixes | Very old | ✓ Likely applied but check |

**How to Check if Applied:**
```sql
SELECT name FROM sqlite_master 
WHERE type = 'index' AND name LIKE 'idx_%' 
ORDER BY name;
```

---

## 3. Schema Cleanup Opportunities

### 3.1 Columns Added But Unused
**File Audit Required:** Check each table for:
- `deprecated_at` columns (on gl_account_mappings, possibly others)
- Legacy status columns (old ones before standardization in 0025)
- Orphaned foreign keys

**Action:** 
- [ ] Query D1 for NULL-only columns
- [ ] Document unused columns before any deletion
- [ ] Coordinate with support before removing

---

## 4. Code Dead Zones

### 4.1 Frontend Dead Code
**Status:** Need search  
**Known Areas:**
- Old page components in `web/src/pages/` that might not be routed
- Unused API client functions in `web/src/api/`
- Commented React code (typically TODOs)

**Action:** 
- [ ] Run TypeScript unused exports check
- [ ] grep for `@deprecated` comments
- [ ] Check App.tsx for all routes actually used

### 4.2 Backend Dead Code
**Status:** Moderate  
**Known Areas:**
- Commented helpers in `src/lib/` (e.g., old validator functions)
- Routes registered but never called (check middleware chain)
- Database queries with no callers (semantic search)

---

## 5. Database Audit Queries

### 5.1 Find Unused Tables
```sql
-- Run against live D1
SELECT name FROM sqlite_master 
WHERE type = 'table' 
  AND name NOT LIKE 'sqlite_%'
  AND name NOT LIKE 'd1_%'
ORDER BY name;
```
Compare against `src/api/` imports to find truly unused tables.

### 5.2 Find Orphan Columns
```sql
-- Check if any column contains ONLY NULLs (candidate for deletion)
PRAGMA table_info(gl_account_mappings);
SELECT COUNT(*), COUNT(deprecated_at) FROM gl_account_mappings;
-- If COUNT(*) >> COUNT(deprecated_at), column is sparsely used
```

### 5.3 Find Orphan Indexes (Low-Value Indexes)
```sql
-- Indexes that are never used (requires EXPLAIN QUERY PLAN)
SELECT * FROM pragma_index_list('table_name');
```

---

## 6. Documentation Cleanup

### 6.1 Outdated Documentation Files
| File | Status | Action |
|------|--------|--------|
| `docs/DATABASE_AUDIT_REPORT.md` | ✓ Recent | No change |
| `docs/DATABASE_FORENSIC_REPORT.md` | ⚠️ Outdated | Mark as historical |
| `AUDIT_*.md` (many files) | ⚠️ Outdated | Archive to `docs/archive/` |
| `antigravity_walkthrough/*` | ⚠️ Very old | Archive |
| `ACTION_PLAN_*.md` (many files) | ⚠️ Outdated | Keep latest, archive others |

**Action:**  
- [ ] Create `docs/archive/` directory
- [ ] Move all docs > 60 days old to archive
- [ ] Update `docs/README.md` to point to current guides

### 6.2 README Files Need Updates
- [ ] Root `README.md` — update feature list to match current code
- [ ] `web/README.md` — document frontend structure changes
- [ ] `src/README.md` — update backend module docs

---

## 7. Test Coverage Gaps

### 7.1 No Unit Tests Found For:
- [ ] `src/middleware/auth.ts` — JWT signing/verification
- [ ] `src/lib/posting_engine.ts` — posting group resolution
- [ ] `src/lib/finance_core.ts` — business event posting (only smoke tests)

### 7.2 Integration Tests Needed:
- [ ] Full GL posting flow (supplier invoice → GL entry)
- [ ] Idempotency retry mechanism
- [ ] Permission guard (permissionGuard middleware)

### 7.3 End-to-End Test Script:
- ✓ `smoke_test.js` — Basic endpoint health check (6/6 passing)
- [ ] Missing: Full transaction flow tests (e.g., supplier invoice → payment → GL)
- [ ] Missing: Error scenario tests (e.g., closed period, invalid accounts)

---

## 8. Recommended Cleanup Sequence

### Phase 1 (Immediate — 1 day)
1. ✓ Fix /assets auth middleware (DONE)
2. Document all dead code locations (this file)
3. Add deprecation warnings to obsolete functions

### Phase 2 (This Week — 2–3 days)
1. Move old audit/doc files to `docs/archive/`
2. Update `README.md` with current architecture
3. Create API documentation index (see section 9 below)

### Phase 3 (Next Sprint — 1 week)
1. Write unit tests for auth, posting_engine, finance_core
2. Verify all gl_account_mappings entries are truly unused
3. Consider removing `schema_phase*.sql` files (or mark as historical)

### Phase 4 (Later — Backlog)
1. Remove gl_account_mappings table (if confirmed no usage)
2. Clean up unused D1 columns
3. Archive or delete dead code files

---

## 9. API Documentation Index (TO BE CREATED)

**Purpose:** Centralized reference for all endpoints  
**Format:** Markdown table with:
- Endpoint path
- HTTP method
- Auth required (yes/no)
- Permission required
- Request/response types
- Example curl

**Location:** `docs/API_REFERENCE.md` (NEW FILE)

**Sections:**
- Authentication (`POST /auth/login`, etc.)
- General Config (`GET /config/*`, `POST /config/*`)
- Suppliers (`GET/POST/PATCH /suppliers`)
- Inventory (`GET/POST /inventory/*`)
- GL (`GET /gl/*`, `POST /gl/entries`)
- Treasury (`GET/POST /treasury/*`)
- Assets (`GET/POST /assets`)
- Operations (`GET/POST /operations/*`)
- Finance (`GET/POST /finance/*`)
- Admin (`GET/POST /admin/*`)

**Status:** To be created in next step (Step 8)

---

## 10. Test Coverage Report (TO BE GENERATED)

**Purpose:** Assess test coverage and identify gaps  
**Metrics to Track:**
- Line coverage (target: >70%)
- Function coverage (target: >80%)
- Branch coverage (target: >60%)

**Coverage Areas:**
- Backend API routes (currently: 6/6 smoke tests passing)
- Auth middleware (currently: no unit tests)
- Posting engine (currently: no unit tests)
- Finance core (currently: smoke tests only)

**Status:** To be generated in next step (Step 9)

---

## Summary

✅ **Fixed Issues:**
- `/assets` endpoint 403 error (missing authMiddleware) — RESOLVED

⚠️ **Cleanup Opportunities Identified:**
- `gl_account_mappings` — deprecated, keep for audit trail
- Multiple old documentation files — archive
- Schema bootstrap files — mark as historical
- Missing unit tests — 3 critical modules uncovered

📋 **Next Actions:**
1. Update API documentation (see Section 9)
2. Generate test coverage report (see Section 10)
3. Move old docs to archive

---

*This audit is part of **Option 5: Cleanup — Debt Elimination** post-deployment phase.*  
*Track completion via: `CLEANUP_DEAD_CODE_STATUS.md` (next iteration)*
