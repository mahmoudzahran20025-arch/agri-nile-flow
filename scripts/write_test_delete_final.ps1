
# Write-Test-Verify-Delete Cycle - Simple Version

$WranglePath = ".\node_modules\.bin\wrangler.cmd"

Write-Host ""
Write-Host "Phase 4 - Write-Test-Verify-Delete Cycle" -ForegroundColor Cyan
Write-Host ""

$testId = "test-$(Get-Date -Format 'yyyyMMddHHmmss')"
$passed = 0
$failed = 0

# Step 1: Baseline
Write-Host "STEP 1: Capturing Baseline" -ForegroundColor Yellow
try {
    $sql = "SELECT COUNT(*) as total, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked FROM supplier_transactions WHERE company_id=1 AND status='posted';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    $baseline = $output[0].results[0]
    
    Write-Host "  Baseline: Total=$($baseline.total), Linked=$($baseline.linked)" -ForegroundColor Green
    $baselineTotal = $baseline.total
    $baselineLinked = $baseline.linked
    $passed++
} catch {
    Write-Host "  ERROR: $_" -ForegroundColor Red
    $failed++
    exit 1
}

# Step 2: Insert Test Data
Write-Host ""
Write-Host "STEP 2: Inserting Test Data" -ForegroundColor Yellow
$testTxnId = "txn-$testId"

try {
    $sqlInsert = "INSERT INTO supplier_transactions (company_id, supplier_code, amount, debit, credit, description, status, transaction_date, entry_type, created_at) VALUES (1, 9999, 0, 0, 0, 'Test', 'posted', date('now'), 'EXPENSE', datetime('now'));"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sqlInsert) | ConvertFrom-Json
    
    if ($output[0].success) {
        $testTxnId = $output[0].meta.last_row_id
        Write-Host "  Test transaction inserted with ID: $testTxnId" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "  ERROR: Insert failed" -ForegroundColor Red
        Write-Host "  Details: $($output[0].error.notes[0].text)" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ERROR: $_" -ForegroundColor Red
    $failed++
}

# Step 3: Verify Impact
Write-Host ""
Write-Host "STEP 3: Verifying Impact on KPI" -ForegroundColor Yellow
try {
    $sql = "SELECT COUNT(*) as total, SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) as linked FROM supplier_transactions WHERE company_id=1 AND status='posted';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    $after = $output[0].results[0]
    
    $newTotal = $after.total
    $totalDelta = $newTotal - $baselineTotal
    
    Write-Host "  After insert: Total=$newTotal (delta: +$totalDelta)" -ForegroundColor Green
    
    if ($totalDelta -eq 1) {
        Write-Host "  OK: Record counted in total" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "  ERROR: Unexpected delta" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ERROR: $_" -ForegroundColor Red
    $failed++
}

# Step 4: Delete Test Data
Write-Host ""
Write-Host "STEP 4: Deleting Test Data" -ForegroundColor Yellow
try {
    if ($testTxnId) {
        $sqlDelete = "DELETE FROM supplier_transactions WHERE id=$testTxnId;"
        $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sqlDelete) | ConvertFrom-Json
        
        Write-Host "  Test transaction deleted: ID=$testTxnId" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "  SKIP: No test transaction ID to delete" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ERROR: $_" -ForegroundColor Red
    $failed++
}

# Step 5: Verify Revert
Write-Host ""
Write-Host "STEP 5: Verifying KPI Revert" -ForegroundColor Yellow
try {
    $sql = "SELECT COUNT(*) as total FROM supplier_transactions WHERE company_id=1 AND status='posted';"
    $output = (& $WranglePath d1 execute agri-nile-flow-data-lake --remote --json --command $sql) | ConvertFrom-Json
    $final = $output[0].results[0]
    
    $finalTotal = $final.total
    
    Write-Host "  After delete: Total=$finalTotal" -ForegroundColor Green
    
    if ($finalTotal -eq $baselineTotal) {
        Write-Host "  OK: Reverted to baseline" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "  ERROR: Not reverted to baseline" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ERROR: $_" -ForegroundColor Red
    $failed++
}

# Summary
Write-Host ""
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor Red

if ($failed -eq 0) {
    Write-Host ""
    Write-Host "SUCCESS: Write-Test-Verify-Delete cycle completed successfully" -ForegroundColor Green
    Write-Host "- Test data can be written" -ForegroundColor Green
    Write-Host "- KPI metrics track changes accurately" -ForegroundColor Green
    Write-Host "- Cleanup procedures work correctly" -ForegroundColor Green
    Write-Host "- Metrics revert to baseline" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "FAILED: Cycle completed with errors" -ForegroundColor Red
}

Write-Host ""
Write-Host "Completed at $(Get-Date)" -ForegroundColor Cyan
Write-Host ""
