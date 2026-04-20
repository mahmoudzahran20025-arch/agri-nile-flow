import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

const treasury = new Hono<{ Bindings: Env }>()
treasury.use('*', authMiddleware)

// GET /api/treasury/transactions?page=&size=&direction=&season_id=&month=&year=
treasury.get('/transactions', async (c) => {
  const { company_id } = getUser(c)
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(200, Number(c.req.query('size') ?? 100))
  const direction = c.req.query('direction')
  const seasonId  = c.req.query('season_id')
  const month     = c.req.query('month')
  const year      = c.req.query('year')
  const offset    = (page - 1) * size

  let where   = 'WHERE company_id = ?'
  const binds: unknown[] = [company_id]

  if (direction) { where += ' AND direction = ?';  binds.push(direction) }
  if (seasonId)  { where += ' AND season_id = ?';  binds.push(seasonId) }
  if (month)     { where += ' AND month = ?';      binds.push(Number(month)) }
  if (year)      { where += ' AND year = ?';       binds.push(Number(year)) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, transaction_date, direction, document_number, recipient_name,
              narration, amount, debit, credit, running_balance, year, month, notes
       FROM cash_transactions ${where}
       ORDER BY transaction_date ASC, id ASC LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),

    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM cash_transactions ${where}`)
      .bind(...binds).first<{ n: number }>(),
  ])

  return c.json({
    success: true, data: rows.results,
    total: cnt?.n ?? 0, page, page_size: size,
    has_more: offset + size < (cnt?.n ?? 0),
  })
})

// GET /api/treasury/balance
treasury.get('/balance', async (c) => {
  const { company_id } = getUser(c)

  const row = await c.env.DB
    .prepare(`SELECT running_balance FROM cash_transactions
              WHERE company_id = ? ORDER BY transaction_date DESC, id DESC LIMIT 1`)
    .bind(company_id).first<{ running_balance: number }>()

  return c.json({ success: true, data: { balance: row?.running_balance ?? 0 } })
})

// POST /api/treasury/transactions
treasury.post('/transactions', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    transaction_date: string; direction: string; document_number?: number
    recipient_name?: string; narration: string; amount: number
    supplier_code?: number; expense_code?: number; notes?: string
    season_id?: number; unit?: string; quantity?: number; unit_price?: number
  }>()

  if (!b.transaction_date || !b.direction || !b.amount || !b.narration) {
    return c.json({ success: false, error: 'التاريخ والاتجاه والمبلغ والبيان مطلوبة' }, 400)
  }
  if (b.direction !== 'د' && b.direction !== 'م') {
    return c.json({ success: false, error: "الاتجاه يجب أن يكون 'د' أو 'م'" }, 400)
  }

  // Calculate running balance
  const lastRow = await c.env.DB
    .prepare(`SELECT running_balance FROM cash_transactions
              WHERE company_id = ? ORDER BY transaction_date DESC, id DESC LIMIT 1`)
    .bind(company_id).first<{ running_balance: number }>()

  const prevBalance   = lastRow?.running_balance ?? 0
  const runningBalance = b.direction === 'د'
    ? prevBalance + b.amount
    : prevBalance - b.amount

  const date = new Date(b.transaction_date)
  await c.env.DB.prepare(
    `INSERT INTO cash_transactions
     (company_id, season_id, supplier_code, expense_code, transaction_date,
      direction, document_number, recipient_name, narration, amount,
      debit, credit, running_balance, unit, quantity, unit_price,
      notes, year, month, created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.season_id ?? null, b.supplier_code ?? null, b.expense_code ?? null,
    b.transaction_date, b.direction, b.document_number ?? null,
    b.recipient_name ?? null, b.narration, b.amount,
    b.direction === 'م' ? b.amount : 0,
    b.direction === 'د' ? b.amount : 0,
    runningBalance, b.unit ?? null, b.quantity ?? null, b.unit_price ?? null,
    b.notes ?? null, date.getFullYear(), date.getMonth() + 1, userId
  ).run()

  return c.json({ success: true, data: { running_balance: runningBalance } }, 201)
})

// GET /api/treasury/supplier-payments?supplier_code=
treasury.get('/supplier-payments', async (c) => {
  const { company_id } = getUser(c)
  const supplierCode = c.req.query('supplier_code')

  const { results } = await c.env.DB.prepare(
    `SELECT ct.transaction_date, ct.narration, ct.amount,
            s.name AS supplier_name, ct.supplier_code
     FROM cash_transactions ct
     LEFT JOIN suppliers s ON s.code = ct.supplier_code AND s.company_id = ct.company_id
     WHERE ct.company_id = ? AND ct.direction = 'م'
       AND ct.supplier_code ${supplierCode ? '= ?' : 'IS NOT NULL'}
     ORDER BY ct.transaction_date DESC LIMIT 200`
  ).bind(...(supplierCode ? [company_id, supplierCode] : [company_id])).all()

  return c.json({ success: true, data: results })
})

// GET /api/treasury/partners
treasury.get('/partners', async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB
    .prepare('SELECT * FROM partners WHERE company_id = ? ORDER BY name')
    .bind(company_id).all()

  return c.json({ success: true, data: results })
})

export default treasury
