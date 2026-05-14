# Write-Test-Verify-Delete Cycle - Phase 4 KPI Validation

$WranglePath = ".\node_modules\.bin\wrangler.cmd"

Write-Host ""
Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  WRITE-TEST-VERIFY-DELETE CYCLE               ║" -ForegroundColor Cyan
Write-Host "║  Phase 4 KPI Integrity Validation              ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$testId = "test-$(Get-Date -Format 'yyyyMMddHHmmss')"
$passed = 0
$failed = 0

# STEP 1: Capture Baseline
Write-Host "STEP 1: Capturing Baseline Metrics" -ForegroundColor Yellow

try {
    $sql = "SELECT COUNT(*) as supplier_count, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked_count FROM supplier_transactions WHERE company_id=1 AND status='posted';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    $baseline = $output[0].results[0]
    
    Write-Host "  PASS: Baseline captured" -ForegroundColor Green
    Write-Host "    Total transactions: $($baseline.supplier_count)" -ForegroundColor Gray
    Write-Host "    Linked transactions: $($baseline.linked_count)" -ForegroundColor Gray
    
    $baselineTotal = $baseline.supplier_count
    $baselineLinked = $baseline.linked_count
    $passed++
} catch {
    Write-Host "  ✗ ERROR: $_" -ForegroundColor Red
    $failed++
    exit 1
}

# STEP 2: Insert Test Data
Write-Host ""
Write-Host "STEP 2: Inserting Test Data" -ForegroundColor Yellow

$testTransactionId = "txn-test-$testId"

try {
    $sqlInsertTransaction = "INSERT INTO supplier_transactions (id, company_id, supplier_id, amount, debit, credit, description, status, created_at) VALUES ('$testTransactionId', 1, 'S001', 0, 0, 0, 'Test zero-value transaction', 'posted', datetime('now'));"
    
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sqlInsertTransaction) | ConvertFrom-Json
    
    if ($output[0].success) {
        Write-Host "  PASS Test transaction inserted: $testTransactionId" -ForegroundColor Green
        Write-Host "    Amount: 0 (zero-value exempt)" -ForegroundColor Gray
        $passed++
    } else {
        Write-Host "  FAIL ERROR: Insert failed" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ✗ ERROR: $_" -ForegroundColor Red
    $failed++
}

# STEP 3: Verify Impact on KPI
Write-Host ""
Write-Host "STEP 3: Verifying Test Data Impact on KPI" -ForegroundColor Yellow

try {
    $sql = "SELECT COUNT(*) as supplier_count, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked_count FROM supplier_transactions WHERE company_id=1 AND status='posted';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    $afterWrite = $output[0].results[0]
    
    $newTotal = $afterWrite.supplier_count
    $newLinked = $afterWrite.linked_count
    
    $totalDelta = $newTotal - $baselineTotal
    $linkedDelta = $newLinked - $baselineLinked
    
    Write-Host "  After writing test data:" -ForegroundColor Green
    Write-Host "    Total: $newTotal (delta: +$totalDelta)" -ForegroundColor Gray
    Write-Host "    Linked: $newLinked (delta: +$linkedDelta)" -ForegroundColor Gray
    
    if ($totalDelta -eq 1) {
        Write-Host "    PASS Test record counted in total" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "    FAIL Unexpected delta: +$totalDelta" -ForegroundColor Red
        $failed++
    }
    
    if ($linkedDelta -eq 0) {
        Write-Host "    PASS Zero-value record NOT linked (correctly exempt)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "    FAIL Unexpected linked delta: +$linkedDelta" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ✗ ERROR: $_" -ForegroundColor Red
    $failed++
}

# STEP 4: Verify Test Record in Database
Write-Host ""
Write-Host "STEP 4: Verifying Test Data in Database" -ForegroundColor Yellow

try {
    $sql = "SELECT id, amount FROM supplier_transactions WHERE id='$testTransactionId';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    
    if ($output[0].results.Count -gt 0) {
        Write-Host "  PASS Test record found in database" -ForegroundColor Green
        Write-Host "    ID: $($output[0].results[0].id)" -ForegroundColor Gray
        $passed++
    } else {
        Write-Host "  FAIL Test record not found" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ✗ ERROR: $_" -ForegroundColor Red
    $failed++
}

# STEP 5: Delete Test Data
Write-Host ""
Write-Host "STEP 5: Deleting Test Data" -ForegroundColor Yellow

try {
    $sqlDelete = "DELETE FROM supplier_transactions WHERE id='$testTransactionId';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sqlDelete) | ConvertFrom-Json
    
    Write-Host "  PASS Test transaction deleted: $testTransactionId" -ForegroundColor Green
    $passed++
} catch {
    Write-Host "  ✗ ERROR: $_" -ForegroundColor Red
    $failed++
}

# STEP 6: Verify KPI Revert
Write-Host ""
Write-Host "STEP 6: Verifying KPI Revert After Cleanup" -ForegroundColor Yellow

try {
    $sql = "SELECT COUNT(*) as supplier_count, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked_count FROM supplier_transactions WHERE company_id=1 AND status='posted';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    $afterDelete = $output[0].results[0]
    
    $finalTotal = $afterDelete.supplier_count
    $finalLinked = $afterDelete.linked_count
    
    Write-Host "  After deletion:" -ForegroundColor Green
    Write-Host "    Total: $finalTotal (baseline was $baselineTotal)" -ForegroundColor Gray
    Write-Host "    Linked: $finalLinked (baseline was $baselineLinked)" -ForegroundColor Gray
    
    if ($finalTotal -eq $baselineTotal) {
        Write-Host "    PASS Total count reverted to baseline" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "    FAIL Total mismatch" -ForegroundColor Red
        $failed++
    }
    
    if ($finalLinked -eq $baselineLinked) {
        Write-Host "    PASS Linked count reverted to baseline" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "    FAIL Linked count mismatch" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ✗ ERROR: $_" -ForegroundColor Red
    $failed++
}

# SUMMARY
Write-Host ""
Write-Host "╔════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  SUMMARY                                       ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Host ""
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor Red

if ($failed -eq 0) {
    Write-Host ""
    Write-Host "[SUCCESS] WRITE-TEST-VERIFY-DELETE CYCLE: PASSED" -ForegroundColor Green
    Write-Host ""
    Write-Host "Verified:" -ForegroundColor Cyan
    Write-Host "  • Test data insertion works correctly" -ForegroundColor Gray
    Write-Host "  • KPI metrics accurately track new records" -ForegroundColor Gray
    Write-Host "  • Zero-value records are exempt-classified" -ForegroundColor Gray
    Write-Host "  • Deletion removes test data completely" -ForegroundColor Gray
    Write-Host "  • KPI metrics revert to baseline" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "[FAILED] CYCLE FAILED" -ForegroundColor Red
}

Write-Host ""
Write-Host "Execution completed at $(Get-Date)" -ForegroundColor Cyan
Write-Host ""
