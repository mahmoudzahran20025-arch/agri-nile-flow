import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

const auditApi = new Hono<{ Bindings: Env }>()
auditApi.use('*', authMiddleware)

// GET /api/audit?page=1&size=50&table=&action=&user_id=&company_id=
auditApi.get('/', async (c) => {
  const { company_id: jwtCompanyId, role } = getUser(c)

  // Only admins and accountants can view audit log
  if (!['super_admin', 'company_admin', 'accountant'].includes(role)) {
    return c.json({ success: false, error: 'غير مصرح' }, 403)
  }

  const page      = Math.max(1, Number(c.req.query('page')  ?? 1))
  const size      = Math.min(100, Math.max(10, Number(c.req.query('size') ?? 50)))
  const table     = c.req.query('table')
  const action    = c.req.query('action')
  const userId    = c.req.query('user_id')
  const start     = c.req.query('start')
  const end       = c.req.query('end')
  const targetCid = c.req.query('company_id') // Optional override for super_admin

  let where = 'WHERE 1=1'
  const params: unknown[] = []

  // Security: Restricted to own company unless super_admin
  if (role === 'super_admin') {
    if (targetCid && targetCid !== 'all') {
      where += ' AND al.company_id = ?'
      params.push(Number(targetCid))
    }
  } else {
    where += ' AND al.company_id = ?'
    params.push(jwtCompanyId)
  }

  if (table)  { where += ' AND al.table_name = ?'; params.push(table) }
  if (action) { where += ' AND al.action = ?';     params.push(action) }
  if (userId) { where += ' AND al.user_id = ?';    params.push(Number(userId)) }
  if (start)  { where += ' AND al.created_at >= ?'; params.push(start) }
  if (end)    { where += ' AND al.created_at <= ?'; params.push(end + ' 23:59:59') }

  const offset = (page - 1) * size

  const [{ total }] = (await c.env.DB
    .prepare(`SELECT COUNT(*) AS total FROM audit_log al ${where}`)
    .bind(...params).all()).results as [{ total: number }]

  const { results } = await c.env.DB.prepare(
    `SELECT al.id, al.action, al.table_name, al.record_id,
            al.old_value, al.new_value, al.source, al.created_at,
            al.company_id, co.name AS company_name,
            u.full_name AS user_name, u.email AS user_email
     FROM audit_log al
     LEFT JOIN users u ON u.id = al.user_id
     LEFT JOIN companies co ON co.id = al.company_id
     ${where}
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ? OFFSET ?`,
  ).bind(...params, size, offset).all()

  return c.json({
    success: true,
    data: results,
    total,
    page,
    page_size: size,
    has_more: offset + size < total,
  })
})

// GET /api/audit/errors — System Error Logs
auditApi.get('/errors', async (c) => {
  const { company_id: jwtCompanyId, role } = getUser(c)
  if (!['super_admin', 'company_admin'].includes(role)) {
    return c.json({ success: false, error: 'غير مصرح' }, 403)
  }

  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const size = Math.min(50, Number(c.req.query('size') ?? 20))
  const targetCid = c.req.query('company_id')

  let where = 'WHERE 1=1'
  const params: unknown[] = []

  if (role === 'super_admin') {
    if (targetCid && targetCid !== 'all') {
      where += ' AND company_id = ?'
      params.push(Number(targetCid))
    }
  } else {
    where += ' AND company_id = ?'
    params.push(jwtCompanyId)
  }

  const offset = (page - 1) * size
  const [{ total }] = (await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM system_error_logs ${where}`).bind(...params).all()).results as [{ total: number }]

  const { results } = await c.env.DB.prepare(`
    SELECT e.*, u.full_name AS user_name, co.name AS company_name
    FROM system_error_logs e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN companies co ON co.id = e.company_id
    ${where}
    ORDER BY e.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, size, offset).all()

  return c.json({
    success: true,
    data: results, total, page, page_size: size, has_more: offset + size < total
  })
})

// GET /api/audit/stats — summary counts per action/table
auditApi.get('/stats', async (c) => {
  const { company_id, role } = getUser(c)
  if (!['super_admin', 'company_admin', 'accountant'].includes(role)) {
    return c.json({ success: false, error: 'غير مصرح' }, 403)
  }

  const { results: byAction } = await c.env.DB.prepare(
    `SELECT action, COUNT(*) AS cnt FROM audit_log WHERE company_id = ? GROUP BY action ORDER BY cnt DESC`,
  ).bind(company_id).all()

  const { results: byTable } = await c.env.DB.prepare(
    `SELECT table_name, COUNT(*) AS cnt FROM audit_log WHERE company_id = ? GROUP BY table_name ORDER BY cnt DESC LIMIT 10`,
  ).bind(company_id).all()

  const { total } = (await c.env.DB
    .prepare(`SELECT COUNT(*) AS total FROM audit_log WHERE company_id = ?`)
    .bind(company_id).first<{ total: number }>()) ?? { total: 0 }

  return c.json({ success: true, data: { total, by_action: byAction, by_table: byTable } })
})

export default auditApi
