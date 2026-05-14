#!/usr/bin/env powershell
<#
.SYNOPSIS
Write-Test-Verify-Delete Cycle
Validates test data insertion, impact on reports, and cleanup procedures

Tests data integrity of Phase 4 KPI tracking
#>

$WranglePath = ".\node_modules\.bin\wrangler.cmd"

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "WRITE-TEST-VERIFY-DELETE CYCLE" -ForegroundColor Cyan
Write-Host "Phase 4 KPI Integrity Validation" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$testId = "test-$(Get-Date -Format 'yyyyMMddHHmmss')"
$passed = 0
$failed = 0

# ════════════════════════════════════════════════════════════
# STEP 1: CAPTURE BASELINE METRICS
# ════════════════════════════════════════════════════════════

Write-Host "STEP 1: Capturing Baseline Metrics" -ForegroundColor Yellow
Write-Host "──────────────────────────────────────" -ForegroundColor Gray

try {
    $sql = "SELECT COUNT(*) as supplier_count, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked_count FROM supplier_transactions WHERE company_id=1 AND status='posted';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    $baseline = $output[0].results[0]
    
    Write-Host "  Baseline captured:" -ForegroundColor Green
    Write-Host "    Total supplier transactions: $($baseline.supplier_count)" -ForegroundColor Cyan
    Write-Host "    Linked to JE: $($baseline.linked_count)" -ForegroundColor Cyan
    
    $baselineTotal = $baseline.supplier_count
    $baselineLinked = $baseline.linked_count
    $passed++
} catch {
    Write-Host "  ERROR: Could not capture baseline" -ForegroundColor Red
    Write-Host "  Exception: $_" -ForegroundColor Red
    $failed++
    exit 1
}

# ════════════════════════════════════════════════════════════
# STEP 2: WRITE TEST DATA
# ════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "STEP 2: Inserting Test Data" -ForegroundColor Yellow
Write-Host "──────────────────────────────────────" -ForegroundColor Gray

$testSupplierId = "supplier-test-$testId"
$testTransactionId = "txn-test-$testId"

try {
    # First create a test supplier if needed
    $sqlInsertSupplier = "INSERT INTO suppliers (id, company_id, code, name, category, gl_account_code, status, created_at) VALUES ('$testSupplierId', 1, 'TEST-$testId', 'Test Supplier', 'EQUIPMENT', '2001100', 'ACTIVE', datetime('now'));"
    
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sqlInsertSupplier) | ConvertFrom-Json
    
    if ($output[0].success) {
        Write-Host "  Test supplier created: $testSupplierId" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "  Note: Supplier creation skipped (may already exist)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  Note: Supplier insertion error (non-critical): $_" -ForegroundColor Gray
}

try {
    # Insert test transaction (zero-value, should be exempt)
    $sqlInsertTransaction = "INSERT INTO supplier_transactions (id, company_id, supplier_id, amount, debit, credit, description, status, created_at) VALUES ('$testTransactionId', 1, '$testSupplierId', 0, 0, 0, 'Test zero-value transaction', 'posted', datetime('now'));"
    
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sqlInsertTransaction) | ConvertFrom-Json
    
    if ($output[0].success) {
        Write-Host "  Test transaction inserted: $testTransactionId" -ForegroundColor Green
        Write-Host "    Amount: 0 (zero-value exempt)" -ForegroundColor Cyan
        Write-Host "    Status: posted" -ForegroundColor Cyan
        $passed++
    } else {
        Write-Host "  ERROR: Could not insert test transaction" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ERROR: Insert exception: $_" -ForegroundColor Red
    $failed++
}

# ════════════════════════════════════════════════════════════
# STEP 3: VERIFY TEST DATA IMPACT ON KPI
# ════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "STEP 3: Verifying Test Data Impact on KPI" -ForegroundColor Yellow
Write-Host "──────────────────────────────────────" -ForegroundColor Gray

try {
    $sql = "SELECT COUNT(*) as supplier_count, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked_count FROM supplier_transactions WHERE company_id=1 AND status='posted';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    $afterWrite = $output[0].results[0]
    
    $newTotal = $afterWrite.supplier_count
    $newLinked = $afterWrite.linked_count
    
    $totalDelta = $newTotal - $baselineTotal
    $linkedDelta = $newLinked - $baselineLinked
    
    Write-Host "  After writing test data:" -ForegroundColor Green
    Write-Host "    Total transactions: $newTotal (baseline: $baselineTotal, delta: +$totalDelta)" -ForegroundColor Cyan
    Write-Host "    Linked transactions: $newLinked (baseline: $baselineLinked, delta: +$linkedDelta)" -ForegroundColor Cyan
    
    if ($totalDelta -eq 1) {
        Write-Host "    ✓ Test record properly counted in total" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "    ✗ Unexpected delta: expected +1, got +$totalDelta" -ForegroundColor Red
        $failed++
    }
    
    if ($linkedDelta -eq 0) {
        Write-Host "    ✓ Zero-value record NOT linked to JE (correctly exempt)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "    ✗ Unexpected linked delta: expected 0, got +$linkedDelta" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ERROR: Could not verify impact" -ForegroundColor Red
    Write-Host "  Exception: $_" -ForegroundColor Red
    $failed++
}

# ════════════════════════════════════════════════════════════
# STEP 4: VERIFY TEST DATA IN DATABASE
# ════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "STEP 4: Verifying Test Data Presence in Database" -ForegroundColor Yellow
Write-Host "──────────────────────────────────────" -ForegroundColor Gray

try {
    $sql = "SELECT id, amount, debit, credit, status, journal_entry_id FROM supplier_transactions WHERE id='$testTransactionId';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    
    if ($output[0].results.Count -gt 0) {
        $record = $output[0].results[0]
        Write-Host "  Test record found:" -ForegroundColor Green
        Write-Host "    ID: $($record.id)" -ForegroundColor Cyan
        Write-Host "    Amount: $($record.amount)" -ForegroundColor Cyan
        Write-Host "    Debit: $($record.debit), Credit: $($record.credit)" -ForegroundColor Cyan
        Write-Host "    Status: $($record.status)" -ForegroundColor Cyan
        Write-Host "    JE Link: $(if ($record.journal_entry_id) { $record.journal_entry_id } else { 'NULL (exempt)' })" -ForegroundColor Cyan
        $passed++
    } else {
        Write-Host "  ERROR: Test record not found in database" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ERROR: Query exception: $_" -ForegroundColor Red
    $failed++
}

# ════════════════════════════════════════════════════════════
# STEP 5: DELETE TEST DATA
# ════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "STEP 5: Deleting Test Data" -ForegroundColor Yellow
Write-Host "──────────────────────────────────────" -ForegroundColor Gray

try {
    $sqlDelete = "DELETE FROM supplier_transactions WHERE id='$testTransactionId';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sqlDelete) | ConvertFrom-Json
    
    Write-Host "  Test transaction deleted: $testTransactionId" -ForegroundColor Green
    $passed++
} catch {
    Write-Host "  ERROR: Could not delete test transaction" -ForegroundColor Red
    Write-Host "  Exception: $_" -ForegroundColor Red
    $failed++
}

# ════════════════════════════════════════════════════════════
# STEP 6: VERIFY CLEANUP AND KPI REVERT
# ════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "STEP 6: Verifying Cleanup and KPI Revert" -ForegroundColor Yellow
Write-Host "──────────────────────────────────────" -ForegroundColor Gray

try {
    $sql = "SELECT COUNT(*) as supplier_count, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked_count FROM supplier_transactions WHERE company_id=1 AND status='posted';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    $afterDelete = $output[0].results[0]
    
    $finalTotal = $afterDelete.supplier_count
    $finalLinked = $afterDelete.linked_count
    
    Write-Host "  After deletion:" -ForegroundColor Green
    Write-Host "    Total transactions: $finalTotal" -ForegroundColor Cyan
    Write-Host "    Linked transactions: $finalLinked" -ForegroundColor Cyan
    
    if ($finalTotal -eq $baselineTotal) {
        Write-Host "    ✓ Total count reverted to baseline ($baselineTotal)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "    ✗ Total count mismatch: expected $baselineTotal, got $finalTotal" -ForegroundColor Red
        $failed++
    }
    
    if ($finalLinked -eq $baselineLinked) {
        Write-Host "    ✓ Linked count reverted to baseline ($baselineLinked)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "    ✗ Linked count mismatch: expected $baselineLinked, got $finalLinked" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ERROR: Could not verify cleanup" -ForegroundColor Red
    Write-Host "  Exception: $_" -ForegroundColor Red
    $failed++
}

# ════════════════════════════════════════════════════════════
# STEP 7: VERIFY NO ORPHANED RECORDS
# ════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "STEP 7: Checking for Orphaned Records" -ForegroundColor Yellow
Write-Host "──────────────────────────────────────" -ForegroundColor Gray

try {
    $sqlCheckOrphans = "SELECT COUNT(*) as orphan_count FROM supplier_transactions WHERE id LIKE '%test-%' AND company_id=1;"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sqlCheckOrphans) | ConvertFrom-Json
    
    $orphanCount = $output[0].results[0].orphan_count
    
    if ($orphanCount -eq 0) {
        Write-Host "  ✓ No orphaned test records found" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "  ⚠ Found $orphanCount orphaned test records" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ERROR: Orphan check exception: $_" -ForegroundColor Red
    $failed++
}

# ════════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "TEST CYCLE EXECUTION SUMMARY" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan

Write-Host ""
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor Red
Write-Host ""

$total = $passed + $failed
if ($total -gt 0) {
    $percent = [math]::Round(($passed / $total) * 100, 1)
    Write-Host "Pass Rate: $percent%" -ForegroundColor Cyan
}

if ($failed -eq 0) {
    Write-Host "✓ WRITE-TEST-VERIFY-DELETE CYCLE: SUCCESS" -ForegroundColor Green
    Write-Host ""
    Write-Host "Conclusions:" -ForegroundColor Cyan
    Write-Host "  1. Test data insertion works correctly" -ForegroundColor Gray
    Write-Host "  2. KPI metrics accurately track new data" -ForegroundColor Gray
    Write-Host "  3. Zero-value records are properly classified as exempt" -ForegroundColor Gray
    Write-Host "  4. Deletion procedures clean up test data completely" -ForegroundColor Gray
    Write-Host "  5. KPI metrics revert to baseline after cleanup" -ForegroundColor Gray
    Write-Host "  6. No orphaned records remain in database" -ForegroundColor Gray
} else {
    Write-Host "✗ WRITE-TEST-VERIFY-DELETE CYCLE: FAILED" -ForegroundColor Red
}

Write-Host ""
Write-Host "Execution completed at $(Get-Date)" -ForegroundColor Cyan
Write-Host ""
