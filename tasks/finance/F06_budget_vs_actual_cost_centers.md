# BudgetVsActualPage — verify cost center breakdown is GL-sourced
- Read BudgetVsActualPage.tsx and its backend endpoint in src/api/budgets.ts.
- Confirm actuals come from journal_entry_lines (GL-primary), not operational tables.
- If actuals still come from cash_transactions/work_tasks: redirect to GL query with center_code filter.
Verification:
- Adding a manual journal entry to a cost center reflects in BudgetVsActualPage actuals.
