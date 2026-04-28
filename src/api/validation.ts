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
                SUM(CASE WHEN debit_amount > 0 THEN debit_amount ELSE 0 END) as total_debits,
                SUM(CASE WHEN credit_amount > 0 THEN credit_amount ELSE 0 END) as total_credits,
                SUM(debit_amount - credit_amount) as net_balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_code IN (SELECT account_code FROM gl_mappings WHERE mapping_key = 'inventory')`
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
                SUM(balance_with_checks) as total_balance,
                SUM(debit) as total_debits,
                SUM(credit) as total_credits
         FROM supplier_transactions`
      )
      .first<{
        row_count: number
        unique_suppliers: number
        total_balance: number
        total_debits: number
        total_credits: number
      }>()

    const supGL = await db
      .prepare(
        `SELECT COUNT(*) as line_count,
                COUNT(DISTINCT account_code) as unique_accounts,
                SUM(CASE WHEN debit_amount > 0 THEN debit_amount ELSE 0 END) as total_debits,
                SUM(CASE WHEN credit_amount > 0 THEN credit_amount ELSE 0 END) as total_credits,
                SUM(debit_amount - credit_amount) as net_balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_code IN (SELECT account_code FROM gl_mappings WHERE mapping_key = 'accounts_payable')`
      )
      .first<{
        line_count: number
        unique_accounts: number
        total_debits: number
        total_credits: number
        net_balance: number
      }>()

    // Top mismatched suppliers
    const mismatchedSuppliers = await db
      .prepare(
        `SELECT supplier_code, SUM(balance_with_checks) as balance, COUNT(*) as txn_count
         FROM supplier_transactions
         GROUP BY supplier_code
         ORDER BY balance DESC
         LIMIT 10`
      )
      .all<{ supplier_code: string; balance: number; txn_count: number }>()

    results.suppliers = {
      movements: supMovements,
      gl: supGL,
      difference:
        (supMovements?.total_balance ?? 0) - (supGL?.net_balance ?? 0),
      variance_pct:
        supGL?.net_balance && supMovements?.total_balance
          ? Math.abs(
              (((supMovements.total_balance - supGL.net_balance) /
                supGL.net_balance) *
                100)
            ).toFixed(2)
          : 'N/A',
      status:
        supMovements?.total_balance === supGL?.net_balance
          ? 'MATCH'
          : 'MISMATCH',
      top_suppliers: mismatchedSuppliers.results || [],
    }

    // ========================================================================
    // STEP 3: CASH ↔ GL
    // ========================================================================

    const cashMovements = await db
      .prepare(
        `SELECT COUNT(*) as row_count,
                MAX(running_balance) as final_balance,
                MAX(transaction_date) as latest_date
         FROM cash_transactions`
      )
      .first<{
        row_count: number
        final_balance: number
        latest_date: string
      }>()

    const cashGL = await db
      .prepare(
        `SELECT COUNT(*) as line_count,
                SUM(CASE WHEN debit_amount > 0 THEN debit_amount ELSE 0 END) as total_debits,
                SUM(CASE WHEN credit_amount > 0 THEN credit_amount ELSE 0 END) as total_credits,
                SUM(debit_amount - credit_amount) as net_balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_code IN (SELECT account_code FROM gl_mappings WHERE mapping_key IN ('cash', 'bank'))`
      )
      .first<{
        line_count: number
        total_debits: number
        total_credits: number
        net_balance: number
      }>()

    results.cash = {
      movements: cashMovements,
      gl: cashGL,
      difference:
        (cashMovements?.final_balance ?? 0) - (cashGL?.net_balance ?? 0),
      variance_pct:
        cashGL?.net_balance && cashMovements?.final_balance
          ? Math.abs(
              (((cashMovements.final_balance - cashGL.net_balance) /
                cashGL.net_balance) *
                100)
            ).toFixed(2)
          : 'N/A',
      status:
        cashMovements?.final_balance === cashGL?.net_balance
          ? 'MATCH'
          : 'MISMATCH',
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

    // Supplier trace
    const supTrace = await db
      .prepare(
        `SELECT
           COUNT(DISTINCT st.id) as total_transactions,
           COUNT(DISTINCT be.id) as linked_events,
           COUNT(DISTINCT st.id) - COUNT(DISTINCT be.id) as orphan_count,
           ROUND(100.0 * COUNT(DISTINCT be.id) / NULLIF(COUNT(DISTINCT st.id), 0), 2) as coverage_pct
         FROM supplier_transactions st
         LEFT JOIN business_events be ON be.source_id = st.id AND be.source_module IN ('supplier_invoice', 'supplier_payment')`
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
         LEFT JOIN business_events be ON be.source_id = ct.id AND be.source_module = 'cash'`
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

    const missingInvGroup = await db
      .prepare(`SELECT COUNT(*) as count FROM items WHERE inv_posting_group_code IS NULL`)
      .first<{ count: number }>()

    const orphanLines = await db
      .prepare(
        `SELECT COUNT(*) as count FROM journal_entry_lines jel
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
         LEFT JOIN business_events be ON be.id = je.business_event_id
         WHERE be.id IS NULL AND je.source_module NOT IN ('manual', 'adjustment')`
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
    const lowCoverage = allTraces.some((t) => (t?.coverage_pct ?? 0) < 90)
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
