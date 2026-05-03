import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard, permissionGuard } from '../middleware/auth'
import { getOpenPeriod } from '../lib/gl'
import { logAudit } from '../lib/audit'
import { FinanceCore } from '../lib/finance_core'
import { resolveControlAccount } from '../lib/posting_engine'

const suppliers = new Hono<{ Bindings: Env }>()
suppliers.use('*', authMiddleware)

// Write operations (POST/PATCH) are finance-role-only.
// Read operations use DB-driven permissionGuard so any role with suppliers.read can view.
const financeOnly = roleGuard(['super_admin', 'company_admin', 'accountant'])

// GET /api/suppliers?page=1&size=50&q=search
suppliers.get('/', permissionGuard('suppliers', 'read'), async (c) => {
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
              COALESCE(SUM(st.credit), 0) - COALESCE(SUM(st.debit), 0) AS current_balance
       FROM suppliers s
       LEFT JOIN supplier_transactions st ON st.supplier_code = s.code AND st.company_id = s.company_id
       WHERE s.company_id = ? ${where}
       GROUP BY s.code
       ORDER BY ABS(current_balance) DESC
       LIMIT ? OFFSET ?`
    ).bind(...params, size, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM suppliers s WHERE s.company_id = ? ${where}`
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

// GET /api/suppliers/aging — 30/60/90+ day overdue analysis  (must be before /:code)
suppliers.get('/aging', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') ?? new Date().toISOString().slice(0, 10)

  const { results } = await c.env.DB.prepare(
    `SELECT s.code, s.name, s.activity,
            COALESCE(SUM(t.credit), 0) - COALESCE(SUM(t.debit), 0) AS total_balance,
            COALESCE(SUM(CASE WHEN t.transaction_date >= date(?, '-30 days') AND t.transaction_date <= ? THEN t.credit - t.debit ELSE 0 END), 0) AS current_0_30,
            COALESCE(SUM(CASE WHEN t.transaction_date >= date(?, '-60 days') AND t.transaction_date < date(?, '-30 days') THEN t.credit - t.debit ELSE 0 END), 0) AS aged_31_60,
            COALESCE(SUM(CASE WHEN t.transaction_date >= date(?, '-90 days') AND t.transaction_date < date(?, '-60 days') THEN t.credit - t.debit ELSE 0 END), 0) AS aged_61_90,
            COALESCE(SUM(CASE WHEN t.transaction_date < date(?, '-90 days') THEN t.credit - t.debit ELSE 0 END), 0) AS aged_90_plus
     FROM suppliers s
     LEFT JOIN supplier_transactions t ON t.supplier_code = s.code AND t.company_id = s.company_id
                                          AND t.transaction_date <= ?
     WHERE s.company_id = ? AND s.is_active = 1
     GROUP BY s.code, s.name, s.activity
     HAVING total_balance <> 0
     ORDER BY total_balance DESC
    `
  ).bind(
    asOf, asOf,
    asOf, asOf,
    asOf, asOf,
    asOf,
    asOf, company_id,
  ).all()

  const totals = (results as Record<string, number>[]).reduce(
    (acc, r) => ({
      total_balance: acc.total_balance + (r.total_balance ?? 0),
      current_0_30:  acc.current_0_30  + (r.current_0_30  ?? 0),
      aged_31_60:    acc.aged_31_60    + (r.aged_31_60    ?? 0),
      aged_61_90:    acc.aged_61_90    + (r.aged_61_90    ?? 0),
      aged_90_plus:  acc.aged_90_plus  + (r.aged_90_plus  ?? 0),
    }),
    { total_balance: 0, current_0_30: 0, aged_31_60: 0, aged_61_90: 0, aged_90_plus: 0 },
  )

  return c.json({ success: true, data: { suppliers: results, totals, as_of: asOf } })
})

// GET /api/suppliers/:code/summary — Odoo-style smart-button aggregates
suppliers.get('/:code/summary', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))
  const apAccountCode = await resolveControlAccount(c.env.DB, company_id, 'accounts_payable')

  const [invoices, payments, glLedger] = await Promise.all([
    // All supplier transactions (invoices / credit notes)
    c.env.DB.prepare(`
      SELECT
        COUNT(*) AS total_count,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) AS draft_count,
        COUNT(CASE WHEN status = 'posted' THEN 1 END) AS posted_count,
        COALESCE(SUM(CASE WHEN status='posted' THEN credit ELSE 0 END), 0) AS total_credit,
        COALESCE(SUM(CASE WHEN status='posted' THEN debit  ELSE 0 END), 0) AS total_debit
      FROM supplier_transactions
      WHERE company_id = ? AND supplier_code = ?
    `).bind(company_id, code).first<{
      total_count: number; draft_count: number; posted_count: number
      total_credit: number; total_debit: number
    }>(),

    // Treasury payments to this supplier
    c.env.DB.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
      FROM cash_transactions
      WHERE company_id = ? AND supplier_code = ? AND direction = 'م' AND status = 'posted'
    `).bind(company_id, code).first<{ count: number; total: number }>(),

    // GL Ledger balance (via journal_entry_lines on supplier account)
    c.env.DB.prepare(`
      SELECT
        COALESCE(SUM(l.debit), 0)  AS total_debit,
        COALESCE(SUM(l.credit), 0) AS total_credit
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id
      WHERE l.company_id = ? AND l.account_code = ? AND e.is_posted = 1
    `).bind(company_id, apAccountCode).first<{ total_debit: number; total_credit: number }>(),
  ])

  const openBalance = (invoices?.total_credit ?? 0) - (invoices?.total_debit ?? 0)

  return c.json({
    success: true,
    data: {
      invoices_count:  invoices?.total_count   ?? 0,
      draft_count:     invoices?.draft_count    ?? 0,
      posted_count:    invoices?.posted_count   ?? 0,
      total_credit:    invoices?.total_credit   ?? 0,
      total_debit:     invoices?.total_debit    ?? 0,
      open_balance:    openBalance,
      payments_count:  payments?.count          ?? 0,
      payments_total:  payments?.total          ?? 0,
      gl_debit:        glLedger?.total_debit    ?? 0,
      gl_credit:       glLedger?.total_credit   ?? 0,
    },
  })
})

// GET /api/suppliers/:code
suppliers.get('/:code', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))

  const supplier = await c.env.DB
    .prepare('SELECT * FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(code, company_id).first()

  if (!supplier) return c.json({ success: false, error: 'المورد غير موجود' }, 404)
  return c.json({ success: true, data: supplier })
})

// POST /api/suppliers
suppliers.post('/', financeOnly, async (c) => {
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
suppliers.patch('/:code', financeOnly, async (c) => {
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
suppliers.get('/:code/statement', permissionGuard('suppliers', 'read'), async (c) => {
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
              due_date, center_code, notes, year, month
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
suppliers.post('/:code/transactions', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const b    = await c.req.json<{
    transaction_date: string; entry_type: string; document_type?: string
    document_number?: number; expense_category?: string; equipment?: string
    unit?: string; quantity?: number; unit_price?: number; amount: number
    credit?: number; debit?: number; check_amount?: number; due_date?: string
    notes?: string; season_id?: number; center_code?: number; account_code?: number
    status?: 'draft' | 'posted'
  }>()

  if (!b.transaction_date || !b.entry_type || b.amount == null) {
    return c.json({ success: false, error: 'التاريخ ونوع القيد والمبلغ مطلوبة' }, 400)
  }

  const status = b.status ?? 'posted'

  if (status === 'posted' && (b.season_id == null || b.center_code == null)) {
    return c.json({ success: false, error: 'الموسم ومركز التكلفة مطلوبان عند الترحيل' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, b.transaction_date)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.transaction_date}` }, 400)
  }

  // Calculate running balance for supplier (balance_with_checks / balance_no_checks)
  const lastBalRow = await c.env.DB
    .prepare(`SELECT balance_with_checks, balance_no_checks FROM supplier_transactions
              WHERE company_id = ? AND supplier_code = ?
              ORDER BY transaction_date DESC, id DESC LIMIT 1`)
    .bind(company_id, code).first<{ balance_with_checks: number; balance_no_checks: number }>()

  const prevBalWithChecks = lastBalRow?.balance_with_checks ?? 0
  const prevBalNoChecks   = lastBalRow?.balance_no_checks   ?? 0
  const credit = b.credit ?? (b.entry_type === 'د' ? b.amount : 0)
  const debit  = b.debit  ?? (b.entry_type === 'م' ? b.amount : 0)
  const checkAmt = b.check_amount ?? 0
  const newBalNoChecks   = prevBalNoChecks   + credit - debit
  const newBalWithChecks = prevBalWithChecks + credit - debit + checkAmt

  const date = new Date(b.transaction_date)
  const result = await c.env.DB.prepare(
    `INSERT INTO supplier_transactions
     (company_id, season_id, supplier_code, account_code, center_code,
      transaction_date, entry_type, document_type, document_number,
      expense_category, equipment, unit, quantity, unit_price, amount,
      credit, debit, check_amount, balance_no_checks, balance_with_checks,
      due_date, notes, year, month, created_by_user_id, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.season_id ?? null, code, b.account_code ?? null, b.center_code ?? null,
    b.transaction_date, b.entry_type, b.document_type ?? null, b.document_number ?? null,
    b.expense_category ?? null, b.equipment ?? null, b.unit ?? null,
    b.quantity ?? null, b.unit_price ?? null, b.amount,
    credit, debit, checkAmt, newBalNoChecks, newBalWithChecks,
    b.due_date ?? null, b.notes ?? null,
    date.getFullYear(), date.getMonth() + 1, userId, status
  ).run()

  const txnId = result.meta.last_row_id

  // Auto-post GL entry only for 'posted' status
  if (status === 'posted') {
    try {
      const supplierRow = await c.env.DB
        .prepare('SELECT name FROM suppliers WHERE code = ? AND company_id = ?')
        .bind(code, company_id).first<{name:string}>()

      if (b.entry_type === 'د') {
        await FinanceCore.resolveSupplierInvoice(c.env.DB, {
          company_id,
          ref_id: txnId,
          amount: b.amount,
          date: b.transaction_date,
          description: `${b.expense_category ?? b.entry_type} — ${supplierRow?.name ?? code}`,
          created_by: userId,
          supplier_code: code
        })
      } else {
        await FinanceCore.resolveSupplierPayment(c.env.DB, {
          company_id,
          ref_id: txnId,
          amount: b.amount,
          date: b.transaction_date,
          description: `${b.expense_category ?? b.entry_type} — ${supplierRow?.name ?? code}`,
          created_by: userId,
          center_code: b.center_code ?? undefined,
          supplier_code: code,
        })
      }
    } catch (e: unknown) {
      await c.env.DB.prepare(
        "UPDATE supplier_transactions SET status = 'draft' WHERE id = ?"
      ).bind(txnId).run()
      const message = e instanceof Error ? e.message : 'خطأ غير معروف'
      return c.json({ 
        success: false, 
        error: `تم حفظ الفاتورة كمسودة، لكن فشل إنشاء القيد المحاسبي: ${message}` 
      }, 400)
    }
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'supplier_transactions', record_id: txnId,
    new_value: {
      entry_type: b.entry_type, supplier: code, amount: b.amount,
      date: b.transaction_date, doc: b.document_number, status,
    },
  })

  return c.json({ success: true, data: null }, 201)
})

// PATCH /api/suppliers/:code/transactions/:id/post — Approve and post a draft invoice
suppliers.patch('/:code/transactions/:id/post', financeOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const code = Number(c.req.param('code'))
  const id   = Number(c.req.param('id'))

  const txn = await c.env.DB
    .prepare(`SELECT id, entry_type, amount, transaction_date, expense_category, center_code, account_code
              FROM supplier_transactions WHERE id = ? AND company_id = ? AND status = 'draft'`)
    .bind(id, company_id).first<{
      id: number
      entry_type: string
      amount: number
      transaction_date: string
      expense_category: string | null
      center_code: number | null
      account_code: string | null
    }>()

  if (!txn) return c.json({ success: false, error: 'المسودة غير موجودة أو تم ترحيلها بالفعل' }, 404)

  try {
    const supplierRow = await c.env.DB
      .prepare('SELECT name FROM suppliers WHERE code = ? AND company_id = ?')
      .bind(code, company_id).first<{name:string}>()

    // 1. Post to GL
    if (txn.entry_type === 'د') {
      await FinanceCore.resolveSupplierInvoice(c.env.DB, {
        company_id,
        ref_id: id,
        amount: txn.amount,
        date: txn.transaction_date,
        description: `${txn.expense_category ?? txn.entry_type} — ${supplierRow?.name ?? code}`,
        created_by: userId,
        supplier_code: code
      })
    } else {
      await FinanceCore.resolveSupplierPayment(c.env.DB, {
        company_id,
        ref_id: id,
        amount: txn.amount,
        date: txn.transaction_date,
        description: `${txn.expense_category ?? txn.entry_type} — ${supplierRow?.name ?? code}`,
        created_by: userId,
        center_code: txn.center_code ?? undefined,
        supplier_code: code,
      })
    }

    // 2. Update status to posted
    await c.env.DB
      .prepare("UPDATE supplier_transactions SET status = 'posted' WHERE id = ?")
      .bind(id).run()

    void logAudit(c.env.DB, {
      user_id: userId, company_id, action: 'UPDATE',
      table_name: 'supplier_transactions', record_id: id,
      new_value: { status: 'posted' },
      source: 'governance_workflow'
    })

    return c.json({ success: true, data: null })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'خطأ غير معروف'
    return c.json({ success: false, error: `فشل ترحيل الحركة: ${message}` }, 400)
  }
})

export default suppliers
