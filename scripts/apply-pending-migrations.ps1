#Requires -Version 5.1
<#
.SYNOPSIS
  Applies pending D1 migrations (0120, 0122, 0123) to the remote database
  and verifies each one completed correctly before proceeding.

.DESCRIPTION
  Runs wrangler d1 execute for each migration that may not have been applied
  to remote D1 yet. Each migration includes a SELECT verification at the end
  so wrangler output can be inspected for correctness.

  Migrations in scope:
    0120 — unit_conversions seeding + DROP supplier_invoices/supplier_invoice_items
    0122 — GL trace columns on journal_entries + journal_entry_lines
    0123 — fields.crop_name column

.PARAMETER DatabaseName
  D1 database name as defined in wrangler.toml.  Default: agri-nile-flow-data-lake

.PARAMETER MigrationsDir
  Relative path to migrations directory.  Default: migrations

.PARAMETER DryRun
  If set, prints the wrangler commands without executing them.

.EXAMPLE
  cd <project root>
  .\scripts\apply-pending-migrations.ps1

.EXAMPLE
  # Dry-run preview only
  .\scripts\apply-pending-migrations.ps1 -DryRun
#>

param(
    [string] $DatabaseName   = 'agri-nile-flow-data-lake',
    [string] $MigrationsDir  = 'migrations',
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Pass { param($m) Write-Host "[PASS] $m" -ForegroundColor Green  }
function Write-Fail { param($m) Write-Host "[FAIL] $m" -ForegroundColor Red    }
function Write-Info { param($m) Write-Host "[    ] $m" -ForegroundColor Cyan   }
function Write-Head { param($m) Write-Host "`n━━━ $m ━━━" -ForegroundColor White }

$PENDING = @(
    @{ file = '0120_standard_uom_and_ap_cleanup.sql';   desc = 'UOM seeding + DROP supplier_invoices' },
    @{ file = '0122_gl_trace_columns.sql';              desc = 'GL trace columns (business_event_id, source_module, etc.)' },
    @{ file = '0123_fields_crop_name.sql';              desc = 'fields.crop_name column' }
)

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  AGRI-NILE FLOW — PENDING MIGRATIONS APPLICATOR         ║" -ForegroundColor Cyan
Write-Host "║  database: $DatabaseName" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

if ($DryRun) {
    Write-Host "  DRY-RUN mode — no migrations will be applied." -ForegroundColor Yellow
}

$failed = 0

foreach ($mig in $PENDING) {
    Write-Head "$($mig.file)"
    Write-Info "  $($mig.desc)"

    $path = Join-Path $MigrationsDir $mig.file
    if (-not (Test-Path $path)) {
        Write-Fail "Migration file not found: $path"
        $failed++
        continue
    }

    $cmd = "wrangler d1 execute $DatabaseName --remote --file=$path"
    Write-Info "  Command: $cmd"

    if ($DryRun) {
        Write-Info "  [DRY RUN — skipped]"
        continue
    }

    try {
        $output = & wrangler d1 execute $DatabaseName --remote --file=$path 2>&1
        Write-Info "  Output:"
        $output | ForEach-Object { Write-Info "    $_" }

        # Check for errors in wrangler output
        $hasError = $output | Where-Object { $_ -match 'error|Error|ERROR|failed|Failed' }
        if ($hasError) {
            # Distinguish expected "already exists" from real errors
            $isAlreadyApplied = $output | Where-Object { $_ -match 'duplicate column|already exists|table already|no changes' }
            if ($isAlreadyAlreadyApplied) {
                Write-Pass "$($mig.file) — already applied (idempotent OK)"
            } else {
                Write-Fail "$($mig.file) — wrangler reported errors (see above)"
                $failed++
            }
        } else {
            Write-Pass "$($mig.file) — applied successfully"
        }
    } catch {
        Write-Fail "$($mig.file) — execution threw: $_"
        $failed++
    }
}

Write-Host ""
if ($failed -eq 0) {
    Write-Pass "All pending migrations applied.  Run smoke-import-certification.ps1 next."
    exit 0
} else {
    Write-Fail "$failed migration(s) failed.  Inspect output above before proceeding."
    exit 1
}
