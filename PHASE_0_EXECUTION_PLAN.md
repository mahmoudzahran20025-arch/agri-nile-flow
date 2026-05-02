# Phase 0: Assessment & Preparation — Executive Plan

**Start Date:** May 1, 2026  
**Duration:** 3-5 days  
**Target Date:** May 6, 2026 (Phase 1 kickoff)

---

## 📋 Phase 0 Objectives

- ✅ Document current database state (row counts, data quality)
- ✅ Create backup strategy and test restore
- ✅ Verify data integrity (no broken FKs)
- ✅ Team preparation (knowledge transfer)
- ✅ Prepare Phase 1 environment

---

## 🎯 Task 1: Data Audit (2 hours)

### Objective
Document current state of GL-related tables to establish baseline for comparison.

### SQL Queries to Run

**Run in: Cloudflare D1**

#### Step 1.1: Posting Rules Summary
```sql
SELECT 
  COUNT(*) as total_rules,
  SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_rules,
  SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) as inactive_rules,
  COUNT(DISTINCT rule_type) as rule_types
FROM posting_rules
WHERE company_id = 1;
```

**Expected Output:** Row count, active/inactive split
**Document:** In Phase 0 Report

#### Step 1.2: Journal Entries Summary
```sql
SELECT 
  COUNT(*) as total_entries,
  COUNT(DISTINCT entry_date) as unique_dates,
  COUNT(DISTINCT ref_type) as ref_types,
  SUM(CASE WHEN is_posted = 1 THEN 1 ELSE 0 END) as posted_entries,
  MIN(entry_date) as earliest_entry,
  MAX(entry_date) as latest_entry
FROM journal_entries
WHERE company_id = 1;
```

**Expected Output:** Entry count, date range, posted split
**Document:** In Phase 0 Report

#### Step 1.3: Journal Lines Summary
```sql
SELECT 
  COUNT(*) as total_lines,
  COUNT(DISTINCT account_code) as unique_accounts,
  SUM(debit) as total_debits,
  SUM(credit) as total_credits,
  SUM(ABS(debit - credit)) as imbalance
FROM journal_entry_lines
WHERE EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = entry_id AND je.company_id = 1);
```

**Expected Output:** Line count, account diversity, balance verification
**Document:** In Phase 0 Report

#### Step 1.4: Chart of Accounts Summary
```sql
SELECT 
  COUNT(*) as total_accounts,
  COUNT(DISTINCT account_type) as account_types,
  SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_accounts
FROM chart_of_accounts
WHERE company_id = 1;
```

**Expected Output:** Account count and active status
**Document:** In Phase 0 Report

#### Step 1.5: Business Events Summary
```sql
SELECT 
  COUNT(*) as total_events,
  COUNT(DISTINCT event_type) as event_types,
  COUNT(DISTINCT source_module) as modules,
  SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted_events,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_events
FROM business_events
WHERE company_id = 1;
```

**Expected Output:** Event count, type diversity, status split
**Document:** In Phase 0 Report

### Task 1 Deliverable
**File:** `PHASE_0_DATA_AUDIT_REPORT.md`

**Contents:**
```markdown
# Phase 0 Data Audit Report
**Date:** May 1, 2026
**Company:** Agri-Nile Flow

## Summary Statistics

| Table | Count | Status | Notes |
|-------|-------|--------|-------|
| posting_rules | [result] | Active/Inactive | [notes] |
| journal_entries | [result] | Posted/Draft | [notes] |
| journal_entry_lines | [result] | Balanced/Imbalance | [notes] |
| chart_of_accounts | [result] | Active/Inactive | [notes] |
| business_events | [result] | Posted/Error | [notes] |

## Findings
- Total GL entries: [X]
- Total posting rules: [Y]
- Data quality: [assessment]

## Recommendations
- [list any issues found]

## Sign-off
Data Audit completed: _____ (Date)
Auditor: _____ (Name)
```

---

## 🎯 Task 2: Backup & Restore Testing (1.5 hours)

### Objective
Ensure D1 database can be backed up and restored safely.

### Step 2.1: Full Database Export
```powershell
# Export entire D1 database
npx wrangler d1 export pharma_db --remote --output="./backups/pharma_db_phase0_baseline.sql"

# Verify file created
Get-Item ./backups/pharma_db_phase0_baseline.sql | Select-Object FullName, Length, CreationTime
```

**Expected Output:**
```
FullName: C:\Users\...\pharma_db_phase0_baseline.sql
Length: [size in bytes]
CreationTime: [timestamp]
```

**Document:** Backup location and size

### Step 2.2: Backup Verification
```powershell
# Count lines in backup file
(Get-Content ./backups/pharma_db_phase0_baseline.sql | Measure-Object -Line).Lines

# Search for critical tables
Select-String -Path ./backups/pharma_db_phase0_baseline.sql -Pattern "CREATE TABLE.*posting_rules" | Select-Object -First 1
Select-String -Path ./backups/pharma_db_phase0_baseline.sql -Pattern "CREATE TABLE.*journal_entries" | Select-Object -First 1
```

**Expected Output:**
- Line count: [X,000+]
- Tables found: posting_rules, journal_entries present

### Step 2.3: Document Backup Strategy
**File:** `PHASE_0_BACKUP_STRATEGY.md`

**Contents:**
```markdown
# Backup & Disaster Recovery Strategy

## Pre-Migration Backup
- **Date:** May 1, 2026
- **Method:** Wrangler D1 export
- **File:** backups/pharma_db_phase0_baseline.sql
- **Size:** [X] MB
- **Integrity:** ✅ Verified
- **Location:** Project repo + Azure Backup

## Verification Steps Completed
✅ Export successful
✅ File contains posting_rules table
✅ File contains journal_entries table
✅ File contains chart_of_accounts table

## Restore Procedure (If Needed)
1. Notify all users of downtime
2. Run: `npx wrangler d1 execute pharma_db --remote < backups/pharma_db_phase0_baseline.sql`
3. Verify: Run data audit queries again
4. Re-test: Run Phase 1 test suite

## Rollback Plan
- If Phase 1 migration fails, restore from this backup
- If Phase 2+ fails, restore and pause that phase
- Estimated restore time: 5-10 minutes

## Sign-off
Backup verified: _____ (Date)
Backup owner: _____ (Name)
```

---

## 🎯 Task 3: Data Integrity Verification (1.5 hours)

### Objective
Ensure data is clean and ready for migration.

### Step 3.1: Foreign Key Integrity Check
```sql
-- Check for orphaned journal_entries
SELECT COUNT(*) as orphaned_entries
FROM journal_entries je
WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = je.company_id);

-- Check for orphaned journal_entry_lines
SELECT COUNT(*) as orphaned_lines
FROM journal_entry_lines jel
WHERE NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = jel.entry_id);

-- Check for invalid account codes
SELECT COUNT(*) as invalid_accounts
FROM journal_entry_lines jel
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts coa WHERE coa.account_code = jel.account_code);

-- Check for invalid posting groups
SELECT COUNT(*) as invalid_rules
FROM posting_rules pr
WHERE is_active = 1
AND bus_posting_group_code IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM business_posting_groups bpg WHERE bpg.code = pr.bus_posting_group_code);
```

**Expected Results:** All counts should be 0
**Document:** In Phase 0 Report

### Step 3.2: Data Quality Metrics
```sql
-- Check for NULL values where not expected
SELECT 
  COUNT(CASE WHEN entry_date IS NULL THEN 1 END) as null_entry_dates,
  COUNT(CASE WHEN company_id IS NULL THEN 1 END) as null_company_ids,
  COUNT(CASE WHEN account_code IS NULL THEN 1 END) as null_account_codes
FROM journal_entries;

-- Check for journal balance
SELECT 
  entry_id,
  ABS(SUM(debit) - SUM(credit)) as imbalance
FROM journal_entry_lines
GROUP BY entry_id
HAVING imbalance > 0.01
LIMIT 10;
```

**Expected Results:**
- No unexpected NULLs
- No imbalanced entries

### Step 3.3: Create Integrity Report
**File:** `PHASE_0_DATA_INTEGRITY_REPORT.md`

**Contents:**
```markdown
# Data Integrity Verification Report

## Pre-Migration Checks

### Foreign Key Integrity
- ✅ Orphaned entries: 0
- ✅ Orphaned lines: 0
- ✅ Invalid accounts: 0
- ✅ Invalid posting groups: 0

### Data Quality
- ✅ NULL values: 0 (expected)
- ✅ Imbalanced entries: 0
- ✅ Negative amounts: [X] (acceptable)

### Conclusion
**Status:** ✅ READY FOR PHASE 1
All integrity checks passed.

## Sign-off
Data verified: _____ (Date)
DBA: _____ (Name)
```

---

## 🎯 Task 4: Team Preparation (2 hours)

### Step 4.1: Documentation Review
Each team member reads:
- [ ] README_POSTING_ENGINE_V2.md (5 min)
- [ ] POSTING_ENGINE_V2_EXECUTIVE_SUMMARY.md (10 min)
- [ ] POSTING_ENGINE_MODERNIZATION_ROADMAP.md (Phase 0-1 only, 15 min)
- [ ] POSTING_ENGINE_V2_IMPLEMENTATION_GUIDE.md (30 min)

**Total:** 60 minutes per person

### Step 4.2: Knowledge Transfer Session (1 hour)
**Attendees:** Sponsor, Tech Lead, Backend Dev, Frontend Dev, QA, DBA

**Agenda:**
```
0:00-0:05  Welcome & objectives
0:05-0:15  Executive Summary recap (Tech Lead)
0:15-0:25  Architecture overview (Architect)
0:25-0:35  Implementation timeline (PM)
0:35-0:45  Q&A
0:45-1:00  Breakout sessions by role
```

### Step 4.3: Environment Preparation
- [ ] Backend dev: Clone latest code, verify Node.js version
- [ ] Frontend dev: Clone latest code, verify npm packages
- [ ] DBA: Prepare D1 testing environment
- [ ] QA: Set up test case tracking (Jira/GitHub issues)

### Step 4.4: Create Team Checklist
**File:** `PHASE_0_TEAM_READINESS.md`

**Contents:**
```markdown
# Phase 0 Team Readiness Checklist

## Documentation Review
- [ ] Tech Lead read Roadmap
- [ ] Backend Dev read Implementation Guide
- [ ] Frontend Dev read Implementation Guide
- [ ] QA read Master Checklist
- [ ] DBA read Backup Strategy

## Knowledge Transfer
- [ ] Kickoff meeting held
- [ ] All questions answered
- [ ] Risk mitigation understood
- [ ] Rollback plan reviewed

## Environment Setup
- [ ] Git branch created: feature/posting-engine-v2
- [ ] TypeScript types file in place
- [ ] SQL migrations staged
- [ ] Development tools configured

## Sign-offs
- [ ] Tech Lead approval
- [ ] QA ready for testing
- [ ] Team confidence level: ___/10

Date: _____
By: _____
```

---

## 🎯 Task 5: Phase 1 Environment Preparation (1 hour)

### Step 5.1: Create Git Branch
```powershell
cd c:\Users\mahmo\Contacts\CLAUDE_CO\ WORK\ MY\ WORK\agri-nile-flow

git checkout -b feature/posting-engine-v2
git status

# Verify branch created
git branch | Select-String "posting-engine-v2"
```

### Step 5.2: Stage Migration Files
```powershell
# Create migrations directory if needed
New-Item -ItemType Directory -Path "./migrations" -Force

# Copy migration files
Copy-Item "./migrations/0051_posting_engine_phase1_basics.sql" -Destination "./migrations/" -Force
Copy-Item "./migrations/0052_master_data_tables.sql" -Destination "./migrations/" -Force

# Verify files
Get-Item "./migrations/005*.sql"
```

### Step 5.3: Prepare TypeScript Types
```powershell
# Verify posting_v2.ts exists
Test-Path "./src/types/posting_v2.ts"

# Check file size (should be 15+ KB)
Get-Item "./src/types/posting_v2.ts" | Select-Object Length
```

### Step 5.4: Create Phase 1 Kickoff Document
**File:** `PHASE_1_KICKOFF.md`

**Contents:**
```markdown
# Phase 1 Kickoff — Foundation

**Start Date:** May 6, 2026  
**Duration:** 2 weeks (May 6-19)  
**Deliverables:** 5 API endpoints + 1 UI page

## Tasks
1. Apply migrations 0051 + 0052
2. Implement backend API (5 endpoints)
3. Implement frontend UI (MasterDataPage)
4. Write tests
5. Code review & sign-off

## Success Criteria
- [ ] All migrations apply without error
- [ ] API endpoints respond correctly
- [ ] UI renders without errors
- [ ] 100% backward compatibility
- [ ] TypeScript compiles cleanly

## Team Assignments
- Backend Dev: Tasks 1-2
- Frontend Dev: Task 3
- QA: Task 4
- All: Code review

## Next Steps
See: POSTING_ENGINE_V2_IMPLEMENTATION_GUIDE.md → Phase 1
```

---

## ✅ Phase 0 Completion Checklist

Run this on **May 3-5** (before Phase 1 starts May 6):

```markdown
# Phase 0 Completion Checklist

## ✅ Data Audit (Task 1)
- [ ] Query 1: Posting rules summary — Result: ___
- [ ] Query 2: Journal entries summary — Result: ___
- [ ] Query 3: Journal lines summary — Result: ___
- [ ] Query 4: Chart of accounts summary — Result: ___
- [ ] Query 5: Business events summary — Result: ___
- [ ] Report file created: PHASE_0_DATA_AUDIT_REPORT.md
- [ ] Signed off by: _____ (DBA)

## ✅ Backup & Restore (Task 2)
- [ ] Full database export completed
- [ ] Backup file verified
- [ ] Backup file saved to project repo
- [ ] Backup file saved to Azure backup
- [ ] Backup strategy documented
- [ ] Signed off by: _____ (DBA)

## ✅ Data Integrity (Task 3)
- [ ] FK integrity check passed
- [ ] Data quality check passed
- [ ] All integrity tests: PASS
- [ ] Report file created: PHASE_0_DATA_INTEGRITY_REPORT.md
- [ ] Signed off by: _____ (DBA)

## ✅ Team Preparation (Task 4)
- [ ] All team members read documentation
- [ ] Knowledge transfer session held
- [ ] Team confidence: ___/10
- [ ] All questions answered
- [ ] Signed off by: _____ (Tech Lead)

## ✅ Environment Ready (Task 5)
- [ ] Git branch created: feature/posting-engine-v2
- [ ] Migration files staged
- [ ] TypeScript types file verified
- [ ] Phase 1 kickoff document created
- [ ] Signed off by: _____ (DevOps/Tech Lead)

## PHASE 0 STATUS
Date Completed: _____
Signed Off By: _____ (Tech Lead)
Status: ✅ READY FOR PHASE 1

## Issues Found (if any)
- Issue 1: _____
  Action: _____
  Resolved: □
- Issue 2: _____
  Action: _____
  Resolved: □

## Sign-Off for Phase 1 Start
Tech Lead: _____ (Signature) ___ (Date)
Sponsor: _____ (Signature) ___ (Date)
```

---

## 📊 Phase 0 Timeline

```
May 1 (Today)        Task 1: Data Audit (2 hrs)
May 2                Task 2: Backup & Restore (1.5 hrs)
May 3                Task 3: Data Integrity (1.5 hrs)
May 4                Task 4: Team Preparation (2 hrs)
May 5 (Sunday)       Task 5: Environment Prep (1 hr)
                     Review & final checks (1 hr)
May 6 (Monday)       🚀 PHASE 1 STARTS
```

---

## 🎯 Next Steps

**Do This Now (May 1):**
1. [ ] Read this entire Phase 0 plan
2. [ ] Assign team members to tasks
3. [ ] Schedule knowledge transfer meeting
4. [ ] Set calendar reminders

**Do This May 2-3:**
1. [ ] Run all data audit queries
2. [ ] Create backup
3. [ ] Verify data integrity

**Do This May 4-5:**
1. [ ] Team knowledge transfer
2. [ ] Prepare environment
3. [ ] Final review & sign-off

**Start Phase 1:** May 6, 2026 ✅

---

**Phase 0 Owner:** [DBA/Tech Lead Name]  
**Phase 0 Start:** May 1, 2026  
**Phase 0 End:** May 5, 2026  
**Phase 1 Start:** May 6, 2026
