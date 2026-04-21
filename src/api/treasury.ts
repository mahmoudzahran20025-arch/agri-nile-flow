import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { glCashTransaction, getOpenPeriod } from '../lib/gl'
import { logAudit } from '../lib/audit'

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
  const search    = c.req.query('search')
  const offset    = (page - 1) * size

  let where   = 'WHERE company_id = ?'
  const binds: unknown[] = [company_id]

  if (direction) { where += ' AND direction = ?';  binds.push(direction) }
  if (seasonId)  { where += ' AND season_id = ?';  binds.push(seasonId) }
  if (month)     { where += ' AND month = ?';      binds.push(Number(month)) }
  if (year)      { where += ' AND year = ?';       binds.push(Number(year)) }
  if (search)    { where += ' AND (narration LIKE ? OR recipient_name LIKE ?)'; const like = `%${search}%`; binds.push(like, like) }

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

  // Validate open financial period
  const periodId = await getOpenPeriod(c.env.DB, company_id, b.transaction_date)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.transaction_date} — تحقق من إعدادات الفترات المالية` }, 400)
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

  const lastRowPost = await c.env.DB
    .prepare('SELECT id FROM cash_transactions WHERE company_id = ? ORDER BY id DESC LIMIT 1')
    .bind(company_id).first<{id:number}>()
  const txnId = lastRowPost?.id ?? 0

  // Auto-post GL entry + link back to cash_transaction
  const glEntryId = await glCashTransaction(c.env.DB, company_id, txnId,
    b.direction, b.amount, b.transaction_date, b.narration, userId)
  if (glEntryId) {
    await c.env.DB.prepare(
      'UPDATE cash_transactions SET journal_entry_id = ? WHERE id = ?'
    ).bind(glEntryId, txnId).run()
  }

  // Audit log
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'cash_transactions', record_id: txnId,
    new_value: { direction: b.direction, amount: b.amount, narration: b.narration, date: b.transaction_date },
  })

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

// POST /api/treasury/partners
treasury.post('/partners', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{ name: string; capital_paid?: number; current_acct?: number }>()
  if (!b.name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)

  const result = await c.env.DB.prepare(
    'INSERT INTO partners (company_id, name, capital_paid, current_acct) VALUES (?,?,?,?)'
  ).bind(company_id, b.name.trim(), b.capital_paid ?? 0, b.current_acct ?? 0).run()

  const newId = result.meta.last_row_id as number
  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'partners', record_id: newId,
    new_value: { name: b.name, capital_paid: b.capital_paid ?? 0 },
  })

  return c.json({ success: true, data: { id: newId } }, 201)
})

// PATCH /api/treasury/partners/:id
treasury.patch('/partners/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<{ name?: string; capital_paid?: number; current_acct?: number }>()

  const fields: string[] = []
  const values: unknown[] = []
  if (b.name        !== undefined) { fields.push('name = ?');         values.push(b.name.trim()) }
  if (b.capital_paid !== undefined) { fields.push('capital_paid = ?'); values.push(b.capital_paid) }
  if (b.current_acct !== undefined) { fields.push('current_acct = ?'); values.push(b.current_acct) }

  if (!fields.length) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)

  await c.env.DB
    .prepare(`UPDATE partners SET ${fields.join(', ')} WHERE id = ? AND company_id = ?`)
    .bind(...values, id, company_id).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'partners', record_id: id, new_value: b,
  })

  return c.json({ success: true, data: null })
})

export default treasury
