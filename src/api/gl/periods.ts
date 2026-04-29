import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const periods = new Hono<{ Bindings: Env }>()
periods.use('*', authMiddleware)
periods.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// GET /api/gl/periods
periods.get('/', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM financial_periods WHERE company_id = ? ORDER BY start_date DESC')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/gl/periods
periods.post('/', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{
    name: string; period_type?: string; start_date: string; end_date: string
  }>()
  if (!b.name || !b.start_date || !b.end_date) {
    return c.json({ success: false, error: 'الاسم والتواريخ مطلوبة' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO financial_periods (company_id, name, period_type, start_date, end_date) VALUES (?,?,?,?,?)`
  ).bind(company_id, b.name, b.period_type ?? 'monthly', b.start_date, b.end_date).run()
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

// PATCH /api/gl/periods/:id/close
periods.patch('/:id/close', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const force = c.req.query('force') === '1'

  const period = await c.env.DB.prepare(
    'SELECT id, name, start_date, end_date, is_closed FROM financial_periods WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; name: string; start_date: string; end_date: string; is_closed: number }>()
  if (!period) return c.json({ success: false, error: 'الفترة غير موجودة' }, 404)
  if (period.is_closed) return c.json({ success: false, error: 'الفترة مغلقة مسبقاً' }, 409)

  // Guard: no unbalanced entries in this period
  const unbalanced = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT je.id FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id = je.id
      WHERE je.company_id = ? AND je.period_id = ?
      GROUP BY je.id
      HAVING ABS(ROUND(SUM(jel.debit), 2) - ROUND(SUM(jel.credit), 2)) > 0.01
    )`).bind(company_id, id).first<{ n: number }>()

  // Guard: no business events in 'error' or 'pending' state for this period
  const pendingEvents = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n FROM business_events be
    JOIN journal_entries je ON je.id = be.journal_entry_id
    WHERE be.company_id = ? AND je.period_id = ? AND be.status IN ('pending','error')
  `).bind(company_id, id).first<{ n: number }>()

  const blockers: string[] = []
  if ((unbalanced?.n ?? 0) > 0) blockers.push(`يوجد ${unbalanced!.n} قيد غير متوازن في هذه الفترة`)
  if ((pendingEvents?.n ?? 0) > 0) blockers.push(`يوجد ${pendingEvents!.n} حدث أعمال معلق أو خاطئ`)

  if (blockers.length > 0 && !force) {
    return c.json({
      success: false,
      error: 'لا يمكن إغلاق الفترة بسبب مشاكل في البيانات',
      blockers,
      hint: 'أضف force=1 للتجاهل (للمحاسبين الكبار فقط)',
    }, 409)
  }

  // Build immutable period snapshot for historical reporting.
  await c.env.DB.prepare('DELETE FROM period_account_balances WHERE company_id = ? AND period_id = ?')
    .bind(company_id, id).run()

  await c.env.DB.prepare(
    `INSERT INTO period_account_balances
     (company_id, period_id, account_code,
      opening_debit, opening_credit,
      period_debit, period_credit,
      closing_debit, closing_credit,
      snapshotted_at)
     SELECT
       ?, ?, a.code,
       COALESCE(ob.opening_debit, 0),
       COALESCE(ob.opening_credit, 0),
       COALESCE(pb.period_debit, 0),
       COALESCE(pb.period_credit, 0),
       COALESCE(ob.opening_debit, 0) + COALESCE(pb.period_debit, 0),
       COALESCE(ob.opening_credit, 0) + COALESCE(pb.period_credit, 0),
       datetime('now')
     FROM chart_of_accounts a
     LEFT JOIN (
       SELECT l.account_code,
              SUM(l.debit)  AS opening_debit,
              SUM(l.credit) AS opening_credit
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.company_id = ?
         AND e.is_posted = 1
         AND e.entry_date < ?
       GROUP BY l.account_code
     ) ob ON ob.account_code = a.code
     LEFT JOIN (
       SELECT l.account_code,
              SUM(l.debit)  AS period_debit,
              SUM(l.credit) AS period_credit
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.company_id = ?
         AND e.is_posted = 1
         AND e.entry_date >= ?
         AND e.entry_date <= ?
       GROUP BY l.account_code
     ) pb ON pb.account_code = a.code
     WHERE a.company_id = ?`
  ).bind(
    company_id,
    id,
    company_id,
    period.start_date,
    company_id,
    period.start_date,
    period.end_date,
    company_id,
  ).run()

  await c.env.DB.prepare(
    `UPDATE financial_periods SET is_closed = 1, closed_at = datetime('now'), closed_by = ? WHERE id = ? AND company_id = ?`
  ).bind(userId, id, company_id).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CLOSE', table_name: 'financial_periods', record_id: id,
    new_value: { forced: force, blockers_ignored: blockers },
  })
  return c.json({ success: true, data: { period_id: id, closed_with_warnings: blockers.length > 0 } })
})

// PATCH /api/gl/periods/:id/reopen
periods.patch('/:id/reopen', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE financial_periods SET is_closed = 0, closed_at = NULL, closed_by = NULL WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).run()
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'REOPEN', table_name: 'financial_periods', record_id: id,
  })
  return c.json({ success: true, data: null })
})

export default periods
