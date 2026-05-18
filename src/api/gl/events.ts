import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'

const events = new Hono<{ Bindings: Env }>()
events.use('*', authMiddleware)
events.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// GET /api/gl/events — list business events with filtering
events.get('/', async (c) => {
  const { company_id } = getUser(c)
  const status      = c.req.query('status')    // pending|posted|error|reversed
  const module      = c.req.query('module')
  const start       = c.req.query('start')
  const end         = c.req.query('end')
  const ackRaw      = c.req.query('acknowledged') // '0'|'1'
  const page        = Math.max(1, Number(c.req.query('page') ?? 1))
  const size        = Math.min(100, Math.max(1, Number(c.req.query('size') ?? 50)))
  const offset      = (page - 1) * size

  let where = 'WHERE company_id = ?'
  const p: unknown[] = [company_id]

  if (status)            { where += ' AND status = ?';        p.push(status) }
  if (module)            { where += ' AND source_module = ?'; p.push(module) }
  if (start)             { where += ' AND event_date >= ?';   p.push(start) }
  if (end)               { where += ' AND event_date <= ?';   p.push(end) }
  if (ackRaw === '0')    { where += ' AND acknowledged = 0' }
  if (ackRaw === '1')    { where += ' AND acknowledged = 1' }

  const [countRow, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM business_events ${where}`)
      .bind(...p).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT id, event_type, event_date, source_module, source_id,
              status, error_message, journal_entry_id,
              acknowledged, acknowledged_by, acknowledged_at, created_at
       FROM business_events ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...p, size, offset).all<{
      id: number; event_type: string; event_date: string
      source_module: string; source_id: number; status: string
      error_message: string | null; journal_entry_id: number | null
      acknowledged: number; acknowledged_by: number | null
      acknowledged_at: string | null; created_at: string
    }>(),
  ])

  return c.json({
    success: true,
    data: {
      total: countRow?.n ?? 0,
      page,
      size,
      rows: rows.results,
    },
  })
})

// GET /api/gl/events/summary — counts by status for dashboard KPI
events.get('/summary', async (c) => {
  const { company_id } = getUser(c)

  const rows = await c.env.DB.prepare(
    `SELECT status,
            COUNT(*) AS total,
            SUM(CASE WHEN acknowledged = 0 THEN 1 ELSE 0 END) AS unacknowledged
     FROM business_events
     WHERE company_id = ?
     GROUP BY status`
  ).bind(company_id).all<{ status: string; total: number; unacknowledged: number }>()

  const summary: Record<string, { total: number; unacknowledged: number }> = {}
  for (const r of rows.results) {
    summary[r.status] = { total: r.total, unacknowledged: r.unacknowledged }
  }

  return c.json({
    success: true,
    data: {
      pending:   summary['pending']   ?? { total: 0, unacknowledged: 0 },
      posted:    summary['posted']    ?? { total: 0, unacknowledged: 0 },
      error:     summary['error']     ?? { total: 0, unacknowledged: 0 },
      reversed:  summary['reversed']  ?? { total: 0, unacknowledged: 0 },
    },
  })
})

// POST /api/gl/events/:id/acknowledge — mark a failed event as acknowledged
events.post('/:id/acknowledge', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid id' }, 400)

  const row = await c.env.DB.prepare(
    `SELECT id, status FROM business_events WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).first<{ id: number; status: string }>()

  if (!row) return c.json({ success: false, error: 'الحدث غير موجود' }, 404)
  if (row.status !== 'error') return c.json({ success: false, error: 'يمكن الإقرار بالأخطاء فقط' }, 400)

  await c.env.DB.prepare(
    `UPDATE business_events
     SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = datetime('now')
     WHERE id = ? AND company_id = ?`
  ).bind(userId, id, company_id).run()

  return c.json({ success: true })
})

// POST /api/gl/events/:id/unacknowledge — revert acknowledgement
events.post('/:id/unacknowledge', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid id' }, 400)

  const row = await c.env.DB.prepare(
    `SELECT id FROM business_events WHERE id = ? AND company_id = ? AND status = 'error'`
  ).bind(id, company_id).first()

  if (!row) return c.json({ success: false, error: 'الحدث غير موجود' }, 404)

  await c.env.DB.prepare(
    `UPDATE business_events
     SET acknowledged = 0, acknowledged_by = NULL, acknowledged_at = NULL
     WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).run()

  return c.json({ success: true })
})

export default events
