# Task Execution Index — Agri-Nile ERP
> 50 focused tasks. Each file = 3–4 lines. Execute one by one.
> Priority order: Cleanup → Data → Inventory → Finance → Suppliers → UI

---

## 🧹 CLEANUP (10 tasks) — Run first, unblock everything else

| File | Description |
|------|-------------|
| [C01](cleanup/C01_remove_root_sql_clutter.md) | Move 50+ loose SQL and 80+ MD files from root to archive/ |
| [C02](cleanup/C02_delete_legacy_gl_backup.md) | Delete src/api/gl.ts.legacy.backup after confirming superseded |
| [C03](cleanup/C03_remove_dead_classifier_route.md) | Remove /gl/classifier dead redirect route from App.tsx |
| [C04](cleanup/C04_remove_SupplierListPage_dead_import.md) | Delete SupplierListPage.tsx if not routed anywhere |
| [C05](cleanup/C05_remove_TrialBalancePage_if_orphan.md) | Confirm TrialBalancePage is routed or delete it |
| [C06](cleanup/C06_audit_src_api_classifier.md) | Audit src/api/classifier.ts — mounted or dead? |
| [C07](cleanup/C07_gitignore_archive_and_logs.md) | Add archive/ and debug scripts to .gitignore |
| [C08](cleanup/C08_remove_gl_ts_legacy_backup.md) | Delete gl.ts.legacy.backup after diff confirms safe |
| [C09](cleanup/C09_verify_all_routes_have_pages.md) | Audit every App.tsx route has a matching page file |
| [C10](cleanup/C10_consolidate_session_docs.md) | Move all session/audit docs to archive/docs/ |

---

## 📊 DATA QUALITY (8 tasks) — Run after cleanup

| File | Description |
|------|-------------|
| [D01](data/D01_detect_test_data_after_25apr.md) | Detect all records created after 2026-04-25 (test data boundary) |
| [D02](data/D02_clean_test_journal_entries.md) | Delete confirmed test journal entries (ref_type='test') |
| [D03](data/D03_verify_items_have_categories.md) | Every item must have a valid category_id |
| [D04](data/D04_verify_movements_have_transaction_id.md) | All movements must have transaction_id after migration 0079 |
| [D05](data/D05_check_negative_balance_items.md) | Identify and triage items with negative balance_qty |
| [D06](data/D06_verify_supplier_codes_consistent.md) | Supplier codes consistent across invoices/cash/movements |
| [D07](data/D07_validate_gl_periods_coverage.md) | Every journal_entry must fall within an existing gl_period |
| [D08](data/D08_check_business_events_coverage.md) | Clarify why only 10 business_events for 668 posted movements |

---

## 📦 INVENTORY (15 tasks) — Core module fixes

| File | Description |
|------|-------------|
| [I01](inventory/I01_paginate_item_card_history.md) | Paginate GET /item/:code/card (unbounded history) |
| [I02](inventory/I02_cap_legacy_balances_endpoint.md) | Add LIMIT 200 safety cap to legacy /inventory/balances |
| [I03](inventory/I03_WarehouseBalancesPage_migrate_to_new_api.md) | WarehouseBalancesPage — migrate to paginated balances API |
| [I04](inventory/I04_fix_missing_react_keys.md) | Fix missing key props across all inventory table maps |
| [I05](inventory/I05_InventoryAdjustmentsPage_date_filter.md) | Add date range filter to InventoryAdjustmentsPage |
| [I06](inventory/I06_AdjustmentDetailPage_gl_status_badge.md) | Show GL posting status badge per line in AdjustmentDetailPage |
| [I07](inventory/I07_ItemCategoriesPage_add_count.md) | Add item count badge per category + click-through filter |
| [I08](inventory/I08_TransactionHistoryPage_export.md) | Add CSV export to TransactionHistoryPage |
| [I09](inventory/I09_CostByFieldPage_empty_state.md) | Add empty state and season selector to CostByFieldPage |
| [I10](inventory/I10_outbox_worker_cron_check.md) | Verify outbox cron is wired in wrangler.toml + index.ts |
| [I11](inventory/I11_movement_type_migration_arabic_to_typed.md) | Migrate Arabic movement_type values to typed codes |
| [I12](inventory/I12_add_movement_type_db_constraint.md) | Add DB trigger to enforce valid movement_type values |
| [I13](inventory/I13_outbox_max_retry_notification.md) | Show red alert on PostingHealth when outbox hits max retries |
| [I14](inventory/I14_WipBalancesPage_assign_season.md) | Add season assignment button to WipBalancesPage pending rows |
| [I15](inventory/I15_FixedAssetsPage_total_depreciation.md) | Add net book value column to FixedAssetsPage |

---

## 💰 FINANCE (10 tasks) — Solid cleanup, no redesign

| File | Description |
|------|-------------|
| [F01](finance/F01_period_close_checklist_enforce.md) | Block period close if integrity check has critical issues |
| [F02](finance/F02_trial_balance_period_selector.md) | Auto-fill trial balance date range from current open period |
| [F03](finance/F03_journal_entries_search_by_ref.md) | Add search by source document ref in JournalEntriesPage |
| [F04](finance/F04_financial_statements_loading_state.md) | Add skeleton loader + error boundary to FinancialStatementsPage |
| [F05](finance/F05_cash_journal_field_filter.md) | Add field_id filter to CashJournalPage |
| [F06](finance/F06_budget_vs_actual_cost_centers.md) | Verify BudgetVsActualPage actuals come from GL not ops tables |
| [F07](finance/F07_fix_wip_page_route_and_nav.md) | Add nav links for WipBalancesPage and FixedAssetsPage |
| [F08](finance/F08_season_pnl_depreciation_line.md) | Add depreciation cost line (Cost 7) to SeasonPnLPage |
| [F09](finance/F09_exchange_rates_stale_warning.md) | Show "قديم" badge on exchange rates older than 7 days |
| [F10](finance/F10_verify_posting_rules_completeness.md) | Verify all active posting_rules have valid account_codes |

---

## 🏪 SUPPLIERS (5 tasks) — Integration and UX

| File | Description |
|------|-------------|
| [S01](suppliers/S01_SupplierHubPage_balance_card.md) | Add outstanding balance KPI card to SupplierHubPage |
| [S02](suppliers/S02_SupplierDetailPage_invoice_tab.md) | Verify supplier invoices tab is paginated |
| [S03](suppliers/S03_APAgingPage_zero_balance_filter.md) | Add toggle to hide zero-balance suppliers in APAgingPage |
| [S04](suppliers/S04_PurchaseOrdersPage_status_filter.md) | Add status filter tabs to PurchaseOrdersPage |
| [S05](suppliers/S05_verify_supplier_gl_linkage.md) | Verify every paid invoice has a matching GL entry |

---

## 🎨 UI/UX (10 tasks) — Consistency and polish

| File | Description |
|------|-------------|
| [U01](ui/U01_unify_page_header_component.md) | Create shared PageHeader component for inventory+supplier pages |
| [U02](ui/U02_unify_empty_state_component.md) | Create EmptyState component to replace ad-hoc empty messages |
| [U03](ui/U03_unify_pagination_component.md) | Create shared Pagination component for all paginated tables |
| [U04](ui/U04_add_loading_skeleton_inventory_tables.md) | Add skeleton rows to replace loading text in inventory tables |
| [U05](ui/U05_mobile_fix_inventory_tables.md) | Fix horizontal overflow on mobile for inventory tables |
| [U06](ui/U06_AddInventoryMovementModal_validation.md) | Add client-side validation to AddInventoryMovementModal |
| [U07](ui/U07_AddInventoryBatchModal_line_total.md) | Show running total per line + grand total in batch modal |
| [U08](ui/U08_PostingHealth_filter_by_status.md) | Add GL status filter tabs to InventoryPostingHealthPage |
| [U09](ui/U09_AppShell_active_link_highlight.md) | Verify active nav link highlights for all inventory sub-routes |
| [U10](ui/U10_InventoryBalancesPage_stale_badge_tooltip.md) | Add tooltip explanation to stale badge in InventoryBalancesPage |

---

## Execution Notes
- **Before each task**: run `npx tsc --noEmit` to confirm clean baseline.
- **After each task**: run `npx tsc --noEmit` to confirm no regressions.
- **Commit after every 3–5 completed tasks** with a focused message.
- **Skip D01–D02** if you want to preserve all data for review first — mark as HOLD.
- **I11 and I12** depend on each other — run in order, test with regression script in test/.
