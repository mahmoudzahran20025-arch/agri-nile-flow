/**
 * daily_finance_health.ts
 * =======================
 * Nightly finance health check — runs via Cloudflare Workers cron.
 * Checks: GL balance, error events, stale inventory balances,
 * zero-value JE lines, pending outbox items.
 * Writes result to daily_finance_health_log and auto-heals stale balances.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { getTodayIsoDate } from './utils/date'

export interface HealthCheckResult {
  run_date:                string
  gl_balance:              number
  error_events:            number
  stale_balances:          number
  zero_jel:                number
  pending_outbox:          number
  failed_outbox:           number
  ap_overdue_gt90:         number
  ap_total_open:           number
  orphan_journal_entries:  number
  supplier_gl_gap:         number
  alerts:                  string[]
  status:                  'ok' | 'warning' | 'critical'
}

// AP aging thresholds — alert when any supplier has invoices overdue >90d
const AP_OVERDUE_GT90_ALERT_THRESHOLD  = 0       // any >90d overdue triggers warning
const AP_OVERDUE_GT90_CRITICAL_AMOUNT  = 50_000  // >50k EGP overdue >90d is critical

export async function runDailyFinanceHealth(
  db: D1Database,
  companyId: number,
): Promise<HealthCheckResult> {
  const runDate = getTodayIsoDate()
  const alerts: string[] = []

  const [glRow, errRow, staleRow, zeroRow, outboxRow, failedOutboxRow, apRow, orphanJeRow, supplierGlGapRow, auditActivityRow] = await Promise.all([
    db.prepare(`SELECT ROUND(SUM(debit) - SUM(credit), 2) AS bal FROM journal_entry_lines WHERE company_id = ?`)
      .bind(companyId).first<{ bal: number | null }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM business_events WHERE company_id = ? AND status = 'error'`)
      .bind(companyId).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM inventory_balances WHERE company_id = ? AND is_stale = 1`)
      .bind(companyId).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM journal_entry_lines WHERE company_id = ? AND debit = 0 AND credit = 0`)
      .bind(companyId).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM inventory_posting_outbox WHERE company_id = ? AND status IN ('pending','outbox_pending')`)
      .bind(companyId).first<{ n: number }>(),
    // Dead-letter: outbox items that exhausted all retries — permanent GL gap if not addressed
    db.prepare(`SELECT COUNT(*) AS n FROM inventory_posting_outbox WHERE company_id = ? AND status = 'failed'`)
      .bind(companyId).first<{ n: number }>(),
    // AP aging check: total open AP and amount overdue >90d from supplier_ap_ledger VIEW
    db.prepare(`
      SELECT
        COALESCE(SUM(net_ap_balance), 0)                                                   AS total_open,
        COALESCE(SUM(CASE WHEN days_overdue_max > 90 THEN net_ap_balance ELSE 0 END), 0)   AS overdue_gt90,
        COUNT(CASE WHEN days_overdue_max > 90 THEN 1 END)                                  AS suppliers_overdue_gt90
      FROM supplier_ap_ledger
      WHERE company_id = ? AND net_ap_balance > 0
    `).bind(companyId).first<{ total_open: number; overdue_gt90: number; suppliers_overdue_gt90: number }>(),
    // RISK-09: orphan draft journal entries — header inserted, lines failed, Worker crashed before cleanup
    db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE company_id = ? AND is_posted = 0 AND created_at < datetime('now', '-1 hour')`)
      .bind(companyId).first<{ n: number }>(),
    // RISK-11: supplier transactions posted to subledger with no GL entry (AP↔GL divergence)
    db.prepare(`SELECT COUNT(*) AS n FROM supplier_transactions WHERE company_id = ? AND status = 'posted' AND journal_entry_id IS NULL`)
      .bind(companyId).first<{ n: number }>(),
    // RISK-12: audit log activity check — if zero logs in past day despite activity, flag it
    db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE company_id = ? AND created_at > datetime('now', '-1 day')`)
      .bind(companyId).first<{ n: number }>(),
  ])

  const glBalance           = glRow?.bal ?? 0
  const errorEvents         = errRow?.n ?? 0
  const staleCount          = staleRow?.n ?? 0
  const zeroJel             = zeroRow?.n ?? 0
  const pendingOutbox       = outboxRow?.n ?? 0
  const failedOutbox        = failedOutboxRow?.n ?? 0
  const apTotalOpen         = apRow?.total_open ?? 0
  const apOverdueGt90       = apRow?.overdue_gt90 ?? 0
  const apSuppliersOverdue  = apRow?.suppliers_overdue_gt90 ?? 0
  const orphanJournalEntries  = orphanJeRow?.n ?? 0
  const supplierGlGap         = supplierGlGapRow?.n ?? 0
  const auditLogActivity      = auditActivityRow?.n ?? 0

  if (Math.abs(glBalance) > 0.01) alerts.push(`GL_UNBALANCED: balance = ${glBalance}`)
  if (errorEvents > 0)            alerts.push(`BUSINESS_EVENT_ERRORS: ${errorEvents} failed events`)
  if (zeroJel > 0)                alerts.push(`ZERO_VALUE_JEL: ${zeroJel} lines with debit=0 AND credit=0`)
  if (pendingOutbox > 50)         alerts.push(`OUTBOX_BACKLOG: ${pendingOutbox} pending items`)
  if (failedOutbox > 0)           alerts.push(`OUTBOX_DEAD_LETTER: ${failedOutbox} inventory movements permanently unposted — GL/inventory divergence`)
  if (apOverdueGt90 > AP_OVERDUE_GT90_ALERT_THRESHOLD)
    alerts.push(`AP_OVERDUE_GT90: ${apSuppliersOverdue} موردين — مبلغ متأخر أكثر من 90 يوم: ${apOverdueGt90.toFixed(2)} ج.م`)
  if (orphanJournalEntries > 0)   alerts.push(`ORPHAN_JOURNAL_ENTRIES: ${orphanJournalEntries} draft entries older than 1h — Worker crash during GL write`)
  if (supplierGlGap > 0)          alerts.push(`SUPPLIER_GL_GAP: ${supplierGlGap} posted supplier transactions with no journal_entry_id — AP/GL divergence`)
  if (auditLogActivity === 0)     alerts.push(`AUDIT_LOG_SILENT: no audit entries in past 24h — possible audit write failures`)

  // Auto-heal stale inventory balances
  if (staleCount > 0) {
    try {
      await db.prepare(
        `UPDATE inventory_balances
         SET balance_qty = (
           SELECT COALESCE(SUM(qty_in - qty_out), 0)
           FROM inventory_movements
           WHERE company_id = inventory_balances.company_id
             AND item_code  = inventory_balances.item_code
             AND warehouse_id = inventory_balances.warehouse_id
         ),
         balance_value = (
           SELECT COALESCE(SUM(value_in - value_out), 0)
           FROM inventory_movements
           WHERE company_id = inventory_balances.company_id
             AND item_code  = inventory_balances.item_code
             AND warehouse_id = inventory_balances.warehouse_id
         ),
         is_stale = 0,
         last_movement_id = (
           SELECT MAX(id) FROM inventory_movements
           WHERE company_id = inventory_balances.company_id
             AND item_code  = inventory_balances.item_code
             AND warehouse_id = inventory_balances.warehouse_id
         )
         WHERE company_id = ? AND is_stale = 1`
      ).bind(companyId).run()
    } catch {
      alerts.push(`STALE_HEAL_FAILED: ${staleCount} stale balances could not be auto-healed`)
    }
  }

  const status: HealthCheckResult['status'] =
    Math.abs(glBalance) > 0.01 || apOverdueGt90 > AP_OVERDUE_GT90_CRITICAL_AMOUNT || failedOutbox > 0 ? 'critical'
    : alerts.length > 0 ? 'warning'
    : 'ok'

  await db.prepare(
    `INSERT INTO daily_finance_health_log
     (company_id, run_date, gl_balance, error_events, stale_balances, zero_jel, pending_outbox, alerts, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    companyId, runDate, glBalance, errorEvents, staleCount,
    zeroJel, pendingOutbox, alerts.length > 0 ? JSON.stringify(alerts) : null, status,
  ).run()

  return {
    run_date:               runDate,
    gl_balance:             glBalance,
    error_events:           errorEvents,
    stale_balances:         staleCount,
    zero_jel:               zeroJel,
    pending_outbox:         pendingOutbox,
    failed_outbox:          failedOutbox,
    ap_overdue_gt90:        apOverdueGt90,
    ap_total_open:          apTotalOpen,
    orphan_journal_entries: orphanJournalEntries,
    supplier_gl_gap:        supplierGlGap,
    alerts,
    status,
  }
}

export async function runHealthForAllCompanies(db: D1Database): Promise<void> {
  // RISK-13: use companies table as source of truth — business_events may be empty for new companies
  const { results } = await db.prepare(
    `SELECT id AS company_id FROM companies WHERE is_active = 1 LIMIT 50`
  ).all<{ company_id: number }>()

  for (const { company_id } of results) {
    try {
      const result = await runDailyFinanceHealth(db, company_id)
      if (result.status !== 'ok') {
        console.warn(`[HealthCheck] Company ${company_id} status=${result.status} alerts=${JSON.stringify(result.alerts)}`)
      }
    } catch (err) {
      console.error(`[HealthCheck] Failed for company ${company_id}:`, err)
    }
  }
}
