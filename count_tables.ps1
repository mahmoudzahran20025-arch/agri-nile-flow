$tables = @('_cf_KV','accounts','approval_actions','approval_requests','attendance_records','audit_log','bank_accounts','bank_reconciliations','bank_statements','branches','business_posting_groups','calendar_events','cash_transactions','chart_of_accounts','companies','contract_advances','cost_centers','d1_migrations','documents','employee_assets','employee_job_details','employees','event_attendees','expense_types','field_season_budgets','fields','financial_periods','general_posting_setup','gl_account_mappings','gl_integration_settings','harvest_records','inventory_adjustment_lines','inventory_adjustments','inventory_movements','inventory_posting_groups','inventory_posting_setup','item_categories','item_units','items','journal_entries','journal_entry_lines','leave_requests','leave_types','location_tasks','offline_queue','partners','payroll_items','payroll_runs','permissions','product_posting_groups','purchase_contracts','purchase_order_items','purchase_orders','reorder_rules','role_permissions','roles','salary_advances','sales_contracts','seasons','sessions','staging_movements','stock_quants','sub_locations','supplier_invoice_items','supplier_invoices','supplier_transactions','suppliers','system_error_logs','transaction_mapping_rules','user_companies','users','warehouses','wo_template_tasks','wo_templates','work_orders','work_tasks');
$results = @();
foreach ($t in $tables) {
    $b = (Select-String -Path "src\**\*.ts" -Pattern "\b$t\b" -ErrorAction SilentlyContinue).Count;
    $f = (Select-String -Path "web\src\**\*.ts","web\src\**\*.tsx" -Pattern "\b$t\b" -ErrorAction SilentlyContinue).Count;
    $results += [PSCustomObject]@{T=$t; B=$b; F=$f; Tot=$b+$f};
}
Write-Host "TABLE_REF_COUNTS:";
foreach ($r in $results) { Write-Host "$($r.T),$($r.B),$($r.F),$($r.Tot)" };
Write-Host "\nUNREFERENCED_TABLES:";
foreach ($r in $results) { if ($r.Tot -eq 0) { Write-Host $r.T } };
