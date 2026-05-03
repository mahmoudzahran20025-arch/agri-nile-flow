import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const periods = new Hono<{ Bindings: Env }>()
periods.use('*', authMiddleware)
periods.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// ─── Close Workflow Step Definitions ─────────────────────────────────────────

const CLOSE_STEPS = [
  { key: 'inventory_gl',     order: 1, label: 'GL Posting — Inventory Movements',   critical: true  },
  { key: 'unposted_entries', order: 2, label: 'Unposted Journal Entries',            critical: true  },
  { key: 'balance_check',    order: 3, label: 'Double-Entry Balance Verification',   critical: true  },
  { key: 'orphan_entries',   order: 4, label: 'Entries Missing Period Assignment',   critical: false },
  { key: 'period_summary',   order: 5, label: 'Period Activity Summary',             critical: false },
] as const

type StepKey = typeof CLOSE_STEPS[number]['key']
type CheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'warning'

interface CheckRow {
  step_key: string; step_order: number; step_label: string; is_critical: boolean
  status: CheckStatus; count_blocked: number; details: string; action_url?: string
}

// ─── Helper: execute one check step + upsert into checklist table ─────────────

async function runStep(
  db: Env['DB'],
  companyId: number,
  periodId: number,
  startDate: string,
  endDate: string,
  stepKey: StepKey,
): Promise<CheckRow> {
  const meta = CLOSE_STEPS.find(s => s.key === stepKey)!
  let status: CheckStatus = 'passed'
  let countBlocked = 0
  let details = ''
  let actionUrl: string | undefined

  if (stepKey === 'inventory_gl') {
    const r = await db.prepare(
      `SELECT COUNT(*) as n FROM inventory_movements
       WHERE company_id=? AND movement_date >= ? AND movement_date <= ?
       AND gl_posting_status IN ('pending','failed','outbox_pending')`
    ).bind(companyId, startDate, endDate).first<{ n: number }>()
    countBlocked = r?.n ?? 0
    status  = countBlocked > 0 ? 'failed' : 'passed'
    details = countBlocked > 0
      ? `${countBlocked} حركة مخزنية في نطاق الفترة لم ترحل إلى دفتر الأستاذ بعد`
      : 'جميع الحركات المخزنية في نطاق الفترة مرحلة بنجاح'
    if (status === 'failed') actionUrl = '/gl/batch-posting'

  } else if (stepKey === 'unposted_entries') {
    const r = await db.prepare(
      `SELECT COUNT(*) as n FROM journal_entries WHERE company_id=? AND period_id=? AND is_posted=0`
    ).bind(companyId, periodId).first<{ n: number }>()
    countBlocked = r?.n ?? 0
    status  = countBlocked > 0 ? 'failed' : 'passed'
    details = countBlocked > 0
      ? `${countBlocked} قيد محاسبي غير مرحل — يجب ترحيله أو حذفه قبل الإغلاق`
      : 'جميع القيود المحاسبية في هذه الفترة مرحلة'
    if (status === 'failed') actionUrl = '/gl/entries'

  } else if (stepKey === 'balance_check') {
    const r = await db.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT je.id FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id = je.id
        WHERE je.company_id=? AND je.period_id=?
        GROUP BY je.id
        HAVING ABS(ROUND(SUM(jel.debit), 2) - ROUND(SUM(jel.credit), 2)) > 0.01
      )`
    ).bind(companyId, periodId).first<{ n: number }>()
    countBlocked = r?.n ?? 0
    status  = countBlocked > 0 ? 'failed' : 'passed'
    details = countBlocked > 0
      ? `${countBlocked} قيد غير متوازن — مجموع المدين لا يساوي مجموع الدائن`
      : 'جميع القيود متوازنة — مجموع المدين = مجموع الدائن'
    if (status === 'failed') actionUrl = '/gl/health-integrity'

  } else if (stepKey === 'orphan_entries') {
    const r = await db.prepare(
      `SELECT COUNT(*) as n FROM journal_entries
       WHERE company_id=? AND period_id IS NULL
       AND entry_date >= ? AND entry_date <= ?`
    ).bind(companyId, startDate, endDate).first<{ n: number }>()
    countBlocked = r?.n ?? 0
    status  = countBlocked > 0 ? 'warning' : 'passed'
    details = countBlocked > 0
      ? `${countBlocked} قيد مؤرخ ضمن نطاق الفترة لكن غير مرتبط بها — سيستثنى من لقطة الإغلاق`
      : 'جميع القيود في نطاق التاريخ مرتبطة بالفترة الصحيحة'
    if (status === 'warning') actionUrl = '/gl/health-integrity'

  } else if (stepKey === 'period_summary') {
    const r = await db.prepare(`
      SELECT COUNT(DISTINCT je.id) as entry_count,
             COALESCE(SUM(jel.debit),  0) as total_debit,
             COALESCE(SUM(jel.credit), 0) as total_credit
      FROM journal_entries je
      LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
      WHERE je.company_id=? AND je.period_id=? AND je.is_posted=1`
    ).bind(companyId, periodId).first<{
      entry_count: number; total_debit: number; total_credit: number
    }>()
    status = 'passed'
    const count = r?.entry_count ?? 0
    const dr    = (r?.total_debit  ?? 0).toLocaleString('en-US')
    const cr    = (r?.total_credit ?? 0).toLocaleString('en-US')
    details = `${count} قيد مرحل في الفترة | إجمالي المدين: ${dr} | إجمالي الدائن: ${cr}`
  }

  // Upsert the checklist row so the latest result is always visible in the UI
  await db.prepare(`
    INSERT INTO period_close_checklist
      (company_id, period_id, step_key, step_order, step_label, is_critical,
       status, count_blocked, details_json, completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(company_id, period_id, step_key) DO UPDATE SET
      status=excluded.status,
      count_blocked=excluded.count_blocked,
      details_json=excluded.details_json,
      completed_at=excluded.completed_at
  `).bind(
    companyId, periodId, stepKey, meta.order, meta.label, meta.critical ? 1 : 0,
    status, countBlocked, details,
  ).run()

  return {
    step_key: stepKey, step_order: meta.order, step_label: meta.label,
    is_critical: meta.critical, status, count_blocked: countBlocked,
    details, action_url: actionUrl,
  }
}

// ─── GET /api/gl/periods ──────────────────────────────────────────────────────

periods.get('/', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM financial_periods WHERE company_id=? ORDER BY start_date DESC')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

// ─── POST /api/gl/periods ─────────────────────────────────────────────────────

periods.post('/', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    name: string; period_type?: string; start_date: string; end_date: string
  }>()
  if (!b.name || !b.start_date || !b.end_date) {
    return c.json({ success: false, error: 'الاسم والتواريخ مطلوبة' }, 400)
  }
  // Single-open-period guard
  const openCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM financial_periods WHERE company_id=? AND is_closed=0'
  ).bind(company_id).first<{ n: number }>()
  if ((openCount?.n ?? 0) >= 1) {
    return c.json({
      success: false,
      error: 'يوجد فترة مالية مفتوحة بالفعل.',
      detail: 'يجب إغلاق الفترة الحالية بالكامل قبل إنشاء فترة جديدة. الفترات المتعددة المفتوحة غير مسموح بها حتى اكتمال سيناريوهات اختبار الإغلاق.',
      open_count: openCount?.n,
    }, 409)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO financial_periods (company_id, name, period_type, start_date, end_date, status) VALUES (?,?,?,?,?,'open')`
  ).bind(company_id, b.name, b.period_type ?? 'monthly', b.start_date, b.end_date).run()
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE', table_name: 'financial_periods',
    record_id: r.meta.last_row_id as number,
    new_value: { name: b.name, start_date: b.start_date, end_date: b.end_date },
  })
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

// ─── GET /api/gl/periods/:id ──────────────────────────────────────────────────

periods.get('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const period = await c.env.DB.prepare(
    'SELECT * FROM financial_periods WHERE id=? AND company_id=?'
  ).bind(id, company_id).first()
  if (!period) return c.json({ success: false, error: 'الفترة غير موجودة' }, 404)
  return c.json({ success: true, data: period })
})

// ─── GET /api/gl/periods/:id/checklist ────────────────────────────────────────
// Returns current checklist state. Returns 'pending' defaults for steps not yet run.

periods.get('/:id/checklist', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const period = await c.env.DB.prepare(
    'SELECT id, name, start_date, end_date, is_closed FROM financial_periods WHERE id=? AND company_id=?'
  ).bind(id, company_id).first<{
    id: number; name: string; start_date: string; end_date: string; is_closed: number
  }>()
  if (!period) return c.json({ success: false, error: 'الفترة غير موجودة' }, 404)

  const { results: stored } = await c.env.DB.prepare(
    `SELECT step_key, step_order, step_label, is_critical, status, count_blocked, details_json, completed_at
     FROM period_close_checklist WHERE company_id=? AND period_id=? ORDER BY step_order`
  ).bind(company_id, id).all<{
    step_key: string; step_order: number; step_label: string; is_critical: number
    status: CheckStatus; count_blocked: number; details_json: string; completed_at: string | null
  }>()

  // Fill in any steps not yet run as 'pending'
  const checks = CLOSE_STEPS.map(s => {
    const row = stored.find(r => r.step_key === s.key)
    return row
      ? { step_key: row.step_key, step_order: row.step_order, step_label: row.step_label,
          is_critical: row.is_critical === 1, status: row.status,
          count_blocked: row.count_blocked, details: row.details_json, completed_at: row.completed_at }
      : { step_key: s.key, step_order: s.order, step_label: s.label, is_critical: s.critical,
          status: 'pending' as CheckStatus, count_blocked: 0, details: '', completed_at: null }
  })

  const all_critical_passed = checks
    .filter(c => c.is_critical)
    .every(c => c.status === 'passed')

  return c.json({ success: true, data: { period, checks, all_critical_passed } })
})

// ─── POST /api/gl/periods/:id/checklist/run ───────────────────────────────────
// Run ALL 5 check steps and persist results.

periods.post('/:id/checklist/run', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const period = await c.env.DB.prepare(
    'SELECT id, name, start_date, end_date, is_closed FROM financial_periods WHERE id=? AND company_id=?'
  ).bind(id, company_id).first<{
    id: number; name: string; start_date: string; end_date: string; is_closed: number
  }>()
  if (!period) return c.json({ success: false, error: 'الفترة غير موجودة' }, 404)
  if (period.is_closed) return c.json({ success: false, error: 'الفترة مغلقة بالفعل — لا يمكن تشغيل الفحوصات' }, 409)

  const results: CheckRow[] = []
  for (const step of CLOSE_STEPS) {
    const row = await runStep(c.env.DB, company_id, id, period.start_date, period.end_date, step.key)
    results.push(row)
  }

  const all_critical_passed = results.filter(r => r.is_critical).every(r => r.status === 'passed')
  const blockers = results.filter(r => r.is_critical && r.status === 'failed').map(r => r.details)

  return c.json({ success: true, data: { checks: results, all_critical_passed, blockers } })
})

// ─── POST /api/gl/periods/:id/checklist/run/:step ─────────────────────────────
// Re-run a single check step.

periods.post('/:id/checklist/run/:step', async (c) => {
  const { company_id } = getUser(c)
  const id   = Number(c.req.param('id'))
  const step = c.req.param('step') as StepKey

  if (!CLOSE_STEPS.find(s => s.key === step)) {
    return c.json({ success: false, error: `خطوة غير معروفة: ${step}` }, 400)
  }

  const period = await c.env.DB.prepare(
    'SELECT id, start_date, end_date, is_closed FROM financial_periods WHERE id=? AND company_id=?'
  ).bind(id, company_id).first<{ id: number; start_date: string; end_date: string; is_closed: number }>()
  if (!period) return c.json({ success: false, error: 'الفترة غير موجودة' }, 404)
  if (period.is_closed) return c.json({ success: false, error: 'الفترة مغلقة بالفعل' }, 409)

  const result = await runStep(c.env.DB, company_id, id, period.start_date, period.end_date, step)
  return c.json({ success: true, data: result })
})

// ─── PATCH /api/gl/periods/:id/close ─────────────────────────────────────────
// Execute the actual period close.
// Requires all critical checklist steps to be 'passed', unless force=1 (admins only).

periods.patch('/:id/close', async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const id    = Number(c.req.param('id'))
  const force = c.req.query('force') === '1'

  const period = await c.env.DB.prepare(
    'SELECT id, name, start_date, end_date, is_closed FROM financial_periods WHERE id=? AND company_id=?'
  ).bind(id, company_id).first<{
    id: number; name: string; start_date: string; end_date: string; is_closed: number
  }>()
  if (!period) return c.json({ success: false, error: 'الفترة غير موجودة' }, 404)
  if (period.is_closed) return c.json({ success: false, error: 'الفترة مغلقة مسبقا' }, 409)

  // force=1 requires elevated role
  if (force && !['super_admin', 'company_admin'].includes(role ?? '')) {
    return c.json({
      success: false,
      error: 'تجاوز قائمة التحقق يتطلب صلاحيات مسؤول الشركة أو المسؤول العام',
    }, 403)
  }

  // Read checklist results
  const { results: checklistRows } = await c.env.DB.prepare(
    `SELECT step_key, is_critical, status, details_json
     FROM period_close_checklist WHERE company_id=? AND period_id=?`
  ).bind(company_id, id).all<{
    step_key: string; is_critical: number; status: CheckStatus; details_json: string
  }>()

  if (!force) {
    if (checklistRows.length === 0) {
      return c.json({
        success: false,
        error: 'يجب تشغيل قائمة التحقق أولا قبل إغلاق الفترة',
        hint: 'اضغط "تشغيل جميع الفحوصات" في لوحة الإغلاق ثم تأكد من نجاح جميع البنود الحرجة.',
      }, 409)
    }
    const criticalFailed = checklistRows.filter(r => r.is_critical === 1 && r.status !== 'passed')
    if (criticalFailed.length > 0) {
      return c.json({
        success: false,
        error: `لا يمكن إغلاق الفترة — يوجد ${criticalFailed.length} بند حرج لم يحل`,
        blockers: criticalFailed.map(r => r.details_json),
      }, 409)
    }
  }

  // ── Account-balance snapshot (independent of chart_of_accounts table) ────
  await c.env.DB.prepare(
    'DELETE FROM period_account_balances WHERE company_id=? AND period_id=?'
  ).bind(company_id, id).run()

  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO period_account_balances
      (company_id, period_id, account_code,
       opening_debit,  opening_credit,
       period_debit,   period_credit,
       closing_debit,  closing_credit,
       snapshotted_at)
    SELECT
      ?,
      ?,
      jel.account_code,
      COALESCE(SUM(CASE WHEN e.entry_date <  ?  AND e.is_posted=1 THEN jel.debit  ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN e.entry_date <  ?  AND e.is_posted=1 THEN jel.credit ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN e.entry_date >= ?  AND e.entry_date <= ? AND e.is_posted=1 THEN jel.debit  ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN e.entry_date >= ?  AND e.entry_date <= ? AND e.is_posted=1 THEN jel.credit ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN e.entry_date <= ?  AND e.is_posted=1 THEN jel.debit  ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN e.entry_date <= ?  AND e.is_posted=1 THEN jel.credit ELSE 0 END), 0),
      datetime('now')
    FROM journal_entry_lines jel
    JOIN journal_entries e ON e.id = jel.entry_id
    WHERE e.company_id = ?
    GROUP BY jel.account_code
  `).bind(
    company_id, id,
    period.start_date, period.start_date,
    period.start_date, period.end_date, period.start_date, period.end_date,
    period.end_date, period.end_date,
    company_id,
  ).run()

  // ── Lock the period ───────────────────────────────────────────────────────
  await c.env.DB.prepare(
    `UPDATE financial_periods
     SET is_closed=1, status='locked', closed_at=datetime('now'), closed_by=?
     WHERE id=? AND company_id=?`
  ).bind(userId, id, company_id).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CLOSE', table_name: 'financial_periods', record_id: id,
    new_value: { forced: force, period_name: period.name },
  })

  return c.json({
    success: true,
    data: { period_id: id, period_name: period.name, snapshot_created: true, forced: force },
  })
})

// ─── PATCH /api/gl/periods/:id/reopen ─────────────────────────────────────────
// Restricted to super_admin and company_admin ONLY.
// Also enforces single-open-period policy.

periods.patch('/:id/reopen', async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const id = Number(c.req.param('id'))

  if (!['super_admin', 'company_admin'].includes(role ?? '')) {
    return c.json({
      success: false,
      error: 'لا يمكنك إعادة فتح الفترة المالية',
      detail: 'إعادة فتح الفترة المالية تتطلب صلاحيات company_admin أو super_admin. تواصل مع المسؤول.',
    }, 403)
  }

  const period = await c.env.DB.prepare(
    'SELECT id, name, is_closed FROM financial_periods WHERE id=? AND company_id=?'
  ).bind(id, company_id).first<{ id: number; name: string; is_closed: number }>()
  if (!period) return c.json({ success: false, error: 'الفترة غير موجودة' }, 404)
  if (!period.is_closed) return c.json({ success: false, error: 'الفترة مفتوحة بالفعل' }, 409)

  // Enforce single-open-period policy
  const openCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM financial_periods WHERE company_id=? AND is_closed=0'
  ).bind(company_id).first<{ n: number }>()
  if ((openCount?.n ?? 0) >= 1) {
    return c.json({
      success: false,
      error: 'يوجد فترة مالية مفتوحة بالفعل',
      detail: 'لا يمكن إعادة فتح هذه الفترة لأن هناك فترة أخرى مفتوحة. أغلق الفترة المفتوحة أولا.',
    }, 409)
  }

  await c.env.DB.prepare(
    `UPDATE financial_periods
     SET is_closed=0, status='open', closed_at=NULL, closed_by=NULL
     WHERE id=? AND company_id=?`
  ).bind(id, company_id).run()

  // Reset checklist so the next close starts fresh
  await c.env.DB.prepare(
    `UPDATE period_close_checklist
     SET status='pending', count_blocked=0, details_json='', completed_at=NULL
     WHERE company_id=? AND period_id=?`
  ).bind(company_id, id).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'REOPEN', table_name: 'financial_periods', record_id: id,
    new_value: { period_name: period.name, reopened_by_role: role },
  })
  return c.json({ success: true, data: { period_id: id, period_name: period.name } })
})

export default periods
