#Requires -Version 5.1
<#
.SYNOPSIS
  Migration governance check — detects duplicate migration numbers in the migrations/ directory.

.DESCRIPTION
  Rules enforced:
    1. No two files may share the same numeric prefix (e.g. two files starting with 0125_).
    2. Every new migration must use the format NNNN_description.sql (4-digit zero-padded).
    3. The next available number must be strictly greater than the current maximum.

  Exit codes:
    0 = PASS  — no violations
    1 = FAIL  — duplicates or format violations detected

.PARAMETER MigrationsDir
  Path to the migrations directory. Defaults to "migrations/" relative to this script.

.EXAMPLE
  # Run from repo root:
  pwsh -File scripts/check-migration-duplicates.ps1

  # With explicit path:
  pwsh -File scripts/check-migration-duplicates.ps1 -MigrationsDir ./migrations
#>
param(
    [string] $MigrationsDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'migrations')
)

$ErrorActionPreference = 'Stop'
$exitCode = 0

Write-Host "`n=== Migration Governance Check ===" -ForegroundColor Cyan
Write-Host "  Directory: $MigrationsDir`n"

if (-not (Test-Path $MigrationsDir)) {
    Write-Host "[FAIL] Migrations directory not found: $MigrationsDir" -ForegroundColor Red
    exit 1
}

$allFiles = Get-ChildItem $MigrationsDir -Filter "*.sql" | Sort-Object Name

# --- Rule 1: All numbered files must match NNNN_description.sql ---
$numbered = @()
$nonStandard = @()

foreach ($f in $allFiles) {
    if ($f.Name -match '^(\d{4})_') {
        $numbered += [PSCustomObject]@{ Number = [int]$Matches[1]; File = $f.Name }
    } elseif ($f.Name -match '^\d') {
        $nonStandard += $f.Name
    }
    # Non-digit-prefixed files (like SEED_*.sql) are ignored — they're utilities, not migrations
}

if ($nonStandard.Count -gt 0) {
    Write-Host "[WARN] Non-standard numeric prefixes (not NNNN_):" -ForegroundColor Yellow
    $nonStandard | ForEach-Object { Write-Host "       $_" -ForegroundColor Yellow }
    Write-Host "       New migrations must use 4-digit format. Existing ones are grandfathered.`n"
}

# --- Rule 2: Detect duplicate numeric prefixes ---
# Numbers <= 0126 are grandfathered (existed before this registry was introduced).
# Only numbers > 0126 must be unique.
$GRANDFATHER_THRESHOLD = 126

$grouped = $numbered | Group-Object -Property Number | Where-Object { $_.Count -gt 1 }
$newDuplicates = $grouped | Where-Object { [int]$_.Name -gt $GRANDFATHER_THRESHOLD }
$legacyDuplicates = $grouped | Where-Object { [int]$_.Name -le $GRANDFATHER_THRESHOLD }

if ($legacyDuplicates.Count -gt 0) {
    Write-Host "[WARN] Grandfathered duplicate numbers (pre-registry, informational only):" -ForegroundColor Yellow
    foreach ($g in $legacyDuplicates) {
        $num = [int]$g.Name
        Write-Host "  $($num.ToString().PadLeft(4,'0')): $($g.Group.File -join ', ')" -ForegroundColor Yellow
    }
    Write-Host ""
}

if ($newDuplicates.Count -gt 0) {
    Write-Host "[FAIL] New duplicate migration numbers detected (numbers > $GRANDFATHER_THRESHOLD must be unique):" -ForegroundColor Red
    foreach ($g in $newDuplicates) {
        Write-Host "  Number $($g.Name.ToString().PadLeft(4,'0')) used by:" -ForegroundColor Red
        $g.Group | ForEach-Object { Write-Host "    - $($_.File)" -ForegroundColor Red }
    }
    Write-Host ""
    $exitCode = 1
} else {
    Write-Host "[PASS] No duplicate migration numbers in new migrations (>$GRANDFATHER_THRESHOLD)." -ForegroundColor Green
}

# --- Rule 3: Report the next safe migration number ---
if ($numbered.Count -gt 0) {
    $maxNum = ($numbered | Measure-Object -Property Number -Maximum).Maximum
    $next   = $maxNum + 1
    Write-Host "[INFO] Current maximum: $($maxNum.ToString().PadLeft(4,'0'))" -ForegroundColor Cyan
    Write-Host "[INFO] Next available:  $($next.ToString().PadLeft(4,'0'))" -ForegroundColor Cyan
}

# --- Rule 4: Warn about files that don't match strict 4-digit format ---
$strictViolations = $numbered | Where-Object {
    $_.File -notmatch '^\d{4}_[a-z0-9_]+\.sql$'
}
if ($strictViolations.Count -gt 0) {
    Write-Host "`n[WARN] Files with non-lowercase or non-standard naming (informational):" -ForegroundColor Yellow
    $strictViolations | ForEach-Object { Write-Host "       $($_.File)" -ForegroundColor Yellow }
}

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "[OK] Migration check passed." -ForegroundColor Green
} else {
    Write-Host "[FAIL] Migration check failed. Resolve duplicate numbers before merging." -ForegroundColor Red
}

exit $exitCode
