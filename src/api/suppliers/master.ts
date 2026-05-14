/**
 * suppliers/master.ts
 * ====================
 * Supplier master data CRUD + per-supplier read endpoints:
 *   GET    /               — paginated list with balance aggregates
 *   GET    /aging          — 30/60/90+ day balance aging (date-bucket view)
 *   GET    /drafts         — all draft transactions across suppliers
 *   GET    /:code          — single supplier record
 *   GET    /:code/summary  — Odoo-style smart-button aggregates
 *   GET    /:code/statement — paginated transaction statement
 *   GET    /:code/open-items — unmatched invoices with aging buckets
 *   POST   /               — create supplier (BPG required)
 *   PATCH  /:code          — update supplier
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard, permissionGuard } from '../../middleware/auth'
import { resolveControlAccount } from '../../lib/posting_engine'
import { getTodayIsoDate } from '../../lib/utils/date'

const master = new Hono<{ Bindings: Env }>()
master.use('*', authMiddleware)

const financeOnly = roleGuard(['super_admin', 'company_admin', 'accountant'])

// ── List ──────────────────────────────────────────────────────────────────────
master.get('/', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const page   = Math.max(1, Number(c.req.query('page') ?? 1))
  const size   = Math.min(100, Number(c.req.query('size') ?? 50))
  const q      = c.req.query('q') ?? ''
  const offset = (page - 1) * size

  const where  = q ? 'AND (s.name LIKE ? OR CAST(s.code AS TEXT) LIKE ?)' : ''
  const params = q ? [company_id, `%${q}%`, `%${q}%`] : [company_id]

  const [rowsResult, countResult, draftMeta] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.code, s.name, s.activity, s.is_active,
              COALESCE(tx_agg.total_credit, 0) AS total_credit,
              COALESCE(tx_agg.total_debit, 0)  AS total_debit,
              COALESCE(last_tx.balance_no_checks,   COALESCE(tx_agg.total_credit, 0) - COALESCE(tx_agg.total_debit, 0), 0) AS current_balance,
              COALESCE(last_tx.balance_with_checks, COALESCE(tx_agg.total_credit, 0) - COALESCE(tx_agg.total_debit, 0), 0) AS current_balance_with_checks
       FROM suppliers s
       LEFT JOIN (
         SELECT supplier_code,
                COALESCE(SUM(CASE WHEN status='posted' THEN credit ELSE 0 END),0) AS total_credit,
                COALESCE(SUM(CASE WHEN status='posted' THEN debit  ELSE 0 END),0) AS total_debit
         FROM supplier_transactions WHERE company_id = ? GROUP BY supplier_code
       ) tx_agg ON tx_agg.supplier_code = s.code
       LEFT JOIN (
         SELECT supplier_code, balance_no_checks, balance_with_checks
         FROM supplier_transactions
         WHERE company_id = ?
           AND id = (SELECT MAX(id) FROM supplier_transactions st2
                     WHERE st2.supplier_code = supplier_transactions.supplier_code
                       AND st2.company_id = supplier_transactions.company_id)
       ) last_tx ON last_tx.supplier_code = s.code
       WHERE s.company_id = ? ${where}
       ORDER BY ABS(COALESCE(last_tx.balance_no_checks, 0)) DESC
       LIMIT ? OFFSET ?`
    ).bind(company_id, company_id, ...params, size, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM suppliers s WHERE s.company_id = ? ${where}`
    ).bind(...params).first<{ total: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS draft_count, COUNT(DISTINCT supplier_code) AS suppliers_with_drafts
       FROM supplier_transactions WHERE company_id = ? AND status = 'draft'`
    ).bind(company_id).first<{ draft_count: number; suppliers_with_drafts: number }>(),
  ])

  return c.json({
    success: true,
    data:     rowsResult.results,
    total:    countResult?.total ?? 0,
    page,     page_size: size,
    has_more: offset + size < (countResult?.total ?? 0),
    meta: {
      draft_count:           draftMeta?.draft_count           ?? 0,
      suppliers_with_drafts: draftMeta?.suppliers_with_drafts ?? 0,
    },
  })
})

// ── Aging (must be before /:code) ─────────────────────────────────────────────
master.get('/aging', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const asOf = c.req.query('as_of') ?? getTodayIsoDate()

  const { results } = await c.env.DB.prepare(
    `SELECT s.code, s.name, s.activity,
            COALESCE(last_tx.balance_no_checks, 0) AS total_balance,
            COALESCE(SUM(CASE WHEN t.transaction_date >= date(?, '-30 days') AND t.transaction_date <= ? THEN t.credit - t.debit ELSE 0 END), 0) AS current_0_30,
            COALESCE(SUM(CASE WHEN t.transaction_date >= date(?, '-60 days') AND t.transaction_date < date(?, '-30 days') THEN t.credit - t.debit ELSE 0 END), 0) AS aged_31_60,
            COALESCE(SUM(CASE WHEN t.transaction_date >= date(?, '-90 days') AND t.transaction_date < date(?, '-60 days') THEN t.credit - t.debit ELSE 0 END), 0) AS aged_61_90,
            COALESCE(SUM(CASE WHEN t.transaction_date < date(?, '-90 days') THEN t.credit - t.debit ELSE 0 END), 0) AS aged_90_plus
     FROM suppliers s
     LEFT JOIN supplier_transactions t ON t.supplier_code = s.code AND t.company_id = s.company_id
                                       AND t.status = 'posted' AND t.transaction_date <= ?
     LEFT JOIN (
       SELECT supplier_code, balance_no_checks
       FROM supplier_transactions
       WHERE company_id = ? AND status = 'posted'
         AND id = (SELECT MAX(id) FROM supplier_transactions st2
                   WHERE st2.supplier_code = supplier_transactions.supplier_code
                     AND st2.company_id = supplier_transactions.company_id
                     AND st2.status = 'posted' AND st2.transaction_date <= ?)
     ) last_tx ON last_tx.supplier_code = s.code
     WHERE s.company_id = ? AND s.is_active = 1
     GROUP BY s.code, s.name, s.activity, last_tx.balance_no_checks
     HAVING total_balance <> 0
     ORDER BY total_balance DESC`
  ).bind(asOf, asOf, asOf, asOf, asOf, asOf, asOf, asOf, company_id, asOf, company_id).all()

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

// ── Drafts (must be before /:code) ────────────────────────────────────────────
master.get('/drafts', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.supplier_code, t.transaction_date, t.entry_type,
            t.document_type, t.document_number, t.expense_category,
            t.amount, t.credit, t.debit, t.notes, t.season_id,
            t.center_code, t.financial_account_id, t.created_at,
            s.name AS supplier_name, s.activity AS supplier_activity
     FROM supplier_transactions t
     JOIN suppliers s ON s.code = t.supplier_code AND s.company_id = t.company_id
     WHERE t.company_id = ? AND t.status = 'draft'
     ORDER BY t.transaction_date DESC, t.id DESC`
  ).bind(company_id).all()

  return c.json({ success: true, data: results })
})

// ── Single supplier ────────────────────────────────────────────────────────────
master.get('/:code', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))

  const supplier = await c.env.DB
    .prepare('SELECT * FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(code, company_id).first()

  if (!supplier) return c.json({ success: false, error: 'المورد غير موجود' }, 404)
  return c.json({ success: true, data: supplier })
})

// ── Smart-button summary ───────────────────────────────────────────────────────
master.get('/:code/summary', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))
  const apAccountCode = await resolveControlAccount(c.env.DB, company_id, 'accounts_payable')

  const [invoices, payments, glLedger] = await Promise.all([
    c.env.DB.prepare(`
      SELECT COUNT(*) AS total_count,
             COUNT(CASE WHEN status='draft'   THEN 1 END) AS draft_count,
             COUNT(CASE WHEN status='posted'  THEN 1 END) AS posted_count,
             COALESCE(SUM(CASE WHEN status='posted' THEN credit ELSE 0 END),0) AS total_credit,
             COALESCE(SUM(CASE WHEN status='posted' THEN debit  ELSE 0 END),0) AS total_debit
      FROM supplier_transactions WHERE company_id = ? AND supplier_code = ?
    `).bind(company_id, code).first<{
      total_count: number; draft_count: number; posted_count: number
      total_credit: number; total_debit: number
    }>(),

    c.env.DB.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
      FROM cash_transactions
      WHERE company_id = ? AND supplier_code = ? AND direction = 'م' AND status = 'posted'
    `).bind(company_id, code).first<{ count: number; total: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(l.debit),0) AS total_debit, COALESCE(SUM(l.credit),0) AS total_credit
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id
      JOIN supplier_transactions st ON st.journal_entry_id = e.id AND st.company_id = e.company_id
      WHERE l.company_id = ? AND l.account_code = ? AND e.is_posted = 1 AND st.supplier_code = ?
    `).bind(company_id, apAccountCode, code).first<{ total_debit: number; total_credit: number }>(),
  ])

  return c.json({
    success: true,
    data: {
      invoices_count: invoices?.total_count  ?? 0,
      draft_count:    invoices?.draft_count  ?? 0,
      posted_count:   invoices?.posted_count ?? 0,
      total_credit:   invoices?.total_credit ?? 0,
      total_debit:    invoices?.total_debit  ?? 0,
      open_balance:   (invoices?.total_credit ?? 0) - (invoices?.total_debit ?? 0),
      payments_count: payments?.count        ?? 0,
      payments_total: payments?.total        ?? 0,
      gl_debit:       glLedger?.total_debit  ?? 0,
      gl_credit:      glLedger?.total_credit ?? 0,
    },
  })
})

// ── Statement ─────────────────────────────────────────────────────────────────
master.get('/:code/statement', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const code     = Number(c.req.param('code'))
  const page     = Math.max(1, Number(c.req.query('page') ?? 1))
  const size     = Math.min(200, Number(c.req.query('size') ?? 100))
  const seasonId = c.req.query('season_id')
  const month    = c.req.query('month')
  const offset   = (page - 1) * size

  let where   = 'WHERE company_id = ? AND supplier_code = ?'
  const binds: unknown[] = [company_id, code]

  if (seasonId) { where += ' AND season_id = ?'; binds.push(seasonId) }
  if (month)    { where += ' AND month = ?';      binds.push(Number(month)) }

  const [rows, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, transaction_date, entry_type, document_type, document_number,
              expense_category, equipment, unit, quantity, unit_price, amount,
              credit, debit, check_amount, balance_no_checks, balance_with_checks,
              due_date, center_code, financial_account_id, equipment_type_id, equipment_usage_mode,
              notes, year, month, status, journal_entry_id
       FROM supplier_transactions ${where}
       ORDER BY transaction_date DESC, id DESC LIMIT ? OFFSET ?`
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

// ── Open items (unmatched invoices + aging) ───────────────────────────────────
master.get('/:code/open-items', permissionGuard('suppliers', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const supplierCode = Number(c.req.param('code'))
  const asOf = c.req.query('as_of') || getTodayIsoDate()

  const supplier = await c.env.DB.prepare(
    'SELECT code, name, bus_posting_group_code FROM suppliers WHERE company_id = ? AND code = ? LIMIT 1'
  ).bind(company_id, supplierCode).first<{ code: number; name: string; bus_posting_group_code: string | null }>()

  if (!supplier) return c.json({ success: false, error: 'المورد غير موجود' }, 404)

  const { results: openInvoices } = await c.env.DB.prepare(
    `SELECT id, transaction_date, due_date, document_number, invoice_ref, amount, credit, notes,
            CASE
              WHEN due_date IS NULL OR due_date >= ? THEN 'current'
              WHEN due_date >= date(?, '-30 days') THEN '1_30'
              WHEN due_date >= date(?, '-60 days') THEN '31_60'
              WHEN due_date >= date(?, '-90 days') THEN '61_90'
              ELSE '90_plus'
            END AS aging_bucket,
            CAST(julianday(?) - julianday(COALESCE(due_date, transaction_date)) AS INTEGER) AS days_overdue
     FROM supplier_transactions
     WHERE company_id = ? AND supplier_code = ?
       AND entry_type IN ('invoice', 'debit', 'مدين', 'فاتورة', 'د')
       AND (is_matched IS NULL OR is_matched = 0) AND credit > 0
     ORDER BY COALESCE(due_date, transaction_date) ASC`
  ).bind(asOf, asOf, asOf, asOf, asOf, company_id, supplierCode).all<{
    id: number; transaction_date: string; due_date: string | null
    document_number: number | null; invoice_ref: string | null
    amount: number; credit: number; notes: string | null
    aging_bucket: string; days_overdue: number
  }>()

  const buckets = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 }
  let totalOutstanding = 0
  for (const inv of openInvoices) {
    const amt = Math.round((inv.credit ?? inv.amount ?? 0) * 100) / 100
    totalOutstanding += amt
    const b = inv.aging_bucket as keyof typeof buckets
    if (b in buckets) buckets[b] += amt
  }

  const glBalance = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(jel.credit),0) - COALESCE(SUM(jel.debit),0) AS ap_balance
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
     JOIN chart_of_accounts coa ON coa.code = jel.account_code AND coa.company_id = jel.company_id
     WHERE jel.company_id = ? AND coa.account_type = 'liability'
       AND je.ref_type IN ('supplier_invoice','inventory_movement','purchase_receipt','business_event')
       AND je.is_posted = 1`
  ).bind(company_id).first<{ ap_balance: number }>()

  return c.json({
    success: true,
    data: {
      supplier: { code: supplier.code, name: supplier.name },
      as_of: asOf,
      open_invoices: openInvoices,
      aging_buckets: buckets,
      total_outstanding: Math.round(totalOutstanding * 100) / 100,
      gl_ap_balance: Math.round((glBalance?.ap_balance ?? 0) * 100) / 100,
    },
  })
})

// ── Create ─────────────────────────────────────────────────────────────────────
master.post('/', financeOnly, async (c) => {
  const { company_id } = getUser(c)
  const body = await c.req.json<{
    code: number; name: string; activity?: string; notes?: string
    phone?: string; email?: string; address?: string
    tax_number?: string; credit_limit?: number; payment_terms?: number
    supplier_type?: string; bus_posting_group_code?: string
  }>()

  if (!body.code || !body.name) return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)

  if (!body.bus_posting_group_code?.trim()) {
    return c.json({
      success: false,
      error: 'bus_posting_group_code مطلوب لتمكين الترحيل المحاسبي الصحيح. القيم المتاحة: AGRI-OP, LABOR, LOCAL, IMPORT',
    }, 400)
  }

  const bpgValid = await c.env.DB
    .prepare('SELECT 1 FROM posting_rules WHERE company_id = ? AND bus_posting_group_code = ? LIMIT 1')
    .bind(company_id, body.bus_posting_group_code).first()
  if (!bpgValid) {
    return c.json({ success: false, error: `مجموعة الترحيل "${body.bus_posting_group_code}" غير موجودة في قواعد الترحيل` }, 400)
  }

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ success: false, error: 'صيغة البريد الإلكتروني غير صحيحة' }, 400)
  }

  const exists = await c.env.DB
    .prepare('SELECT 1 FROM suppliers WHERE code = ? AND company_id = ?')
    .bind(body.code, company_id).first()
  if (exists) return c.json({ success: false, error: 'الكود مستخدم بالفعل' }, 409)

  await c.env.DB.prepare(
    `INSERT INTO suppliers (code, company_id, name, activity, notes, phone, email, address,
       tax_number, credit_limit, payment_terms, supplier_type, bus_posting_group_code)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    body.code, company_id, body.name,
    body.activity ?? null, body.notes ?? null,
    body.phone ?? null, body.email ?? null, body.address ?? null,
    body.tax_number ?? null, body.credit_limit ?? null,
    body.payment_terms ?? 30, body.supplier_type ?? 'supplier',
    body.bus_posting_group_code,
  ).run()

  return c.json({ success: true, data: { code: body.code } }, 201)
})

// ── Update ─────────────────────────────────────────────────────────────────────
master.patch('/:code', financeOnly, async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))
  const body = await c.req.json<{
    name?: string; activity?: string; notes?: string; is_active?: number
    phone?: string; email?: string; address?: string
    tax_number?: string; credit_limit?: number; payment_terms?: number
    supplier_type?: string; bus_posting_group_code?: string
  }>()

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ success: false, error: 'صيغة البريد الإلكتروني غير صحيحة' }, 400)
  }

  const fields: string[] = []
  const values: unknown[] = []

  if (body.name          !== undefined) { fields.push('name = ?');          values.push(body.name) }
  if (body.activity      !== undefined) { fields.push('activity = ?');      values.push(body.activity) }
  if (body.notes         !== undefined) { fields.push('notes = ?');         values.push(body.notes) }
  if (body.is_active     !== undefined) { fields.push('is_active = ?');     values.push(body.is_active) }
  if (body.phone         !== undefined) { fields.push('phone = ?');         values.push(body.phone) }
  if (body.email         !== undefined) { fields.push('email = ?');         values.push(body.email) }
  if (body.address       !== undefined) { fields.push('address = ?');       values.push(body.address) }
  if (body.tax_number    !== undefined) { fields.push('tax_number = ?');    values.push(body.tax_number) }
  if (body.credit_limit  !== undefined) { fields.push('credit_limit = ?');  values.push(body.credit_limit) }
  if (body.payment_terms !== undefined) { fields.push('payment_terms = ?'); values.push(body.payment_terms) }
  if (body.supplier_type !== undefined) { fields.push('supplier_type = ?'); values.push(body.supplier_type) }
  if (body.bus_posting_group_code !== undefined) {
    if (!body.bus_posting_group_code?.trim()) {
      return c.json({ success: false, error: 'لا يمكن إزالة مجموعة الترحيل. لتغييرها أرسل قيمة جديدة صحيحة.' }, 400)
    }
    const bpgValid = await c.env.DB
      .prepare('SELECT 1 FROM posting_rules WHERE company_id = ? AND bus_posting_group_code = ? LIMIT 1')
      .bind(company_id, body.bus_posting_group_code).first()
    if (!bpgValid) {
      return c.json({ success: false, error: `مجموعة الترحيل "${body.bus_posting_group_code}" غير موجودة` }, 400)
    }
    fields.push('bus_posting_group_code = ?')
    values.push(body.bus_posting_group_code)
  }

  if (!fields.length) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)

  await c.env.DB
    .prepare(`UPDATE suppliers SET ${fields.join(', ')} WHERE code = ? AND company_id = ?`)
    .bind(...values, code, company_id).run()

  return c.json({ success: true, data: null })
})

export default master
