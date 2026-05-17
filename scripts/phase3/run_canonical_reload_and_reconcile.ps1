$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

Write-Host 'Step 1/5: Verify service taxonomy and supplier mapping exist' -ForegroundColor Cyan
npx --yes wrangler d1 execute agri-nile-flow-data-lake --remote --yes --command "SELECT 'service_types' AS table_name, COUNT(*) AS cnt FROM service_types WHERE company_id=1;"
npx --yes wrangler d1 execute agri-nile-flow-data-lake --remote --yes --command "SELECT 'supplier_service_map' AS table_name, COUNT(*) AS cnt FROM supplier_service_map WHERE company_id=1 AND is_active=1;"

Write-Host 'Step 2/5: Deterministic canonical reload (master + transactions)' -ForegroundColor Cyan
npx --yes wrangler d1 execute agri-nile-flow-data-lake --remote --yes --file .\sql\canonical_reentry\20_master_and_transactions_deterministic_reload.sql

Write-Host 'Step 3/5: Reposting all posted rows to GL' -ForegroundColor Cyan
$env:POSTING_CUTOFF_DATE = '2026-05-11'
node .\scripts\execute_posting_job.js --apply

Write-Host 'Step 4/5: Reconciliation control pack' -ForegroundColor Cyan
npx --yes wrangler d1 execute agri-nile-flow-data-lake --remote --yes --file .\sql\canonical_reentry\30_reconciliation_control_pack.sql

Write-Host 'Step 5/5: Daily control pack baseline comparison' -ForegroundColor Cyan
npx --yes wrangler d1 execute agri-nile-flow-data-lake --remote --yes --file .\sql\governance\03_daily_finance_control_query_pack.sql

Write-Host 'Canonical reload + repost + reconciliation completed.' -ForegroundColor Green
