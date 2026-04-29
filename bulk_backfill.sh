#!/bin/bash
# TASK A1.3: Bulk Backfill Script
# Run this script to backfill all remaining transactions

DB="agri-nile-flow-data-lake"

echo "=========================================="
echo "TASK A1.3: BULK BACKFILL EXECUTION"
echo "=========================================="

# ============================================
# STEP 1: Backfill Cash Transactions (68 remaining)
# ============================================
echo ""
echo "Step 1: Backfilling Cash Transactions..."
echo "------------------------------------------"

# Get list of cash transactions needing backfill
npx wrangler d1 execute $DB --remote --json --command "SELECT id,created_at,amount,debit,credit FROM cash_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL LIMIT 10" | tee cash_to_process.json

echo ""
echo "Process each transaction manually using:"
echo "  1. Create JE: INSERT INTO journal_entries..."
echo "  2. Get JE ID: SELECT id FROM journal_entries WHERE ref_type='cash' AND ref_id=TX_ID"
echo "  3. Create Lines: INSERT INTO journal_entry_lines..."
echo "  4. Link: UPDATE cash_transactions SET journal_entry_id=JE_ID WHERE id=TX_ID"
echo ""

# ============================================
# STEP 2: Backfill Supplier Transactions (274)
# ============================================
echo ""
echo "Step 2: Backfilling Supplier Transactions..."
echo "------------------------------------------"

# Get count
npx wrangler d1 execute $DB --remote --json --command "SELECT COUNT(*) as n FROM supplier_transactions WHERE company_id=1 AND status='posted' AND journal_entry_id IS NULL"

echo ""
echo "=========================================="
echo "For bulk execution, use the SQL file:"
echo "  TASK_A1_3_backfill_batch.sql"
echo "=========================================="
