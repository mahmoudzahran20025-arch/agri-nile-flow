import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const reconciliationStatus = new Hono<{ Bindings: Env }>()

// GET /reports/reconciliation-status
// Compares sub-ledger totals against GL control accounts.
// Returns three boundary checks: AP (2120), Inventory (1407), Payroll Payable (21200001).
// A gap > 0.01 EGP indicates unreconciled postings and must be investigated.
reconciliationStatus.get('/reconciliation-status', async (c) => {
  const { company_id } = getUser(c)

  const [
    apSubledger,
    gl2120,
    invRunning,
    gl1407,
    payrollUnpaid,
    gl21200001,
    ghostEntries,
    orphanEvents,
  ] = await Promise.all([

    // ── AP Sub-ledger total (source: supplier_ap_ledger VIEW) ────────────────
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(net_ap_balance), 0) AS total
       FROM supplier_ap_ledger WHERE company_id = ?`
    ).bind(company_id).first<{ total: number }>(),

    // ── GL control account 2120% balance ─────────────────────────────────────
    c.env.DB.prepare(
      `SELECT
         COALESCE(SUM(jel.credit - jel.debit), 0) AS balance
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
       WHERE je.company_id = ?
         AND jel.account_code LIKE '2120%'
         AND je.status = 'posted'`
    ).bind(company_id).first<{ balance: number }>(),

    // ── Inventory running balance (source: inventory_balances snapshot) ──────
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(balance_value), 0) AS total
       FROM inventory_balances
       WHERE company_id = ?`
    ).bind(company_id).first<{ total: number }>(),

    // ── GL control account 1407% balance ─────────────────────────────────────
    c.env.DB.prepare(
      `SELECT
         COALESCE(SUM(jel.debit - jel.credit), 0) AS balance
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
       WHERE je.company_id = ?
         AND jel.account_code LIKE '1407%'
         AND je.is_posted = 1`
    ).bind(company_id).first<{ balance: number }>(),

    // ── Approved-but-unpaid payroll (sub-ledger for wages payable) ───────────
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(total_net), 0) AS total
       FROM payroll_runs
       WHERE company_id = ? AND status = 'approved'`
    ).bind(company_id).first<{ total: number }>(),

    // ── GL control account 21200001 (wages payable) balance ──────────────────
    c.env.DB.prepare(
      `SELECT
         COALESCE(SUM(jel.credit - jel.debit), 0) AS balance
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
       WHERE je.company_id = ?
         AND jel.account_code = '21200001'
         AND je.is_posted = 1`
    ).bind(company_id).first<{ balance: number }>(),

    // ── Ghost entries: posted GL with no business_event backlink ─────────────
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM journal_entries je
       WHERE je.company_id = ? AND je.is_posted = 1
         AND je.source_module IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM business_events be
           WHERE be.company_id = je.company_id
             AND be.source_module = je.source_module
             AND be.source_id = je.source_id
         )`
    ).bind(company_id).first<{ n: number }>(),

    // ── Orphan events: business_events with no GL entry ─────────────────────
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM business_events be
       WHERE be.company_id = ?
         AND be.journal_entry_id IS NULL`
    ).bind(company_id).first<{ n: number }>(),
  ])

  const apSubTotal    = apSubledger?.total ?? 0
  const ap2120Balance = gl2120?.balance    ?? 0
  const apGap         = Math.round((apSubTotal - ap2120Balance)     * 100) / 100

  const invTotal      = invRunning?.total ?? 0
  const inv1407Bal    = gl1407?.balance   ?? 0
  const invGap        = Math.round((invTotal - inv1407Bal)          * 100) / 100

  const paySubTotal   = payrollUnpaid?.total ?? 0
  const pay2120Bal    = gl21200001?.balance  ?? 0
  const payGap        = Math.round((paySubTotal - pay2120Bal)       * 100) / 100

  const THRESHOLD = 0.01

  return c.json({
    success: true,
    data: {
      checked_at: new Date().toISOString(),
      boundaries: {
        ap: {
          label:         'الذمم الدائنة (AP)',
          sub_account:   '2120%',
          subledger_total: apSubTotal,
          gl_balance:      ap2120Balance,
          gap:             apGap,
          ok:              Math.abs(apGap) <= THRESHOLD,
          severity:        Math.abs(apGap) > 1000 ? 'critical' : Math.abs(apGap) > THRESHOLD ? 'warning' : 'ok',
        },
        inventory: {
          label:         'مخزون (Asset)',
          sub_account:   '1407%',
          subledger_total: invTotal,
          gl_balance:      inv1407Bal,
          gap:             invGap,
          ok:              Math.abs(invGap) <= THRESHOLD,
          severity:        Math.abs(invGap) > 1000 ? 'critical' : Math.abs(invGap) > THRESHOLD ? 'warning' : 'ok',
        },
        payroll_payable: {
          label:         'مستحقات الرواتب',
          sub_account:   '21200001',
          subledger_total: paySubTotal,
          gl_balance:      pay2120Bal,
          gap:             payGap,
          ok:              Math.abs(payGap) <= THRESHOLD,
          severity:        Math.abs(payGap) > 1000 ? 'critical' : Math.abs(payGap) > THRESHOLD ? 'warning' : 'ok',
        },
      },
      integrity: {
        ghost_entries:  ghostEntries?.n  ?? 0,
        orphan_events:  orphanEvents?.n  ?? 0,
        all_clean:      (ghostEntries?.n ?? 0) === 0 && (orphanEvents?.n ?? 0) === 0,
      },
      overall_ok: Math.abs(apGap) <= THRESHOLD
                && Math.abs(invGap) <= THRESHOLD
                && Math.abs(payGap) <= THRESHOLD
                && (ghostEntries?.n ?? 0) === 0
                && (orphanEvents?.n ?? 0) === 0,
    },
  })
})

export default reconciliationStatus
