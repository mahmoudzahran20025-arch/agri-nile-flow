# Phase 4 Import Pipeline (Preparation Only)

This pipeline is intentionally **prepare-only**. It performs **zero database writes** and blocks execution whenever architecture misalignment is found.

## Principles
- New posting-groups architecture is canonical.
- No legacy compromises.
- Misalignment is blocked immediately with actionable fixes.
- Idempotency is mandatory before any import execution.

## Command

```bash
npm run import:pipeline:strict
```

## What the command does
1. Reads import contract from `import_pipeline_config.json`.
2. Runs remote D1 preflight checks (`--remote --json`) against posting-groups readiness:
- Posting engine enabled.
- NULL/NULL catch-all rows exist and active in both posting setup tables.
- All suppliers/items/warehouses are assigned to posting groups.
- All assigned posting-group codes exist and are active.
- Catch-all rows have required accounts populated.
3. Scans SQL files under `import_sql/` and extracts all INSERT rows for:
- `supplier_transactions`
- `cash_transactions`
- `inventory_movements`
4. Computes deterministic idempotency keys and flags:
- Duplicate keys inside staged SQL batches.
- Collisions against existing rows already in D1.
5. Writes a full report to `import_pipeline_report.json`.
6. Exits with non-zero code if strict mode is enabled and readiness is false.

## Report output
`import_pipeline_report.json` includes:
- `summary.import_ready`
- `posting_group_alignment` with per-check code, message, and fix.
- `idempotency` stats and sample collisions.
- `reference_health` orphan checks.
- concrete `next_actions`.

## Blocking check codes
- `PG-PIPE-001` posting engine not enabled.
- `PG-PIPE-002` missing general NULL/NULL catch-all row.
- `PG-PIPE-003` missing inventory NULL/NULL catch-all row.
- `PG-PIPE-004` suppliers missing BPG.
- `PG-PIPE-005` items missing PPG.
- `PG-PIPE-006` warehouses missing IPG.
- `PG-PIPE-007` supplier BPG references invalid/inactive.
- `PG-PIPE-008` item PPG references invalid/inactive.
- `PG-PIPE-009` warehouse IPG references invalid/inactive.
- `PG-PIPE-010` general catch-all missing required accounts.
- `PG-PIPE-011` inventory catch-all missing inventory account.

## Workflow
1. Run `npm run import:pipeline:strict`.
2. Resolve every failed check in GL setup pages.
3. Remove every idempotency duplicate/collision in staged SQL.
4. Re-run until `summary.import_ready = true`.
5. Only then execute import scripts.

## Important note
Do not run `import_execute.js` before pipeline readiness is green.
