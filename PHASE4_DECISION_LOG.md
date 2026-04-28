# Phase 4 Technical Lead Decision Log (Autonomous Execution)

Date: 2026-04-27

## Situation
- Strict preflight initially reported 1082 idempotency issues.
- Posting-groups architecture checks were already green.
- Root cause analysis showed both:
- true duplicates inside staged SQL
- duplicate rows already present in D1 transactional import tables

## Options Evaluated
1. In-place row-level dedupe in D1 only
- Pros: no re-import
- Cons: hard to guarantee deterministic canonical history against source SQL; fragile for future reruns.

2. Keep DB and only dedupe staged SQL
- Pros: simple tooling change
- Cons: does not clean current duplicate rows already in DB.

3. Full transactional table reset + canonical deduped import artifacts (selected)
- Pros: deterministic, reproducible, production-safe for import domain, strongest idempotency posture.
- Cons: requires controlled delete/re-import cycle.

## Chosen Strategy
Adopt option 3:
1. Generate canonical deduplicated SQL in `import_sql_clean/`.
2. Delete only import transactional tables for `company_id=1`:
- `inventory_movements`
- `cash_transactions`
- `supplier_transactions`
3. Re-import exclusively from canonical SQL set.
4. Lock strict preflight to canonical source (`import_sql_clean`).
5. Keep posting-groups enforcement and strict blockers active.

## Why This Is Optimal
- Ensures clean DB state with deterministic source of truth.
- Eliminates replay ambiguity and duplicate drift.
- Preserves architecture purity (posting groups path remains canonical).
- Future imports are controlled by strict preflight, not manual judgment.

## Executed Changes
- Added canonical SQL generator: `generate_clean_import_sql.js`
- Added clean execution runner: `import_execute_clean.js`
- Added npm scripts:
- `import:sql:clean`
- `import:execute:clean`
- Updated preflight model in `prepare_import_pipeline.js` to classify:
- `ready_to_import`
- `already_applied`
- `blocked_batch_duplicates`
- `blocked_mixed_overlap`
- Updated pipeline config source to canonical folder: `import_sql_clean`

## Execution Outcome
- Canonical SQL generated; duplicates dropped from staged SQL: 350
- Remote cleanup executed successfully for the 3 transactional tables.
- Clean import executed successfully: 15/15 files OK, 0 errors.

## Governance Guardrails
- Preflight remains strict and remote-only.
- Any batch duplicate or mixed overlap blocks import.
- Any posting-group misalignment blocks import.
- `import_execute.js` should be treated as legacy path; canonical execution path is `import_execute_clean.js` after strict preflight.
