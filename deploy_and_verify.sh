#!/bin/bash
# deploy_and_verify.sh
# Complete deployment and verification workflow for Agri-Nile Flow

set -e  # Exit on error

echo "════════════════════════════════════════════════════════════════════════════"
echo "  AGRI-NILE FLOW - DEPLOYMENT & VERIFICATION WORKFLOW"
echo "════════════════════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1: VERIFY POSTING_RULES COVERAGE
# ═══════════════════════════════════════════════════════════════════════════════

echo "📊 STEP 1: Running posting_rules verification queries..."
echo "────────────────────────────────────────────────────────────────────────────"
wrangler d1 execute agri-nile-flow-data-lake --remote --file=verify_posting_rules_remote.sql

echo ""
read -p "✓ Review the verification results above. Continue with migration? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled by user."
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2: APPLY MIGRATION 0050 (DROP LEGACY TABLES)
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "🗑️  STEP 2: Applying migration 0050 (dropping legacy tables)..."
echo "────────────────────────────────────────────────────────────────────────────"
wrangler d1 execute agri-nile-flow-data-lake --remote --file=migrations/0050_drop_legacy_posting_tables.sql

echo "✓ Migration 0050 applied successfully"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3: VERIFY LEGACY TABLES ARE DROPPED
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "🔍 STEP 3: Verifying legacy tables are dropped..."
echo "────────────────────────────────────────────────────────────────────────────"
wrangler d1 execute agri-nile-flow-data-lake --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('general_posting_setup', 'inventory_posting_setup', 'gl_account_mappings');"

echo "✓ Legacy tables verification complete"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4: BUILD AND DEPLOY WORKER
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "🚀 STEP 4: Building and deploying worker..."
echo "────────────────────────────────────────────────────────────────────────────"

# Type check
echo "  → Running type check..."
npm run type-check

# Build web assets
echo "  → Building web assets..."
npm run build:web

# Deploy worker
echo "  → Deploying worker to Cloudflare..."
wrangler deploy

# Deploy web assets to Cloudflare Pages
echo "  → Deploying web assets to Cloudflare Pages..."
npx wrangler pages deploy web/dist --project-name=agri-nile-flow-lake

echo "✓ Worker and Pages deployed successfully"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5: POST-DEPLOY ENDPOINT CHECKS
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "🧪 STEP 5: Running post-deploy endpoint checks..."
echo "────────────────────────────────────────────────────────────────────────────"

# Get the worker URL (adjust if needed)
WORKER_URL="https://agri-nile-flow.your-subdomain.workers.dev"

echo ""
echo "Testing endpoints against: $WORKER_URL"
echo ""

# Test 1: Health/Setup endpoint
echo "  1️⃣  Testing GL posting setup health..."
curl -s "$WORKER_URL/gl/posting-setup/health" | jq '.' || echo "❌ Failed"

# Test 2: Invoice flow (create test invoice)
echo ""
echo "  2️⃣  Testing invoice creation flow..."
curl -s -X POST "$WORKER_URL/finance/invoices" \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": 1,
    "customer_id": 1,
    "invoice_date": "2026-04-28",
    "due_date": "2026-05-28",
    "amount": 1000,
    "description": "Post-deploy test invoice"
  }' | jq '.' || echo "❌ Failed"

# Test 3: Receipt flow
echo ""
echo "  3️⃣  Testing receipt creation flow..."
curl -s -X POST "$WORKER_URL/finance/receipts" \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": 1,
    "customer_id": 1,
    "receipt_date": "2026-04-28",
    "amount": 500,
    "payment_method": "cash",
    "description": "Post-deploy test receipt"
  }' | jq '.' || echo "❌ Failed"

# Test 4: Treasury flow
echo ""
echo "  4️⃣  Testing treasury transactions..."
curl -s "$WORKER_URL/treasury/transactions?page=1&size=5" | jq '.' || echo "❌ Failed"

# Test 5: Inventory posting health
echo ""
echo "  5️⃣  Testing inventory posting health..."
curl -s "$WORKER_URL/inventory/posting-health" | jq '.' || echo "❌ Failed"

# ═══════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "  ✓ DEPLOYMENT COMPLETE"
echo "════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Monitor worker logs: wrangler tail"
echo "  2. Check production dashboard for any errors"
echo "  3. Run full integration tests if available"
echo "  4. Update deployment documentation"
echo ""
echo "Worker URL: $WORKER_URL"
echo "Database: agri-nile-flow-data-lake (remote)"
echo ""
