Set-Location "c:\Users\mahmo\Contacts\CLAUDE_CO WORK MY WORK\agri-nile-flow"

$RunDir = "reports\rebuild_run_20260509_215657"
$Src = "$RunDir\02_backup_full_20260509_215657.sql"
$Patched = "$RunDir\02_backup_full_20260509_215657_patched_item_categories.sql"

$prefix = @"
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS item_categories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  name           TEXT NOT NULL,
  parent_id      INTEGER,
  expense_account_code TEXT,
  inventory_account_code TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')), prod_posting_group_code TEXT,
  UNIQUE(company_id, name),
  FOREIGN KEY(company_id) REFERENCES companies(id),
  FOREIGN KEY(parent_id) REFERENCES item_categories(id)
);
"@

$content = Get-Content $Src -Raw
$content = $content -replace "CREATE TABLE item_categories \(", "CREATE TABLE IF NOT EXISTS item_categories ("
Set-Content -Path $Patched -Value ($prefix + "`n" + $content) -Encoding UTF8

$Ts = Get-Date -Format "yyyyMMdd_HHmmss"
$CloneDb = "agri-nile-flow-data-lake-clone-$Ts"

"CLONE_DB_PATCHED_FULL=$CloneDb" | Tee-Object -FilePath "$RunDir\00_run_meta.txt" -Append

npx wrangler d1 create $CloneDb | Tee-Object "$RunDir\12_clone4_create.log"
npx wrangler d1 execute $CloneDb --remote --yes --file $Patched | Tee-Object "$RunDir\13_clone4_import_patched_full.log"
npx wrangler d1 execute $CloneDb --remote --yes --json --command "SELECT (SELECT COUNT(*) FROM suppliers WHERE company_id=1) AS suppliers, (SELECT COUNT(*) FROM supplier_transactions WHERE company_id=1) AS supplier_transactions, (SELECT COUNT(*) FROM cash_transactions WHERE company_id=1) AS cash_transactions, (SELECT COUNT(*) FROM inventory_movements WHERE company_id=1) AS inventory_movements, (SELECT COUNT(*) FROM journal_entries WHERE company_id=1) AS journal_entries, (SELECT COUNT(*) FROM journal_entry_lines WHERE company_id=1) AS journal_entry_lines;" | Out-File "$RunDir\14_clone4_counts.json"

"ACTIVE_CLONE_DB=$CloneDb" | Tee-Object -FilePath "$RunDir\00_run_meta.txt" -Append
