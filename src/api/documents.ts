import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { logAudit } from '../lib/audit'

const docs = new Hono<{ Bindings: Env }>()
docs.use('*', authMiddleware)

// ── Types ─────────────────────────────────────────────────────
const ALLOWED_TYPES = [
  'commercial_reg', 'trade_license', 'safety_cert', 'civil_defense',
  'employee_contract', 'insurance', 'vehicle_license', 'other',
]
const ALLOWED_STATUS = ['active', 'expired', 'renewed', 'cancelled']
const ALLOWED_REF    = ['employees', 'suppliers', 'companies', 'fields', 'branches']

// ─────────────────────────────────────────────────────────────
// GET /documents  — list with optional filters
// ─────────────────────────────────────────────────────────────
docs.get('/', async (c) => {
  const { company_id } = getUser(c)
  const { doc_type, status, ref_table, ref_id, expiring_days } = c.req.query()

  const where: string[] = ['d.company_id = ?']
  const params: unknown[] = [company_id]

  if (doc_type)   { where.push('d.doc_type = ?');   params.push(doc_type) }
  if (status)     { where.push('d.status = ?');     params.push(status) }
  if (ref_table)  { where.push('d.ref_table = ?');  params.push(ref_table) }
  if (ref_id)     { where.push('d.ref_id = ?');     params.push(Number(ref_id)) }

  if (expiring_days) {
    const days = Number(expiring_days)
    where.push(`d.expiry_date IS NOT NULL AND d.expiry_date <= date('now', '+${days} days') AND d.expiry_date >= date('now')`)
  }

  const sql = `
    SELECT d.*,
           u.full_name  AS responsible_name,
           cb.full_name AS created_by_name
    FROM   documents d
    LEFT JOIN users u  ON u.id  = d.responsible_user_id
    LEFT JOIN users cb ON cb.id = d.created_by
    WHERE  ${where.join(' AND ')}
    ORDER  BY d.expiry_date ASC NULLS LAST, d.created_at DESC
  `
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

// ─────────────────────────────────────────────────────────────
// GET /documents/alerts  — documents expiring in next 30 days
// ─────────────────────────────────────────────────────────────
docs.get('/alerts', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(`
    SELECT d.id, d.title, d.doc_type, d.expiry_date, d.ref_table, d.ref_id,
           u.full_name AS responsible_name,
           CAST(julianday(d.expiry_date) - julianday('now') AS INTEGER) AS days_remaining
    FROM   documents d
    LEFT JOIN users u ON u.id = d.responsible_user_id
    WHERE  d.company_id = ?
      AND  d.status = 'active'
      AND  d.expiry_date IS NOT NULL
      AND  d.expiry_date <= date('now', '+60 days')
    ORDER  BY d.expiry_date ASC
  `).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// ─────────────────────────────────────────────────────────────
// GET /documents/:id
// ─────────────────────────────────────────────────────────────
docs.get('/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare(`
    SELECT d.*,
           u.full_name  AS responsible_name,
           cb.full_name AS created_by_name
    FROM   documents d
    LEFT JOIN users u  ON u.id  = d.responsible_user_id
    LEFT JOIN users cb ON cb.id = d.created_by
    WHERE  d.id = ? AND d.company_id = ?
  `).bind(id, company_id).first()
  if (!row) return c.json({ success: false, error: 'المستند غير موجود' }, 404)
  return c.json({ success: true, data: row })
})

// ─────────────────────────────────────────────────────────────
// POST /documents  — create
// ─────────────────────────────────────────────────────────────
docs.post('/', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    title: string; doc_type: string; ref_table?: string; ref_id?: number
    issue_date?: string; expiry_date?: string; responsible_user_id?: number
    file_name?: string; file_size_kb?: number; notes?: string
  }>()

  if (!b.title?.trim()) return c.json({ success: false, error: 'العنوان مطلوب' }, 400)
  if (!ALLOWED_TYPES.includes(b.doc_type)) return c.json({ success: false, error: 'نوع المستند غير صحيح' }, 400)
  if (b.ref_table && !ALLOWED_REF.includes(b.ref_table)) return c.json({ success: false, error: 'ref_table غير صحيح' }, 400)

  const r = await c.env.DB.prepare(`
    INSERT INTO documents
      (company_id, title, doc_type, ref_table, ref_id, issue_date, expiry_date,
       responsible_user_id, file_name, file_size_kb, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    company_id, b.title.trim(), b.doc_type,
    b.ref_table ?? null, b.ref_id ?? null,
    b.issue_date ?? null, b.expiry_date ?? null,
    b.responsible_user_id ?? null,
    b.file_name ?? null, b.file_size_kb ?? null,
    b.notes ?? null, userId,
  ).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'documents', record_id: r.meta.last_row_id })
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

// ─────────────────────────────────────────────────────────────
// PATCH /documents/:id  — update fields
// ─────────────────────────────────────────────────────────────
docs.patch('/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<Record<string, unknown>>()

  const allowed = [
    'title', 'doc_type', 'ref_table', 'ref_id',
    'issue_date', 'expiry_date', 'responsible_user_id',
    'file_name', 'file_size_kb', 'status', 'notes',
  ]
  const cols = Object.keys(b).filter(k => allowed.includes(k))
  if (!cols.length) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)
  if (b.doc_type && !ALLOWED_TYPES.includes(b.doc_type as string)) return c.json({ success: false, error: 'نوع المستند غير صحيح' }, 400)
  if (b.status   && !ALLOWED_STATUS.includes(b.status as string)) return c.json({ success: false, error: 'الحالة غير صحيحة' }, 400)

  cols.push('updated_at')
  const vals = [...cols.slice(0, -1).map(f => b[f]), new Date().toISOString(), id, company_id]

  await c.env.DB.prepare(
    `UPDATE documents SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...vals).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'documents', record_id: id })
  return c.json({ success: true, data: null })
})

// ─────────────────────────────────────────────────────────────
// DELETE /documents/:id
// ─────────────────────────────────────────────────────────────
docs.delete('/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare(
    'SELECT id FROM documents WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first()
  if (!row) return c.json({ success: false, error: 'المستند غير موجود' }, 404)
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ? AND company_id = ?').bind(id, company_id).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'DELETE', table_name: 'documents', record_id: id })
  return c.json({ success: true, data: null })
})

// ─────────────────────────────────────────────────────────────
// PATCH /documents/:id/renew  — set status=renewed + new dates
// ─────────────────────────────────────────────────────────────
docs.patch('/:id/renew', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { issue_date, expiry_date } = await c.req.json<{ issue_date?: string; expiry_date?: string }>()

  await c.env.DB.prepare(`
    UPDATE documents
    SET status = 'renewed', issue_date = ?, expiry_date = ?, updated_at = datetime('now')
    WHERE id = ? AND company_id = ?
  `).bind(issue_date ?? null, expiry_date ?? null, id, company_id).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'documents', record_id: id })
  return c.json({ success: true, data: null })
})

export default docs
