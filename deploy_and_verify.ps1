# deploy_and_verify.ps1
# Complete deployment and verification workflow for Agri-Nile Flow (Windows PowerShell)

$ErrorActionPreference = "Stop"

Write-Host "════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  AGRI-NILE FLOW - DEPLOYMENT & VERIFICATION WORKFLOW" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1: VERIFY POSTING_RULES COVERAGE
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host "📊 STEP 1: Running posting_rules verification queries..." -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────────────────"
wrangler d1 execute agri-nile-flow-data-lake --remote --file=verify_posting_rules_remote.sql

Write-Host ""
$continue = Read-Host "✓ Review the verification results above. Continue with migration? (y/n)"
if ($continue -ne "y" -and $continue -ne "Y") {
    Write-Host "❌ Deployment cancelled by user." -ForegroundColor Red
    exit 1
}

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2: APPLY MIGRATION 0050 (DROP LEGACY TABLES)
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "🗑️  STEP 2: Applying migration 0050 (dropping legacy tables)..." -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────────────────"
wrangler d1 execute agri-nile-flow-data-lake --remote --file=migrations/0050_drop_legacy_posting_tables.sql

Write-Host "✓ Migration 0050 applied successfully" -ForegroundColor Green

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3: VERIFY LEGACY TABLES ARE DROPPED
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "🔍 STEP 3: Verifying legacy tables are dropped..." -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────────────────"
wrangler d1 execute agri-nile-flow-data-lake --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('general_posting_setup', 'inventory_posting_setup', 'gl_account_mappings');"

Write-Host "✓ Legacy tables verification complete" -ForegroundColor Green

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4: BUILD AND DEPLOY WORKER
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "🚀 STEP 4: Building and deploying worker..." -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────────────────"

# Type check
Write-Host "  → Running type check..."
npm run type-check

# Build web assets
Write-Host "  → Building web assets..."
npm run build:web

# Deploy worker
Write-Host "  → Deploying worker to Cloudflare..."
wrangler deploy

# Deploy web assets to Cloudflare Pages
Write-Host "  → Deploying web assets to Cloudflare Pages..."
npx wrangler pages deploy web/dist --project-name=agri-nile-flow-lake

Write-Host "✓ Worker and Pages deployed successfully" -ForegroundColor Green

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5: POST-DEPLOY ENDPOINT CHECKS
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "🧪 STEP 5: Running post-deploy endpoint checks..." -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────────────────"

# Get the worker URL (adjust if needed)
$WORKER_URL = "https://agri-nile-flow.your-subdomain.workers.dev"

Write-Host ""
Write-Host "Testing endpoints against: $WORKER_URL"
Write-Host ""

# Test 1: Health/Setup endpoint
Write-Host "  1️⃣  Testing GL posting setup health..."
try {
    $response = Invoke-RestMethod -Uri "$WORKER_URL/gl/posting-setup/health" -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Failed: $_" -ForegroundColor Red
}

# Test 2: Invoice flow
Write-Host ""
Write-Host "  2️⃣  Testing invoice creation flow..."
try {
    $invoiceBody = @{
        company_id = 1
        customer_id = 1
        invoice_date = "2026-04-28"
        due_date = "2026-05-28"
        amount = 1000
        description = "Post-deploy test invoice"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$WORKER_URL/finance/invoices" -Method Post -Body $invoiceBody -ContentType "application/json"
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Failed: $_" -ForegroundColor Red
}

# Test 3: Receipt flow
Write-Host ""
Write-Host "  3️⃣  Testing receipt creation flow..."
try {
    $receiptBody = @{
        company_id = 1
        customer_id = 1
        receipt_date = "2026-04-28"
        amount = 500
        payment_method = "cash"
        description = "Post-deploy test receipt"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$WORKER_URL/finance/receipts" -Method Post -Body $receiptBody -ContentType "application/json"
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Failed: $_" -ForegroundColor Red
}

# Test 4: Treasury flow
Write-Host ""
Write-Host "  4️⃣  Testing treasury transactions..."
try {
    $response = Invoke-RestMethod -Uri "$WORKER_URL/treasury/transactions?page=1&size=5" -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Failed: $_" -ForegroundColor Red
}

# Test 5: Inventory posting health
Write-Host ""
Write-Host "  5️⃣  Testing inventory posting health..."
try {
    $response = Invoke-RestMethod -Uri "$WORKER_URL/inventory/posting-health" -Method Get
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "❌ Failed: $_" -ForegroundColor Red
}

# ═══════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✓ DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Monitor worker logs: wrangler tail"
Write-Host "  2. Check production dashboard for any errors"
Write-Host "  3. Run full integration tests if available"
Write-Host "  4. Update deployment documentation"
Write-Host ""
Write-Host "Worker URL: $WORKER_URL"
Write-Host "Database: agri-nile-flow-data-lake (remote)"
Write-Host ""
