# Phase 3 Kickoff (2026-05-09)

## What was completed before kickoff
1. Test residue cleanup executed successfully:
   - sql/cleanup_test_residue_pre_reseed.sql
2. Re-check confirmed:
   - test_entries = 0
   - COA governance metrics remain green
   - direct operational broken links remain 0

## Newly discovered residue now assigned to Phase 3 wipe scope
- source_documents orphan event references: 312
- source_document_links orphan entry references: 40

These are not clean source-of-truth records and should be removed by the Phase 3 transactional wipe instead of patched in place.

## Current live row counts in Phase 3 scope
- supplier_transactions: 640
- inventory_movements: 368
- cash_transactions: 69
- journal_entries: 1579
- journal_entry_lines: 3162
- business_events: 901
- source_documents: 648
- source_document_links: 648
- posting_rule_resolutions: 650

## Wipe scope file
- sql/phase3_controlled_wipe_scope_company1.sql

## Import/reseed readiness assessment
Reusable or partially reusable candidates found:
- import_nawat_transactions.js
  - imports supplier transactions from raw source JSON
  - not safe to use as-is for production-clean reseed because it uses raw source fields directly and includes account codes like 3025 that were intentionally moved out of posting fields during canonical remediation
- sync_items_from_json.js
  - upserts item catalog from JSON
  - may be reusable for item master only after aligning source file choice with canonical_clean policy

Major gaps preventing immediate full safe reseed in this same step:
- no approved importer yet for canonical_clean COA into chart_of_accounts
- no approved importer yet for canonical_clean treasury transactions into cash_transactions
- no approved importer yet for canonical_clean inventory movements into inventory_movements
- no approved importer pack yet that reconstructs bridge/event/journal trail deterministically from canonical_clean

## Execution Judgment
- Phase 3 has started.
- Safe to proceed with wipe scope preparation and execution pack.
- Full destructive wipe + reseed should not run until the canonical_clean loaders are authored or explicitly approved.
