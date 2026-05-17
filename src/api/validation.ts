import { Hono } from 'hono'
import type { Env, JwtPayload } from '../types'

const app = new Hono<{ Bindings: Env; Variables: { jwtPayload: JwtPayload } }>()

// Financial consistency validation endpoint
app.post('/financial-consistency', async (c) => {
  const db = c.env.DB

  try {
    const results: Record<string, any> = {}

    // ========================================================================
    // STEP 1: INVENTORY ↔ GL
    // ========================================================================

    const invMovements = await db
      .prepare(
        `SELECT COUNT(*) as row_count, SUM(balance_value) as total_balance_value
         FROM inventory_movements`
      )
      .first<{ row_count: number; total_balance_value: number }>()

    const invGL = await db
      .prepare(
        `SELECT COUNT(*) as line_count,
                SUM(CASE WHEN debit > 0 THEN debit ELSE 0 END) as total_debits,
                SUM(CASE WHEN credit > 0 THEN credit ELSE 0 END) as total_credits,
                SUM(debit - credit) as net_balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
         JOIN chart_of_accounts coa ON coa.code = jel.account_code AND coa.company_id = jel.company_id
         WHERE coa.code LIKE '1407%'`
      )
      .first<{
        line_count: number
        total_debits: number
        total_credits: number
        net_balance: number
      }>()

    results.inventory = {
      movements: invMovements,
      gl: invGL,
      difference:
        (invMovements?.total_balance_value ?? 0) - (invGL?.net_balance ?? 0),
      variance_pct:
        invGL?.net_balance && invMovements?.total_balance_value
          ? Math.abs(
              (((invMovements.total_balance_value - invGL.net_balance) /
                invGL.net_balance) *
                100)
            ).toFixed(2)
          : 'N/A',
      status:
        invMovements?.total_balance_value === invGL?.net_balance
          ? 'MATCH'
          : 'MISMATCH',
    }

    // ========================================================================
    // STEP 2: SUPPLIERS ↔ GL
    // ========================================================================

    const supMovements = await db
      .prepare(
        `SELECT COUNT(*) as row_count,
                COUNT(DISTINCT supplier_code) as unique_suppliers,
                SUM(credit) - SUM(debit) as net_ap_balance,
                SUM(debit) as total_debits,
                SUM(credit) as total_credits
         FROM supplier_transactions
         WHERE status = 'posted'`
      )
      .first<{
        row_count: number
        unique_suppliers: number
        net_ap_balance: number
        total_debits: number
        total_credits: number
      }>()

    const supGL = await db
      .prepare(
        `SELECT COUNT(*) as line_count,
                COUNT(DISTINCT account_code) as unique_accounts,
                SUM(CASE WHEN debit > 0 THEN debit ELSE 0 END) as total_debits,
                SUM(CASE WHEN credit > 0 THEN credit ELSE 0 END) as total_credits,
                SUM(credit) - SUM(debit) as net_ap_balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
         JOIN chart_of_accounts coa ON coa.code = jel.account_code AND coa.company_id = jel.company_id
         WHERE coa.code LIKE '2120%' AND je.is_posted = 1`
      )
      .first<{
        line_count: number
        unique_accounts: number
        total_debits: number
        total_credits: number
        net_ap_balance: number
      }>()

    // Per-supplier net balance (credit - debit) for top outstanding
    const mismatchedSuppliers = await db
      .prepare(
        `SELECT supplier_code, SUM(credit) - SUM(debit) as balance, COUNT(*) as txn_count
         FROM supplier_transactions WHERE status = 'posted'
         GROUP BY supplier_code
         ORDER BY balance DESC
         LIMIT 10`
      )
      .all<{ supplier_code: string; balance: number; txn_count: number }>()

    const apSubLedger = supMovements?.net_ap_balance ?? 0
    const apGL        = supGL?.net_ap_balance ?? 0
    results.suppliers = {
      movements: supMovements,
      gl: supGL,
      difference: apSubLedger - apGL,
      variance_pct:
        apGL !== 0
          ? Math.abs(((apSubLedger - apGL) / apGL) * 100).toFixed(2)
          : 'N/A',
      status: apSubLedger === apGL ? 'MATCH' : 'MISMATCH',
      top_suppliers: mismatchedSuppliers.results || [],
    }

    // ========================================================================
    // STEP 3: CASH ↔ GL
    // ========================================================================

    const cashMovements = await db
      .prepare(
        `SELECT COUNT(*) as row_count,
                SUM(last_balance) as final_balance,
                MAX(latest_date) as latest_date
         FROM (
           SELECT financial_account_id,
                  running_balance as last_balance,
                  transaction_date as latest_date
           FROM cash_transactions ct
           WHERE status = 'posted'
             AND id = (
               SELECT id FROM cash_transactions
               WHERE company_id = ct.company_id
                 AND financial_account_id IS NOT DISTINCT FROM ct.financial_account_id
                 AND status = 'posted'
               ORDER BY transaction_date DESC, id DESC LIMIT 1
             )
         )`
      )
      .first<{
        row_count: number
        final_balance: number
        latest_date: string
      }>()

    const cashGL = await db
      .prepare(
        `SELECT COUNT(*) as line_count,
                SUM(CASE WHEN debit > 0 THEN debit ELSE 0 END) as total_debits,
                SUM(CASE WHEN credit > 0 THEN credit ELSE 0 END) as total_credits,
                SUM(debit) - SUM(credit) as net_cash_balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
         JOIN chart_of_accounts coa ON coa.code = jel.account_code AND coa.company_id = jel.company_id
         WHERE coa.code LIKE '1401%' AND je.is_posted = 1`
      )
      .first<{
        line_count: number
        total_debits: number
        total_credits: number
        net_cash_balance: number
      }>()

    const cashSubLedger = cashMovements?.final_balance ?? 0
    const cashGLBalance = cashGL?.net_cash_balance ?? 0
    results.cash = {
      movements: cashMovements,
      gl: cashGL,
      difference: cashSubLedger - cashGLBalance,
      variance_pct:
        cashGLBalance !== 0
          ? Math.abs(((cashSubLedger - cashGLBalance) / cashGLBalance) * 100).toFixed(2)
          : 'N/A',
      status: cashSubLedger === cashGLBalance ? 'MATCH' : 'MISMATCH',
    }

    // ========================================================================
    // STEP 4: TRACE COMPLETENESS
    // ========================================================================

    // Inventory trace
    const invTrace = await db
      .prepare(
        `SELECT
           COUNT(DISTINCT im.id) as total_movements,
           COUNT(DISTINCT be.id) as linked_events,
           COUNT(DISTINCT im.id) - COUNT(DISTINCT be.id) as orphan_count,
           ROUND(100.0 * COUNT(DISTINCT be.id) / NULLIF(COUNT(DISTINCT im.id), 0), 2) as coverage_pct
         FROM inventory_movements im
         LEFT JOIN business_events be ON be.source_id = im.id AND be.source_module = 'inventory'`
      )
      .first<{
        total_movements: number
        linked_events: number
        orphan_count: number
        coverage_pct: number
      }>()

    // Supplier trace — excludes cash-mirror entries (document_type='cash_payment')
    // which are shadow rows inserted by prepareCashMovement and carry no direct business event
    const supTrace = await db
      .prepare(
        `SELECT
           COUNT(DISTINCT st.id) as total_transactions,
           COUNT(DISTINCT be.id) as linked_events,
           COUNT(DISTINCT st.id) - COUNT(DISTINCT be.id) as orphan_count,
           ROUND(100.0 * COUNT(DISTINCT be.id) / NULLIF(COUNT(DISTINCT st.id), 0), 2) as coverage_pct
         FROM supplier_transactions st
         LEFT JOIN business_events be ON be.source_id = st.id AND be.source_module IN ('supplier_invoice', 'supplier_payment', 'suppliers')
         WHERE (st.document_type IS NULL OR st.document_type != 'cash_payment')`
      )
      .first<{
        total_transactions: number
        linked_events: number
        orphan_count: number
        coverage_pct: number
      }>()

    // Cash trace
    const cashTrace = await db
      .prepare(
        `SELECT
           COUNT(DISTINCT ct.id) as total_transactions,
           COUNT(DISTINCT be.id) as linked_events,
           COUNT(DISTINCT ct.id) - COUNT(DISTINCT be.id) as orphan_count,
           ROUND(100.0 * COUNT(DISTINCT be.id) / NULLIF(COUNT(DISTINCT ct.id), 0), 2) as coverage_pct
         FROM cash_transactions ct
         LEFT JOIN business_events be ON be.source_id = ct.id AND be.source_module IN ('cash', 'treasury')`
      )
      .first<{
        total_transactions: number
        linked_events: number
        orphan_count: number
        coverage_pct: number
      }>()

    results.trace_completeness = {
      inventory: invTrace,
      suppliers: supTrace,
      cash: cashTrace,
    }

    // ========================================================================
    // STEP 5: DATA QUALITY
    // ========================================================================

    const missingProdGroup = await db
      .prepare(`SELECT COUNT(*) as count FROM items WHERE prod_posting_group_code IS NULL`)
      .first<{ count: number }>()

    // inv_posting_group_code lives on warehouses, not items — check active warehouses missing it
    const missingInvGroup = await db
      .prepare(`SELECT COUNT(*) as count FROM warehouses WHERE is_active = 1 AND inv_posting_group_code IS NULL`)
      .first<{ count: number }>()

    // Orphan lines: journal_entry_lines whose parent journal_entries row is missing
    // (indicates data integrity issue — lines written without a header)
    const orphanLines = await db
      .prepare(
        `SELECT COUNT(*) as count FROM journal_entry_lines jel
         LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
         WHERE je.id IS NULL`
      )
      .first<{ count: number }>()

    results.data_quality = {
      items_missing_prod_group: missingProdGroup?.count ?? 0,
      items_missing_inv_group: missingInvGroup?.count ?? 0,
      orphan_journal_lines: orphanLines?.count ?? 0,
    }

    // ========================================================================
    // FINAL VERDICT
    // ========================================================================

    const allTraces = [invTrace, supTrace, cashTrace]
    const hasOrphans = allTraces.some((t) => (t?.orphan_count ?? 0) > 0)
    // coverage_pct is NULL when the source table is empty — skip the check in that case
    const lowCoverage = allTraces.some(
      (t) => t?.coverage_pct != null && t.coverage_pct < 90
    )
    const hasDataQualityIssues =
      (missingProdGroup?.count ?? 0) > 0 ||
      (missingInvGroup?.count ?? 0) > 0 ||
      (orphanLines?.count ?? 0) > 0

    let verdict = 'SAFE'
    let recommendation = 'System is operationally clean. Proceed with demo.'

    if (hasOrphans || lowCoverage) {
      verdict = 'UNSAFE'
      recommendation = 'FIX IN PLACE: Reconcile orphan records before cleanup.'
    } else if (hasDataQualityIssues) {
      verdict = 'CONDITIONAL'
      recommendation = 'RESET DATA: Backfill missing posting groups, then regenerate GL.'
    }

    results.verdict = {
      status: verdict,
      recommendation,
      issues: {
        orphan_records: hasOrphans,
        low_trace_coverage: lowCoverage,
        data_quality: hasDataQualityIssues,
      },
    }

    return c.json(results, 200)
  } catch (error: any) {
    return c.json(
      {
        error: 'Validation failed',
        message: error?.message || String(error),
      },
      500
    )
  }
})

export default app
