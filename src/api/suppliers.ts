import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

const suppliers = new Hono<{ Bindings: Env }>()
suppliers.use('*', authMiddleware)

// GET /api/suppliers?page=1&size=50&q=search
suppliers.get('/', async (c) => {
  const { company_id } = getUser(c)
  const page   = Math.max(1, Number(c.req.query('page') ?? 1))
  const size   = Math.min(100, Number(c.req.query('size') ?? 50))
  const q      = c.req.query('q') ?? ''
  const offset = (page - 1) * size

  const where  = q ? 'AND (s.name LIKE ? OR CAST(s.code AS TEXT) LIKE ?)' : ''
  const params = q ? [company_id, `%${q}%`, `%${q}%`] : [company_id]

  const [rowsResult, countResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.code, s.name, s.activity, s.is_active,
              COALESCE(SUM(st.credit), 0) AS total_credit,
              COALESCE(SUM(st.debit),  0) AS total_debit,
              COALESCE(MAX(st.balance_with_checks), 0) AS current_balance
       FROM suppliers s
       LEFT JOIN supplier_transactions st ON st.supplier_code = s.code AND st.company_id = s.company_id
       WHERE s.company_id = ? ${where}
       GROUP BY s.code
       ORDER BY ABS(current_balance) DESC
       LIMIT ? OFFSET ?`
    ).bind(...params, size, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM suppliers WHERE company_id = ? ${where}`
    ).bind(...params).first<{ total: number }>(),
  ])

  return c.json({
    success: true,
    data:     rowsResult.results,
    total:    countResult?.total ?? 0,
    page,
    page_size: size,
    has_more: offset + size < (countResult?.total ?? 0),
  })
})

// GET /api/suppliers/:code
suppliers.get('/:code', async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))

  const supplier = await c.env.DB
    .prepare('SELECT * FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(code, company_id).first()

  if (!supplier) return c.json({ success: false, error: 'المورد غير موجود' }, 404)
  return c.json({ success: true, data: supplier })
})

// POST /api/suppliers
suppliers.post('/', async (c) => {
  const { company_id } = getUser(c)
  const body = await c.req.json<{ code: number; name: string; activity?: string; notes?: string }>()

  if (!body.code || !body.name) {
    return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)
  }

  const exists = await c.env.DB
    .prepare('SELECT 1 FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(body.code, company_id).first()

  if (exists) return c.json({ success: false, error: 'الكود مستخدم بالفعل' }, 409)

  await c.env.DB
    .prepare('INSERT INTO suppliers (code, company_id, name, activity, notes) VALUES (?, ?, ?, ?, ?)')
    .bind(body.code, company_id, body.name, body.activity ?? null, body.notes ?? null).run()

  return c.json({ success: true, data: { code: body.code } }, 201)
})

// PATCH /api/suppliers/:code
suppliers.patch('/:code', async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))
  const body = await c.req.json<{ name?: string; activity?: string; notes?: string; is_active?: number }>()

  const fields: string[] = []
  const values: unknown[] = []

  if (body.name     !== undefined) { fields.push('name = ?');      values.push(body.name) }
  if (body.activity !== undefined) { fields.push('activity = ?');  values.push(body.activity) }
  if (body.notes    !== undefined) { fields.push('notes = ?');     values.push(body.notes) }
  if (body.is_active !== undefined){ fields.push('is_active = ?'); values.push(body.is_active) }

  if (!fields.length) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)

  await c.env.DB
    .prepare(`UPDATE suppliers SET ${fields.join(', ')} WHERE code = ? AND company_id = ?`)
    .bind(...values, code, company_id).run()

  return c.json({ success: true, data: null })
})

// GET /api/suppliers/:code/statement?page=1&size=50&season_id=&month=
suppliers.get('/:code/statement', async (c) => {
  const { company_id } = getUser(c)
  const code     = Number(c.req.param('code'))
  const page     = Math.max(1, Number(c.req.query('page') ?? 1))
  const size     = Math.min(200, Number(c.req.query('size') ?? 100))
  const seasonId = c.req.query('season_id')
  const month    = c.req.query('month')
  const offset   = (page - 1) * size

  let where   = 'WHERE company_id = ? AND supplier_code = ?'
  const binds: unknown[] = [company_id, code]

  if (seasonId) { where += ' AND season_id = ?';  binds.push(seasonId) }
  if (month)    { where += ' AND month = ?';       binds.push(Number(month)) }

  const [rows, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, transaction_date, entry_type, document_type, document_number,
              expense_category, equipment, unit, quantity, unit_price, amount,
              credit, debit, check_amount, balance_no_checks, balance_with_checks,
              notes, year, month
       FROM supplier_transactions
       ${where}
       ORDER BY transaction_date ASC, id ASC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),

    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM supplier_transactions ${where}`)
      .bind(...binds).first<{ n: number }>(),
  ])

  return c.json({
    success: true, data: rows.results,
    total: total?.n ?? 0, page, page_size: size,
    has_more: offset + size < (total?.n ?? 0),
  })
})

// POST /api/suppliers/:code/transactions
suppliers.post('/:code/transactions', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const b    = await c.req.json<{
    transaction_date: string; entry_type: string; document_type?: string
    document_number?: number; expense_category?: string; equipment?: string
    unit?: string; quantity?: number; unit_price?: number; amount: number
    credit?: number; debit?: number; check_amount?: number; due_date?: string
    notes?: string; season_id?: number; center_code?: number; account_code?: number
  }>()

  if (!b.transaction_date || !b.entry_type || b.amount == null) {
    return c.json({ success: false, error: 'التاريخ ونوع القيد والمبلغ مطلوبة' }, 400)
  }

  const date = new Date(b.transaction_date)
  await c.env.DB.prepare(
    `INSERT INTO supplier_transactions
     (company_id, season_id, supplier_code, account_code, center_code,
      transaction_date, entry_type, document_type, document_number,
      expense_category, equipment, unit, quantity, unit_price, amount,
      credit, debit, check_amount, due_date, notes, year, month,
      created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.season_id ?? null, code, b.account_code ?? null, b.center_code ?? null,
    b.transaction_date, b.entry_type, b.document_type ?? null, b.document_number ?? null,
    b.expense_category ?? null, b.equipment ?? null, b.unit ?? null,
    b.quantity ?? null, b.unit_price ?? null, b.amount,
    b.credit ?? (b.entry_type === 'د' ? b.amount : 0),
    b.debit  ?? (b.entry_type === 'م' ? b.amount : 0),
    b.check_amount ?? 0, b.due_date ?? null, b.notes ?? null,
    date.getFullYear(), date.getMonth() + 1, userId
  ).run()

  return c.json({ success: true, data: null }, 201)
})

export default suppliers
