import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard } from '../middleware/auth'
import { FinanceCore } from '../lib/finance_core'
import { logAudit } from '../lib/audit'
import { resolveControlAccount } from '../lib/posting_engine'
import { getOpenPeriod } from '../lib/gl'
import { enforceDataQualityPolicy } from '../lib/data_quality'

import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

function userMsg(err: { message?: string }): string {
  return (err.message ?? 'حدث خطأ').replace(/^[A-Z_]+:\s*/, '')
}

const treasury = new Hono<{ Bindings: Env }>()
treasury.use('*', authMiddleware)
// RBAC: Treasury posting and partner cash operations are finance-restricted.
treasury.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

async function ensureActiveCenterCode(db: Env['DB'], company_id: number, center_code: number): Promise<boolean> {
  const row = await db.prepare(
    'SELECT 1 AS ok FROM cost_centers WHERE company_id = ? AND CAST(code AS INTEGER) = ? AND is_active = 1 LIMIT 1'
  ).bind(company_id, center_code).first<{ ok: number }>()
  return !!row?.ok
}

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
  expense_code: z.union([z.string(), z.number()]).optional().nullable().transform(v => v == null ? null : String(v)),
  document_type: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  unit_price: z.number().optional().nullable(),
  financial_account_id: z.number().optional().nullable(),
  partner_id: z.number().optional().nullable(),
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
  const accountId = c.req.query('account_id')
  const partnerId = c.req.query('partner_id')
  const offset    = (page - 1) * size

  const supplierCode = c.req.query('supplier_code')

  // Build filter clause (without leading company_id — added explicitly in each query)
  let filters = ''
  const filterBinds: unknown[] = []

  if (direction)    { filters += ' AND ct.direction = ?';             filterBinds.push(direction) }
  if (seasonId)     { filters += ' AND ct.season_id = ?';             filterBinds.push(seasonId) }
  if (status)       { filters += ' AND ct.status = ?';               filterBinds.push(status) }
  if (month)        { filters += ' AND ct.month = ?';                filterBinds.push(Number(month)) }
  if (year)         { filters += ' AND ct.year = ?';                 filterBinds.push(Number(year)) }
  if (accountId)    { filters += ' AND ct.financial_account_id = ?'; filterBinds.push(Number(accountId)) }
  if (partnerId)    { filters += ' AND ct.partner_id = ?';           filterBinds.push(Number(partnerId)) }
  if (supplierCode) { filters += ' AND ct.supplier_code = ?';        filterBinds.push(Number(supplierCode)) }
  if (search)       {
    filters += ' AND (ct.narration LIKE ? OR ct.recipient_name LIKE ? OR s.name LIKE ?)'
    const like = `%${search}%`
    filterBinds.push(like, like, like)
  }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ct.id, ct.transaction_date, ct.direction, ct.document_number, ct.recipient_name,
              ct.narration, ct.amount, ct.debit, ct.credit, ct.running_balance, ct.year, ct.month,
              ct.notes, ct.status, ct.field_id, ct.center_code, ct.season_id, ct.document_type,
              ct.financial_account_id, ct.partner_id, ct.journal_entry_id,
              ct.supplier_code, ct.expense_code,
              s.name  AS supplier_name,
              et.name AS expense_name
       FROM cash_transactions ct
       LEFT JOIN suppliers     s  ON s.code  = ct.supplier_code AND s.company_id = ct.company_id
       LEFT JOIN expense_types et ON et.code = ct.expense_code  AND et.company_id = ct.company_id
       WHERE ct.company_id = ? ${filters}
       ORDER BY ct.transaction_date ASC, ct.id ASC LIMIT ? OFFSET ?`
    ).bind(company_id, ...filterBinds, size, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cash_transactions ct
       LEFT JOIN suppliers s ON s.code = ct.supplier_code AND s.company_id = ct.company_id
       WHERE ct.company_id = ? ${filters}`
    ).bind(company_id, ...filterBinds).first<{ n: number }>(),
  ])

  // Keep backward-compat binds alias for other queries below
  const binds = [company_id, ...filterBinds]
  void binds // suppresses unused warning — used implicitly in count query above

  return c.json({
    success: true, data: rows.results,
    total: cnt?.n ?? 0, page, page_size: size,
    has_more: offset + size < (cnt?.n ?? 0),
  })
})

// GET /api/treasury/balance
treasury.get('/balance', async (c) => {
  const { company_id } = getUser(c)
  const accountId = c.req.query('account_id')

  let where = 'WHERE company_id = ? AND status = "posted"'
  const binds: any[] = [company_id]

  if (accountId) {
    where += ' AND financial_account_id = ?'
    binds.push(Number(accountId))
  }

  const row = await c.env.DB
    .prepare(`SELECT running_balance FROM cash_transactions
              ${where}
              ORDER BY transaction_date DESC, id DESC LIMIT 1`)
    .bind(...binds).first<{ running_balance: number }>()

  return c.json({ success: true, data: { balance: row?.running_balance ?? 0 } })
})

// POST /api/treasury/transactions
treasury.post('/transactions', zValidator('json', transactionSchema), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = c.req.valid('json')

  if (b.status === 'posted') {
    const gate = await enforceDataQualityPolicy(c.env.DB, company_id, { mode: 'posted', module: 'treasury' })
    if (!gate.ok) {
      return c.json({ success: false, error: gate.error, code: gate.code, details: gate.details }, gate.status ?? 409)
    }
  }

  if (b.status === 'posted' && (b.season_id == null || b.center_code == null)) {
    return c.json({ success: false, error: 'الموسم ومركز التكلفة مطلوبان عند الترحيل' }, 422)
  }
  if (b.status === 'posted' && b.center_code != null) {
    const validCenter = await ensureActiveCenterCode(c.env.DB, company_id, b.center_code)
    if (!validCenter) {
      return c.json({ success: false, error: 'مركز التكلفة غير صالح أو غير نشط' }, 422)
    }
  }
  // Outflow without supplier/partner linkage must specify an expense_code for proper GL classification
  if (b.status === 'posted' && b.direction === 'م' && b.supplier_code == null && b.partner_id == null && b.expense_code == null) {
    return c.json({ success: false, error: 'بند المصروف مطلوب للصرف بدون مورد أو شريك' }, 422)
  }

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
      document_type: b.document_type,
      financial_account_id: b.financial_account_id,
      partner_id: b.partner_id,
    })

    return c.json({ success: true, data: { running_balance: balance, id: txnId } }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: userMsg(err) }, 400)
  }
})

 treasury.patch('/transactions/:id/post', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const gate = await enforceDataQualityPolicy(c.env.DB, company_id, { mode: 'posted', module: 'treasury' })
  if (!gate.ok) {
    return c.json({ success: false, error: gate.error, code: gate.code, details: gate.details }, gate.status ?? 409)
  }

  const draft = await c.env.DB.prepare(
    'SELECT season_id, center_code FROM cash_transactions WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ season_id: number | null; center_code: number | null }>()

  if (!draft) return c.json({ success: false, error: 'الحركة غير موجودة' }, 404)
  if (draft.season_id == null || draft.center_code == null) {
    return c.json({ success: false, error: 'الموسم ومركز التكلفة مطلوبان عند الترحيل' }, 422)
  }
  const validCenter = await ensureActiveCenterCode(c.env.DB, company_id, draft.center_code)
  if (!validCenter) {
    return c.json({ success: false, error: 'مركز التكلفة غير صالح أو غير نشط' }, 422)
  }

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
    return c.json({ success: false, error: userMsg(err) }, 400)
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
  const b = await c.req.json<{
    name: string
    capital_paid?: number
    current_acct?: number
    transaction_date?: string
    season_id?: number
    center_code?: number
  }>()
  if (!b.name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)

  const capitalPaid = b.capital_paid ?? 0
  const currentAcct = b.current_acct ?? 0
  const txDate = b.transaction_date ?? new Date().toISOString().slice(0, 10)

  if (capitalPaid > 0) {
    if (b.season_id == null || b.center_code == null) {
      return c.json({
        success: false,
        error: 'الموسم ومركز التكلفة مطلوبان عند إدخال رأس مال مرحّل'
      }, 422)
    }

    const validCenter = await ensureActiveCenterCode(c.env.DB, company_id, b.center_code)
    if (!validCenter) {
      return c.json({ success: false, error: 'مركز التكلفة غير صالح أو غير نشط' }, 422)
    }

    const periodId = await getOpenPeriod(c.env.DB, company_id, txDate)
    if (!periodId) {
      return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${txDate}` }, 400)
    }
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO partners (company_id, name, capital_paid, current_acct) VALUES (?,?,?,?)'
  ).bind(company_id, b.name.trim(), capitalPaid, currentAcct).run()

  const newId = result.meta.last_row_id as number

  // GL entry for initial capital if > 0
  if (capitalPaid > 0) {
    let equityCode: string | null = null
    let cashCode: string | null = null
    try {
      equityCode = await resolveControlAccount(c.env.DB, company_id, 'equity')
      cashCode = await resolveControlAccount(c.env.DB, company_id, 'cash')
    } catch {
      // If control mapping is not ready yet, keep partner creation successful and skip auto-posting.
    }

    if (equityCode && cashCode) {
      // Record Cash Movement (which also handles GL entry)
      await FinanceCore.recordCashMovement(c.env.DB, {
        company_id, userId,
        transaction_date: txDate,
        direction: 'د',
        amount: capitalPaid,
        narration: `إضافة رأس مال شريك: ${b.name.trim()}`,
        season_id: b.season_id,
        center_code: b.center_code,
        status: 'posted',
        contraAccount: equityCode // link to equity instead of revenue
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
  const b  = await c.req.json<{
    name?: string
    capital_paid?: number
    current_acct?: number
    transaction_date?: string
  }>()

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
  const txDate = b.transaction_date ?? new Date().toISOString().slice(0, 10)
  const partnerName = b.name?.trim() ?? current.name
  const hasCapitalDelta = b.capital_paid !== undefined && Math.abs(b.capital_paid - (current.capital_paid ?? 0)) > 0.01
  const hasCurrentDelta = b.current_acct !== undefined && Math.abs(b.current_acct - (current.current_acct ?? 0)) > 0.01

  if (hasCapitalDelta || hasCurrentDelta) {
    const periodId = await getOpenPeriod(c.env.DB, company_id, txDate)
    if (!periodId) {
      return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${txDate}` }, 400)
    }
  }

  if (b.capital_paid !== undefined) {
      const delta = b.capital_paid - (current.capital_paid ?? 0)
      if (Math.abs(delta) > 0.01) {
        const desc = delta > 0
          ? `زيادة رأس مال شريك: ${partnerName}`
          : `تخفيض رأس مال شريك: ${partnerName}`

        await FinanceCore.resolvePartnerCapital(c.env.DB, {
          company_id, ref_id: id, partner_id: id,
          amount: Math.abs(delta),
          direction: delta > 0 ? 'injection' : 'withdrawal',
          date: txDate, description: desc, created_by: userId,
        })
      }
    }

    if (b.current_acct !== undefined) {
      const delta = b.current_acct - (current.current_acct ?? 0)
      if (Math.abs(delta) > 0.01) {
        const desc = delta > 0
          ? `إيداع في حساب شريك جاري: ${partnerName}`
          : `سحب من حساب شريك جاري: ${partnerName}`

        await FinanceCore.resolvePartnerCurrent(c.env.DB, {
          company_id, ref_id: id, partner_id: id,
          amount: Math.abs(delta),
          direction: delta > 0 ? 'deposit' : 'withdrawal',
          date: txDate, description: desc, created_by: userId,
        })
      }
    }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'partners', record_id: id, new_value: b,
  })

  return c.json({ success: true, data: null })
})

export default treasury

