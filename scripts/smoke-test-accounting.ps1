#Requires -Version 5.1
<#
.SYNOPSIS
  Authenticated smoke-test for the accounting GL/reports endpoints.

.DESCRIPTION
  Logs in to the live worker, then runs payload-shape validation (not just HTTP
  status) against two critical endpoints:
    - GET /api/gl/posting-rules
    - GET /api/reports/suppliers-balance

.PARAMETER BaseUrl
  Worker base URL.  Default: https://agri-nile-flow.mahm-zahran22.workers.dev

.PARAMETER Email
  Account email to log in with.

.PARAMETER Password
  Account password.

.PARAMETER CompanyId
  company_id for the login payload.

.EXAMPLE
  .\scripts\smoke-test-accounting.ps1 `
    -Email admin@agrinile.com `
    -Password secret123 `
    -CompanyId 1
#>

param(
    [string]  $BaseUrl   = 'https://agri-nile-flow.mahm-zahran22.workers.dev',
    [Parameter(Mandatory)][string]  $Email,
    [Parameter(Mandatory)][string]  $Password,
    [Parameter(Mandatory)][int]     $CompanyId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── helpers ──────────────────────────────────────────────────────────────────

function Write-Pass  { param($msg) Write-Host "[PASS] $msg" -ForegroundColor Green  }
function Write-Fail  { param($msg) Write-Host "[FAIL] $msg" -ForegroundColor Red    }
function Write-Info  { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Cyan   }
function Write-Warn  { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }

$script:failures = 0

function Assert-Shape {
    param(
        [string]   $TestName,
        [object]   $Value,
        [string[]] $RequiredKeys
    )
    foreach ($key in $RequiredKeys) {
        if ($null -eq $Value.$key) {
            Write-Fail "$TestName — missing key: $key"
            $script:failures++
            return
        }
    }
    Write-Pass $TestName
}

function Invoke-Api {
    param(
        [string] $Method  = 'GET',
        [string] $Path,
        [object] $Body    = $null,
        [string] $Token   = $null
    )
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }

    $params = @{
        Uri         = "$BaseUrl/api$Path"
        Method      = $Method
        Headers     = $headers
        TimeoutSec  = 30
        ErrorAction = 'Stop'
    }
    if ($Body) { $params['Body'] = ($Body | ConvertTo-Json -Depth 10) }

    try {
        $resp = Invoke-RestMethod @params
        return $resp
    } catch {
        $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        throw "HTTP $code — $($_.Exception.Message)"
    }
}

# ── STEP 1: Login ─────────────────────────────────────────────────────────────

Write-Info "Authenticating as $Email (company_id=$CompanyId)..."
$loginBody = @{ email = $Email; password = $Password; company_id = $CompanyId }
try {
    $login = Invoke-Api -Method POST -Path '/auth/login' -Body $loginBody
} catch {
    Write-Fail "Login failed: $_"
    exit 1
}

if (-not $login.success -or -not $login.data.token) {
    Write-Fail "Login response missing token.  Response: $($login | ConvertTo-Json)"
    exit 1
}
$token = $login.data.token
Write-Pass "Login OK — role=$($login.data.user.role)"

# ── STEP 2: GET /api/gl/posting-rules ────────────────────────────────────────

Write-Info ""
Write-Info "Testing GET /api/gl/posting-rules (no filters)..."
try {
    $rulesResp = Invoke-Api -Path '/gl/posting-rules' -Token $token
    Assert-Shape "posting-rules response has success=true" $rulesResp @('success')
    if (-not $rulesResp.success) { throw "success=false: $($rulesResp | ConvertTo-Json)" }

    Assert-Shape "posting-rules has pagination fields" $rulesResp @('data', 'total', 'page', 'page_size')
    Write-Info "  total=$($rulesResp.total)  page=$($rulesResp.page)  page_size=$($rulesResp.page_size)"

    # If there are any rows, validate first row shape
    if ($rulesResp.data.Count -gt 0) {
        $firstRule = $rulesResp.data[0]
        Assert-Shape "posting-rule row has required fields" $firstRule @('id', 'rule_type', 'is_active', 'priority', 'created_at')
        Write-Info "  first rule: id=$($firstRule.id)  rule_type=$($firstRule.rule_type)  is_active=$($firstRule.is_active)"
    } else {
        Write-Warn "  No posting_rules rows found for this company — table may be empty."
    }
} catch {
    Write-Fail "posting-rules test threw: $_"
    $script:failures++
}

# Filter smoke: active-only
Write-Info ""
Write-Info "Testing GET /api/gl/posting-rules?active=1&rule_type=control..."
try {
    $filteredResp = Invoke-Api -Path '/gl/posting-rules?active=1&rule_type=control' -Token $token
    Assert-Shape "filtered posting-rules response" $filteredResp @('success', 'data', 'total')
    Write-Info "  control/active rows: $($filteredResp.total)"
} catch {
    Write-Fail "filtered posting-rules test threw: $_"
    $script:failures++
}

# ── STEP 3: GET /api/reports/suppliers-balance ───────────────────────────────

Write-Info ""
Write-Info "Testing GET /api/reports/suppliers-balance..."
try {
    $sbResp = Invoke-Api -Path '/reports/suppliers-balance' -Token $token
    if (-not $sbResp.success) {
        # 409 = missing AP control mapping — expected in unconfigured envs, not a hard failure
        if ($sbResp.code -eq 'MISSING_AP_CONTROL_MAPPING') {
            Write-Warn "  suppliers-balance returned 409 MISSING_AP_CONTROL_MAPPING — AP control account not configured."
            Write-Warn "  Add a posting_rule with rule_type=control + mapping_key=accounts_payable to unblock."
        } else {
            throw "success=false: $($sbResp | ConvertTo-Json)"
        }
    } else {
        Assert-Shape "suppliers-balance has data array" $sbResp @('data')

        # Validate each row shape
        $rowErrors = 0
        foreach ($row in $sbResp.data) {
            foreach ($field in @('code', 'name', 'total_credit', 'total_debit', 'balance', 'tx_count', 'data_source', 'control_account')) {
                if ($null -eq $row.$field) { $rowErrors++ }
            }
        }
        if ($rowErrors -gt 0) {
            Write-Fail "suppliers-balance — $rowErrors missing field occurrences across $($sbResp.data.Count) rows"
            $script:failures++
        } else {
            Write-Pass "suppliers-balance — $($sbResp.data.Count) rows, all fields present"
        }

        # Spot-check data_source value
        if ($sbResp.data.Count -gt 0) {
            $ds = $sbResp.data[0].data_source
            if ($ds -ne 'gl_business_events') {
                Write-Warn "  data_source='$ds' expected 'gl_business_events' — may be stale deployment"
            } else {
                Write-Pass "  data_source='gl_business_events' confirmed"
            }
            Write-Info "  control_account=$($sbResp.data[0].control_account)"
        }
    }
} catch {
    Write-Fail "suppliers-balance test threw: $_"
    $script:failures++
}

# ── STEP 4: Summary ──────────────────────────────────────────────────────────

Write-Info ""
if ($script:failures -eq 0) {
    Write-Pass "All checks passed."
    exit 0
} else {
    Write-Fail "$($script:failures) check(s) failed — see above."
    exit 1
}
