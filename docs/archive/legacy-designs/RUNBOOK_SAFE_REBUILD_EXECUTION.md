# RUNBOOK SAFE REBUILD EXECUTION

هذا الـ Runbook يحول الاستراتيجية إلى تنفيذ فعلي بأوامر مرتبة وجاهزة.

القاعدة الأساسية:
- المسار الافتراضي هو Safe Derived Rebuild (يحافظ على الجداول التشغيلية ولا يحذفها).
- Full Reseed مسار منفصل وخطير ويُستخدم فقط إذا كان الهدف إعادة تحميل كاملة من ملفات SQL phase3.

## 0) Preconditions

1. أوقف الكتابة على الوحدات المالية/المخزون/الموردين أثناء التنفيذ.
2. نفذ في بيئة clone أولاً، ثم production بعد نجاح جميع البوابات.
3. نفذ كل الأوامر من PowerShell داخل جذر المشروع.

## 1) Session Bootstrap

نفذ:

```powershell
Set-Location "c:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow"

$Db = "agri-nile-flow-data-lake"
$Ts = Get-Date -Format "yyyyMMdd_HHmmss"
$RunDir = "reports\rebuild_run_$Ts"
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

"RUN_TS=$Ts" | Tee-Object -FilePath "$RunDir\00_run_meta.txt"
"DB=$Db" | Tee-Object -FilePath "$RunDir\00_run_meta.txt" -Append
"PWD=$(Get-Location)" | Tee-Object -FilePath "$RunDir\00_run_meta.txt" -Append
```

## 2) Backup and Baseline

### 2.1 Full D1 Export (Mandatory)

```powershell
npx wrangler d1 export $Db --remote --output "$RunDir\01_backup_full_$Ts.sql"
Get-FileHash "$RunDir\01_backup_full_$Ts.sql" -Algorithm SHA256 | Format-List | Out-File "$RunDir\01_backup_full_$Ts.sha256.txt"
```

### 2.2 Governance + Dry-Run Audit

```powershell
node scripts/production_governance_audit.js | Tee-Object "$RunDir\02_governance_audit.log"
node scripts/dry_run_posting_job.js | Tee-Object "$RunDir\03_posting_dry_run.log"
```

### 2.3 Canonical Contract and Staging Check

```powershell
node scripts/phase2_validate_contract.js | Tee-Object "$RunDir\04_phase2_validate_contract.log"
node scripts/phase2_build_canonical_staging.js | Tee-Object "$RunDir\05_phase2_build_staging.log"
node scripts/phase2_apply_staging_remediation_preview.js | Tee-Object "$RunDir\06_phase2_remediation_preview.log"
```

### 2.4 Pre-Snapshot (Counts + Candidate Volume)

```powershell
npx wrangler d1 execute $Db --remote --yes --json --file "sql/rebuild_safe/01_pre_snapshot.sql" | Out-File "$RunDir\07_pre_snapshot.json"
npx wrangler d1 execute $Db --remote --yes --json --file "sql/rebuild_safe/02_target_preview.sql" | Out-File "$RunDir\08_target_preview.json"
```

## 3) Cleanup Phase (Safe Derived Only)

هذا الجزء لا يحذف supplier_transactions أو cash_transactions أو inventory_movements.

### 3.1 Execute Derived Cleanup

```powershell
npx wrangler d1 execute $Db --remote --yes --json --file "sql/rebuild_safe/03_cleanup_derived_only.sql" | Out-File "$RunDir\09_cleanup_apply.json"
```

### 3.2 Post-Cleanup Snapshot

```powershell
npx wrangler d1 execute $Db --remote --yes --json --file "sql/rebuild_safe/04_post_cleanup_snapshot.sql" | Out-File "$RunDir\10_post_cleanup_snapshot.json"
```

## 4) Rebuild Phase

### 4.1 Recreate Posting (Canonical Script Path)

Dry-run تأكيدي إضافي:

```powershell
node scripts/execute_posting_job.js | Tee-Object "$RunDir\11_execute_posting_job_dry.log"
```

Apply فعلي:

```powershell
node scripts/execute_posting_job.js --apply | Tee-Object "$RunDir\12_execute_posting_job_apply.log"
```

### 4.2 Rebuild Traceability Bridge

```powershell
npx wrangler d1 execute $Db --remote --yes --json --file "sql/rebuild_safe/06_rebuild_traceability_bridge.sql" | Out-File "$RunDir\13_traceability_rebuild.json"
```

### 4.3 Rebuild Inventory Balances (if required)

```powershell
npx wrangler d1 execute $Db --remote --yes --json --file "scripts/rebuild_balances_from_ledger.sql" | Out-File "$RunDir\14_rebuild_inventory_balances.json"
```

## 5) Final Validation Gates

### 5.1 Integrity Checks

```powershell
npx wrangler d1 execute $Db --remote --yes --json --file "sql/rebuild_safe/05_posting_integrity_checks.sql" | Out-File "$RunDir\15_posting_integrity_checks.json"
node scripts/production_governance_audit.js | Tee-Object "$RunDir\16_governance_audit_post.log"
```

### 5.2 Optional Verify Script

```powershell
node scripts/verify_phase3_reseed.js | Tee-Object "$RunDir\17_verify_phase3_reseed.log"
```

ملاحظة: هذا السكربت موروث من phase3 وقد يعطي توقعات رقمية قديمة؛ استخدمه كإشارة إضافية فقط وليس gate وحيد.

## 6) Go/No-Go Rules

نفذ Go Live فقط إذا تحققت الشروط التالية:

1. لا يوجد blocking findings في production_governance_audit post-run.
2. unbalanced_entries = 0 في 05_posting_integrity_checks.
3. unlinked_posted_rows = 0 أو ضمن الحالات المسموحة الموثقة.
4. orphan_source_documents = 0 و orphan_source_document_links = 0.
5. diff إجمالي المدين/الدائن بعد التنفيذ = 0.00 ضمن tolerances.

## 7) Rollback Procedure

إذا فشل أي gate حرج:

1. أوقف الكتابة فوراً.
2. خذ export جديد لحالة الفشل للتحليل.
3. استرجع backup:

```powershell
npx wrangler d1 execute $Db --remote --yes --file "$RunDir\01_backup_full_$Ts.sql"
```

4. أعد تشغيل baseline checks للتأكد من عودة الحالة.

## 8) Optional Path B: Full Reseed (Destructive)

استخدم هذا المسار فقط لو الهدف إعادة تحميل كاملة تشغيلية + مشتقات من phase3 artifacts.

### 8.1 Run Phase3 Wipe + Reseed

```powershell
node scripts/run_phase3_reseed.js | Tee-Object "$RunDir\B1_phase3_reseed.log"
```

### 8.2 Verify Reseed

```powershell
node scripts/verify_phase3_reseed.js | Tee-Object "$RunDir\B2_phase3_reseed_verify.log"
```

### 8.3 Then Continue from Step 4

بعد ذلك ارجع إلى Step 4 لإعادة بناء posting + traceability.

## 9) Command Order Summary

1. Step 1 Session Bootstrap
2. Step 2 Backup and Baseline
3. Step 3 Cleanup Phase (Safe Derived Only)
4. Step 4 Rebuild Phase
5. Step 5 Final Validation Gates
6. Step 6 Go/No-Go
7. Step 7 Rollback if needed
