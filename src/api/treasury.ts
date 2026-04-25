import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard } from '../middleware/auth'
import { postAutoEntry } from '../lib/gl'
import { FinanceCore } from '../lib/finance_core'
import { logAudit } from '../lib/audit'

import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const treasury = new Hono<{ Bindings: Env }>()
treasury.use('*', authMiddleware)
// RBAC: Treasury posting and partner cash operations are finance-restricted.
treasury.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

const transactionSchema = z.object({
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD'),
  direction: z.enum(['د', 'م'], { message: "الاتجاه يجب أن يكون 'د' (دائن/وارد) أو 'م' (مدين/صادر)" }),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  narration: z.string().min(3, 'البيان يجب أن يكون 3 أحرف على الأقل'),
  recipient_name: z.string().optional().nullable(),
  document_number: z.number().optional().nullable(),
  supplier_code: z.number().optional().nullable(),
  center_code: z.number().optional().nullable(),
  field_id: z.number().optional().nullable(),
  season_id: z.number().optional().nullable(),
  status: z.enum(['draft', 'posted']).optional().default('posted'),
  notes: z.string().optional().nullable(),
  expense_code: z.number().optional().nullable(),
})

// GET /api/treasury/transactions?page=&size=&direction=&season_id=&month=&year=&status=
treasury.get('/transactions', async (c) => {
  const { company_id } = getUser(c)
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(200, Number(c.req.query('size') ?? 100))
  const direction = c.req.query('direction')
  const seasonId  = c.req.query('season_id')
  const status    = c.req.query('status')
  const month     = c.req.query('month')
  const year      = c.req.query('year')
  const search    = c.req.query('search')
  const offset    = (page - 1) * size

  let where   = 'WHERE company_id = ?'
  const binds: unknown[] = [company_id]

  if (direction) { where += ' AND direction = ?';  binds.push(direction) }
  if (seasonId)  { where += ' AND season_id = ?';  binds.push(seasonId) }
  if (status)    { where += ' AND status = ?';     binds.push(status) }
  if (month)     { where += ' AND month = ?';      binds.push(Number(month)) }
  if (year)      { where += ' AND year = ?';       binds.push(Number(year)) }
  if (search)    { where += ' AND (narration LIKE ? OR recipient_name LIKE ?)'; const like = `%${search}%`; binds.push(like, like) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, transaction_date, direction, document_number, recipient_name,
              narration, amount, debit, credit, running_balance, year, month, notes, status,
              field_id, center_code, season_id
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
              WHERE company_id = ? AND status = 'posted'
              ORDER BY transaction_date DESC, id DESC LIMIT 1`)
    .bind(company_id).first<{ running_balance: number }>()

  return c.json({ success: true, data: { balance: row?.running_balance ?? 0 } })
})

// POST /api/treasury/transactions
treasury.post('/transactions', zValidator('json', transactionSchema), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = c.req.valid('json')

  try {
    const { txnId, balance } = await FinanceCore.recordCashMovement(c.env.DB, {
      company_id, userId,
      transaction_date: b.transaction_date,
      direction: b.direction,
      amount: b.amount,
      narration: b.narration,
      recipient_name: b.recipient_name,
      document_number: b.document_number,
      supplier_code: b.supplier_code,
      center_code: b.center_code,
      field_id: b.field_id,
      season_id: b.season_id,
      expense_code: b.expense_code,
      notes: b.notes,
      status: b.status,
    })

    return c.json({ success: true, data: { running_balance: balance, id: txnId } }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
})

 treasury.patch('/transactions/:id/post', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  try {
    const result = await FinanceCore.postCashMovement(c.env.DB, company_id, id, userId)
    
    void logAudit(c.env.DB, {
      user_id: userId, company_id, action: 'UPDATE',
      table_name: 'cash_transactions', record_id: id,
      new_value: { status: 'posted' },
      source: 'governance_workflow'
    })

    return c.json({ success: true, data: result })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
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

  const capitalPaid = b.capital_paid ?? 0
  const currentAcct = b.current_acct ?? 0

  const result = await c.env.DB.prepare(
    'INSERT INTO partners (company_id, name, capital_paid, current_acct) VALUES (?,?,?,?)'
  ).bind(company_id, b.name.trim(), capitalPaid, currentAcct).run()

  const newId = result.meta.last_row_id as number

  // GL entry for initial capital if > 0
  if (capitalPaid > 0) {
    const today = new Date().toISOString().slice(0, 10)
    // Try to get equity account mapping, fallback to default
    const equityMapping = await c.env.DB
      .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'equity'")
      .bind(company_id).first<{ account_code: string }>()
    const cashMapping = await c.env.DB
      .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'")
      .bind(company_id).first<{ account_code: string }>()

    if (equityMapping && cashMapping) {
      // Record Cash Movement (which also handles GL entry)
      await FinanceCore.recordCashMovement(c.env.DB, {
        company_id, userId,
        transaction_date: today,
        direction: 'د',
        amount: capitalPaid,
        narration: `إضافة رأس مال شريك: ${b.name.trim()}`,
        contraAccount: equityMapping.account_code // link to equity instead of revenue
      })
    }
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'partners', record_id: newId,
    new_value: { name: b.name, capital_paid: capitalPaid },
  })

  return c.json({ success: true, data: { id: newId } }, 201)
})

// PATCH /api/treasury/partners/:id
treasury.patch('/partners/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<{ name?: string; capital_paid?: number; current_acct?: number }>()

  // Get current values BEFORE update for delta calculation
  const current = await c.env.DB
    .prepare('SELECT name, capital_paid, current_acct FROM partners WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ name: string; capital_paid: number; current_acct: number }>()
  if (!current) return c.json({ success: false, error: 'الشريك غير موجود' }, 404)

  const fields: string[] = []
  const values: unknown[] = []
  if (b.name        !== undefined) { fields.push('name = ?');         values.push(b.name.trim()) }
  if (b.capital_paid !== undefined) { fields.push('capital_paid = ?'); values.push(b.capital_paid) }
  if (b.current_acct !== undefined) { fields.push('current_acct = ?'); values.push(b.current_acct) }

  if (!fields.length) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)

  await c.env.DB
    .prepare(`UPDATE partners SET ${fields.join(', ')} WHERE id = ? AND company_id = ?`)
    .bind(...values, id, company_id).run()

  // GL entries for equity changes
  const today = new Date().toISOString().slice(0, 10)
  const partnerName = b.name?.trim() ?? current.name

  const equityMapping = await c.env.DB
    .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'equity'")
    .bind(company_id).first<{ account_code: string }>()
  const cashMapping = await c.env.DB
    .prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'")
    .bind(company_id).first<{ account_code: string }>()

  if (equityMapping && cashMapping) {
    // Capital change → DR/CR Cash vs Equity
    if (b.capital_paid !== undefined) {
      const delta = b.capital_paid - (current.capital_paid ?? 0)
      if (Math.abs(delta) > 0.01) {
        const desc = delta > 0
          ? `زيادة رأس مال شريك: ${partnerName}`
          : `تخفيض رأس مال شريك: ${partnerName}`
        const absDelta = Math.abs(delta)

        await postAutoEntry(c.env.DB, {
          company_id,
          entry_date:  today,
          description: desc,
          ref_type:    'partner_capital',
          ref_id:      id,
          lines: delta > 0
            ? [
                { account_code: cashMapping.account_code,   debit: absDelta, credit: 0,        description: desc },
                { account_code: equityMapping.account_code,  debit: 0,        credit: absDelta, description: desc },
              ]
            : [
                { account_code: equityMapping.account_code,  debit: absDelta, credit: 0,        description: desc },
                { account_code: cashMapping.account_code,   debit: 0,        credit: absDelta, description: desc },
              ],
          created_by: userId,
        })
      }
    }

    // Current account change → DR/CR Cash vs Partner Current Account
    if (b.current_acct !== undefined) {
      const delta = b.current_acct - (current.current_acct ?? 0)
      if (Math.abs(delta) > 0.01) {
        const desc = delta > 0
          ? `إيداع في حساب شريك جاري: ${partnerName}`
          : `سحب من حساب شريك جاري: ${partnerName}`
        const absDelta = Math.abs(delta)

        await postAutoEntry(c.env.DB, {
          company_id,
          entry_date:  today,
          description: desc,
          ref_type:    'partner_current',
          ref_id:      id,
          lines: delta > 0
            ? [
                { account_code: cashMapping.account_code,   debit: absDelta, credit: 0,        description: desc },
                { account_code: equityMapping.account_code,  debit: 0,        credit: absDelta, description: desc },
              ]
            : [
                { account_code: equityMapping.account_code,  debit: absDelta, credit: 0,        description: desc },
                { account_code: cashMapping.account_code,   debit: 0,        credit: absDelta, description: desc },
              ],
          created_by: userId,
        })
      }
    }
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'partners', record_id: id, new_value: b,
  })

  return c.json({ success: true, data: null })
})

export default treasury

