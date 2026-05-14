param(
    [string]$CutoffDate = (Get-Date -Format 'yyyy-MM-dd'),
    [string]$Database = 'agri-nile-flow-data-lake'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$queryPack = Join-Path $root 'sql\governance\03_daily_finance_control_query_pack.sql'
if (-not (Test-Path $queryPack)) {
    throw "Query pack not found: $queryPack"
}

$runDir = Join-Path $root 'reports\monitoring\daily_runs'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$tmpSql = Join-Path $runDir "_tmp_daily_control_$stamp.sql"
$outJson = Join-Path $runDir "daily_control_$stamp.json"

# Replace the default cutoff literal in the query pack for this run.
$content = Get-Content -Raw -Path $queryPack
$content = $content -replace "DATE\('2026-05-11'\)", "DATE('$CutoffDate')"
Set-Content -Path $tmpSql -Value $content -Encoding UTF8

try {
    $cmd = "npx wrangler d1 execute $Database --remote --json --file `"$tmpSql`""
    $output = Invoke-Expression $cmd
    $output | Out-File -FilePath $outJson -Encoding UTF8

    Write-Host "Daily finance control run completed." -ForegroundColor Green
    Write-Host "CutoffDate: $CutoffDate"
    Write-Host "Output: $outJson"
}
finally {
    if (Test-Path $tmpSql) {
        Remove-Item -Force $tmpSql
    }
}
