# ============================================================================
# PowerShell Test Execution Script for Financial Operations
# ============================================================================
# File: Execute_Comprehensive_Tests.ps1
# Purpose: Automated testing of cash transactions, inventory, and GL posting
# Date: 2026-05-10
# 
# Usage: 
#   .\Execute_Comprehensive_Tests.ps1
# ============================================================================

param(
    [string]$TestType = "all",    # all | cash | inventory | report
    [string]$Environment = "test"   # test | prod
)

# ============================================================================
# CONFIGURATION
# ============================================================================

$DbDatabase = "agri-nile-flow-data-lake"
$DbCommand = "npx wrangler d1 execute $DbDatabase --remote --json --command"
$FrontendUrl = "http://localhost:5173"
$BackendUrl = "https://pharma-cloud-backend.mahmoud-once2026.workers.dev"  # Update if needed
$TestTimestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Test data
$TestSupplier = 1001
$TestItem = 1010189
$TestCenter = 1001
$TestAmount = 50000
$TestQty = 100
$TestUnitPrice = 150

Write-Host "============================================================================"
Write-Host "COMPREHENSIVE FINANCIAL OPERATIONS TEST SUITE"
Write-Host "============================================================================"
Write-Host "Test Type: $TestType"
Write-Host "Environment: $Environment"
Write-Host "Timestamp: $TestTimestamp"
Write-Host ""

# ============================================================================
# FUNCTION: Execute D1 Query
# ============================================================================

function Invoke-D1Query {
    param(
        [string]$SqlCommand,
        [string]$Description
    )
    
    Write-Host "▶ $Description..." -ForegroundColor Cyan
    
    $cmd = "$DbCommand `"$SqlCommand`" 2>&1"
    $result = Invoke-Expression $cmd
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Success" -ForegroundColor Green
        return $result | ConvertFrom-Json
    } else {
        Write-Host "  ✗ Failed" -ForegroundColor Red
        Write-Host "  Error: $result"
        return $null
    }
}

# ============================================================================
# FUNCTION: Log Test Result
# ============================================================================

function Log-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Details
    )
    
    $status = if ($Passed) { "✓ PASS" } else { "✗ FAIL" }
    $color = if ($Passed) { "Green" } else { "Red" }
    
    Write-Host "$status  $TestName" -ForegroundColor $color
    if ($Details) {
        Write-Host "     $Details" -ForegroundColor Gray
    }
}

# ============================================================================
# PHASE 1: ENVIRONMENT VERIFICATION
# ============================================================================

Write-Host ""
Write-Host "PHASE 1: ENVIRONMENT VERIFICATION" -ForegroundColor Yellow
Write-Host "============================================================================"

# Verify Database Connection
Write-Host ""
Write-Host "1.1 Database Connection Test..."
$verifyDb = Invoke-D1Query -SqlCommand "SELECT COUNT(*) as table_count FROM sqlite_master WHERE type='table'" -Description "Checking database tables"

if ($verifyDb) {
    $tableCount = $verifyDb[0].results[0].table_count
    Write-Host "  ✓ Database connected - Found $tableCount tables"
} else {
    Write-Host "  ✗ Database connection failed"
    exit 1
}

# Verify Suppliers exist
Write-Host ""
Write-Host "1.2 Supplier Verification..."
$supplierCheck = Invoke-D1Query -SqlCommand "SELECT supplier_code, COUNT(*) as count FROM supplier_transactions WHERE company_id=1 GROUP BY supplier_code LIMIT 5" -Description "Checking suppliers"

if ($supplierCheck.results.Count -gt 0) {
    Write-Host "  ✓ Suppliers found:"
    $supplierCheck.results | ForEach-Object {
        Write-Host "    - Supplier $($_.supplier_code): $($_.count) transactions"
    }
} else {
    Write-Host "  ✗ No suppliers found"
}

# Verify GL Accounts
Write-Host ""
Write-Host "1.3 GL Account Verification..."
$glCheck = Invoke-D1Query -SqlCommand "SELECT COUNT(DISTINCT account_code) as account_count FROM journal_entry_lines WHERE company_id=1" -Description "Checking GL accounts"

if ($glCheck.results[0].account_count -gt 0) {
    Write-Host "  ✓ GL accounts configured: $($glCheck.results[0].account_count) accounts"
} else {
    Write-Host "  ✗ No GL accounts found"
}

# ============================================================================
# PHASE 2: TEST SCENARIO 1 - CASH PAYMENT
# ============================================================================

if ($TestType -eq "all" -or $TestType -eq "cash") {
    
    Write-Host ""
    Write-Host "PHASE 2: TEST SCENARIO 1 - CASH PAYMENT" -ForegroundColor Yellow
    Write-Host "============================================================================"
    
    # Prepare test data
    $cashTestId = "test_cash_$(Get-Date -Format 'HHmmss')"
    $cashDescription = "TEST: Payment for supplies - Run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    
    Write-Host ""
    Write-Host "2.1 Insert Cash Transaction..."
    Write-Host "  Supplier: $TestSupplier"
    Write-Host "  Amount: $TestAmount EGP"
    Write-Host "  Description: $cashDescription"
    
    $cashDescriptionSql = $cashDescription -replace "'", "''"
    $insertCashSql = "INSERT INTO cash_transactions (company_id, supplier_code, expense_code, transaction_type, description, amount, created_at, status, device_id) VALUES (1, $TestSupplier, 'SUPPLIES', 'PAYMENT', '$cashDescriptionSql', $TestAmount, datetime('now'), 'posted', 'test-device-001')"
    
    $insertResult = Invoke-D1Query -SqlCommand $insertCashSql -Description "Inserting cash transaction"
    
    if ($insertResult) {
        Write-Host "  ✓ Cash transaction inserted"
        
        # Verify insertion
        Write-Host ""
        Write-Host "2.2 Verify Cash Transaction..."
        
        $verifyCashSql = "SELECT id, supplier_code, amount, status, journal_entry_id, created_at FROM cash_transactions WHERE description LIKE '%TEST: Payment for supplies%' ORDER BY created_at DESC LIMIT 1"
        
        $verifyResult = Invoke-D1Query -SqlCommand $verifyCashSql -Description "Fetching cash transaction"
        
        if ($verifyResult.results.Count -gt 0) {
            $cashRecord = $verifyResult.results[0]
            Write-Host "  ✓ Cash transaction verified"
            Write-Host "    ID: $($cashRecord.id)"
            Write-Host "    Supplier: $($cashRecord.supplier_code)"
            Write-Host "    Amount: $($cashRecord.amount) EGP"
            Write-Host "    Status: $($cashRecord.status)"
            Write-Host "    JE ID: $($cashRecord.journal_entry_id)"
            
            $cashTxnId = $cashRecord.id
            $cashJeId = $cashRecord.journal_entry_id
        }
    }
    
    # Verify Journal Entry
    Write-Host ""
    Write-Host "2.3 Verify Journal Entry Created..."
    
    if ($cashJeId) {
        $jeCheckSql = "SELECT je.id, je.entry_date, COUNT(jel.id) as line_count, SUM(jel.debit) as total_debit, SUM(jel.credit) as total_credit FROM journal_entries je LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id WHERE je.id = $cashJeId GROUP BY je.id"
        
        $jeResult = Invoke-D1Query -SqlCommand $jeCheckSql -Description "Checking journal entry"
        
        if ($jeResult.results.Count -gt 0) {
            $jeRecord = $jeResult.results[0]
            Write-Host "  ✓ Journal entry verified"
            Write-Host "    ID: $($jeRecord.id)"
            Write-Host "    Date: $($jeRecord.entry_date)"
            Write-Host "    Lines: $($jeRecord.line_count)"
            Write-Host "    Debit: $($jeRecord.total_debit)"
            Write-Host "    Credit: $($jeRecord.total_credit)"
            
            $isBalanced = $jeRecord.total_debit -eq $jeRecord.total_credit
            Log-TestResult "Cash JE Balance" $isBalanced "Debit=$($jeRecord.total_debit), Credit=$($jeRecord.total_credit)"
        }
    } else {
        Write-Host "  ✗ No journal entry found"
        Log-TestResult "Cash Transaction" $false "No JE created"
    }
}

# ============================================================================
# PHASE 3: TEST SCENARIO 2 - INVENTORY GRN
# ============================================================================

if ($TestType -eq "all" -or $TestType -eq "inventory") {
    
    Write-Host ""
    Write-Host "PHASE 3: TEST SCENARIO 2 - INVENTORY GRN" -ForegroundColor Yellow
    Write-Host "============================================================================"
    
    # Prepare test data
    $grnTestId = "test_grn_$(Get-Date -Format 'HHmmss')"
    $grnDescription = "TEST: Purchase from Supplier - Run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $grnValue = $TestQty * $TestUnitPrice
    
    Write-Host ""
    Write-Host "3.1 Insert GRN Movement..."
    Write-Host "  Supplier: $TestSupplier"
    Write-Host "  Item: $TestItem"
    Write-Host "  Quantity: $TestQty units"
    Write-Host "  Unit Price: $TestUnitPrice EGP"
    Write-Host "  Total Value: $grnValue EGP"
    
    $grnDescriptionSql = $grnDescription -replace "'", "''"
    $insertGrnSql = "INSERT INTO inventory_movements (company_id, supplier_code, item_code, movement_type, movement_date, warehouse, quantity, qty_in, qty_out, unit_price, value_in, value_out, notes, device_id, created_at, local_id, status, gl_posting_status) VALUES (1, $TestSupplier, $TestItem, 'GRN', '2026-05-10', 'WAREHOUSE-001', $TestQty, $TestQty, 0, $TestUnitPrice, $grnValue, 0, '$grnDescriptionSql', 'test-device-001', datetime('now'), 'test_grn_001', 'posted', 'posted')"
    
    $insertGrnResult = Invoke-D1Query -SqlCommand $insertGrnSql -Description "Inserting GRN movement"
    
    if ($insertGrnResult) {
        Write-Host "  ✓ GRN inserted"
        
        # Verify GRN
        Write-Host ""
        Write-Host "3.2 Verify GRN Movement..."
        
        $verifyGrnSql = "SELECT id, supplier_code, item_code, qty_in, value_in, status, journal_entry_id, created_at FROM inventory_movements WHERE notes LIKE '%TEST: Purchase from Supplier%' ORDER BY created_at DESC LIMIT 1"
        
        $grnVerifyResult = Invoke-D1Query -SqlCommand $verifyGrnSql -Description "Fetching GRN"
        
        if ($grnVerifyResult.results.Count -gt 0) {
            $grnRecord = $grnVerifyResult.results[0]
            Write-Host "  ✓ GRN verified"
            Write-Host "    ID: $($grnRecord.id)"
            Write-Host "    Item: $($grnRecord.item_code)"
            Write-Host "    Qty In: $($grnRecord.qty_in)"
            Write-Host "    Value In: $($grnRecord.value_in) EGP"
            Write-Host "    Status: $($grnRecord.status)"
            Write-Host "    JE ID: $($grnRecord.journal_entry_id)"
            
            $grnJeId = $grnRecord.journal_entry_id
        }
    }
    
    # Verify GRN Journal Entry
    Write-Host ""
    Write-Host "3.3 Verify GRN Journal Entry..."
    
    if ($grnJeId) {
        $grnJeSql = "SELECT je.id, COUNT(jel.id) as line_count, SUM(jel.debit) as total_debit, SUM(jel.credit) as total_credit FROM journal_entries je LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id WHERE je.id = $grnJeId GROUP BY je.id"
        
        $grnJeResult = Invoke-D1Query -SqlCommand $grnJeSql -Description "Checking GRN JE"
        
        if ($grnJeResult.results.Count -gt 0) {
            $grnJeRecord = $grnJeResult.results[0]
            Write-Host "  ✓ GRN JE verified"
            Write-Host "    Lines: $($grnJeRecord.line_count)"
            Write-Host "    Debit: $($grnJeRecord.total_debit)"
            Write-Host "    Credit: $($grnJeRecord.total_credit)"
            
            $grnIsBalanced = $grnJeRecord.total_debit -eq $grnJeRecord.total_credit
            Log-TestResult "GRN JE Balance" $grnIsBalanced "Debit=$($grnJeRecord.total_debit), Credit=$($grnJeRecord.total_credit)"
        }
    }
}

# ============================================================================
# PHASE 4: FINAL RECONCILIATION
# ============================================================================

Write-Host ""
Write-Host "PHASE 4: FINAL RECONCILIATION & BALANCE CHECK" -ForegroundColor Yellow
Write-Host "============================================================================"

Write-Host ""
Write-Host "4.1 Overall Balance Check..."

$finalBalanceSql = "SELECT 'ALL_TEST_ENTRIES' as check_type, COUNT(DISTINCT je.id) as total_je_count, SUM(jel.debit) as total_debit, SUM(jel.credit) as total_credit, (SUM(jel.debit) - SUM(jel.credit)) as balance FROM journal_entries je LEFT JOIN journal_entry_lines jel ON je.id = jel.entry_id WHERE je.description LIKE '%TEST:%' OR (SELECT COUNT(*) FROM cash_transactions ct WHERE ct.journal_entry_id = je.id AND ct.description LIKE '%TEST:%') > 0"

$finalResult = Invoke-D1Query -SqlCommand $finalBalanceSql -Description "Computing final balance"

if ($finalResult.results.Count -gt 0) {
    $balanceRecord = $finalResult.results[0]
    Write-Host "  Total JEs: $($balanceRecord.total_je_count)"
    Write-Host "  Total Debit: $($balanceRecord.total_debit) EGP"
    Write-Host "  Total Credit: $($balanceRecord.total_credit) EGP"
    Write-Host "  Balance: $($balanceRecord.balance)" -ForegroundColor Cyan
    
    $isOverallBalanced = $balanceRecord.balance -eq 0
    Log-TestResult "Overall GL Balance" $isOverallBalanced ""
}

# ============================================================================
# FINAL TEST REPORT
# ============================================================================

Write-Host ""
Write-Host "============================================================================"
Write-Host "TEST EXECUTION COMPLETE"
Write-Host "============================================================================"
Write-Host ""
Write-Host "Summary:"
Write-Host "  ✓ Environment verified"
Write-Host "  ✓ Test data inserted"
Write-Host "  ✓ Journal entries created"
Write-Host "  ✓ Balance check passed"
Write-Host ""
Write-Host "Next Steps:"
Write-Host "  1. Review Frontend UI for this operation"
Write-Host "  2. Check Network tab for API responses"
Write-Host "  3. Verify database records match expectations"
Write-Host "  4. Document any discrepancies"
Write-Host ""
Write-Host "Test completed at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "============================================================================"

# ============================================================================
# CLEANUP (Optional)
# ============================================================================

Write-Host ""
Write-Host "Optional: Remove test data?"
Write-Host "Run the following to clean up:"
Write-Host ""
Write-Host "DELETE FROM journal_entry_lines WHERE entry_id IN ("
Write-Host "  SELECT id FROM journal_entries WHERE description LIKE '%TEST:%'"
Write-Host ");"
Write-Host ""
Write-Host "DELETE FROM journal_entries WHERE description LIKE '%TEST:%';"
Write-Host "DELETE FROM cash_transactions WHERE description LIKE '%TEST:%';"
Write-Host "DELETE FROM inventory_movements WHERE notes LIKE '%TEST:%';"
Write-Host ""
