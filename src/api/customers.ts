/**
 * customers.ts
 * ============
 * Customer management API — full CRUD with price tier assignment.
 *
 * Routes:
 *   GET    /api/customers              — list with search/filter
 *   GET    /api/customers/:id          — single customer detail
 *   POST   /api/customers              — create customer
 *   PATCH  /api/customers/:id          — update customer
 *   DELETE /api/customers/:id          — soft-delete (set is_active=0)
 *   GET    /api/customers/:id/ledger   — customer balance history (sales orders)
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import { getUser, permissionGuard } from '../middleware/auth'
import { resolveControlAccount } from '../lib/posting_engine'
import { postFromBusinessEvent } from '../lib/finance'

const customers = new Hono<{ Bindings: Env }>()

// ── GET /api/customers ─────────────────────────────────────────────────────────
customers.get('/', permissionGuard('sales', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const { q, tier_id, is_active = '1', limit = '50', offset = '0' } = c.req.query()

  const conditions: string[] = ['c.company_id = ?']
  const binds: unknown[] = [company_id]

  if (is_active !== 'all') {
    conditions.push('c.is_active = ?')
    binds.push(is_active === '1' ? 1 : 0)
  }

  if (q) {
    conditions.push('(c.name LIKE ? OR c.code LIKE ? OR c.phone LIKE ?)')
    const like = `%${q}%`
    binds.push(like, like, like)
  }

  if (tier_id) {
    conditions.push('c.tier_id = ?')
    binds.push(Number(tier_id))
  }

  const where = conditions.join(' AND ')

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT c.id, c.code, c.name, c.phone, c.credit_limit, c.balance,
              c.is_active, c.created_at, c.tier_id,
              t.name AS tier_name
       FROM customers c
       LEFT JOIN customer_price_tiers t ON t.id = c.tier_id
       WHERE ${where}
       ORDER BY c.name ASC
       LIMIT ? OFFSET ?`
    ).bind(...binds, Number(limit), Number(offset)).all<{
      id: number; code: string; name: string; phone: string | null
      credit_limit: number; balance: number; is_active: number
      created_at: string; tier_id: number | null; tier_name: string | null
    }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM customers c WHERE ${where}`
    ).bind(...binds).first<{ n: number }>(),
  ])

  return c.json({
    data:  rows.results,
    total: countRow?.n ?? 0,
  })
})

// ── GET /api/customers/ar-aging ───────────────────────────────────────────────
// IMPORTANT: registered before /:id so Hono does not match 'ar-aging' as a numeric id.
// AR aging summary — customers with outstanding credit balances bucketed by
// how long the oldest unpaid credit order has been outstanding.
// Buckets: current (≤30d), 31-60d, 61-90d, 91+d.
customers.get('/ar-aging', permissionGuard('sales', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const today = new Date().toISOString().slice(0, 10)

  const { results: customers_with_balance } = await c.env.DB.prepare(`
    SELECT c.id, c.code, c.name, c.balance, c.credit_limit,
           MIN(o.order_date) AS oldest_unpaid_date
    FROM customers c
    LEFT JOIN sales_orders o
      ON o.customer_id = c.id
      AND o.company_id = c.company_id
      AND o.payment_method = 'credit'
      AND o.status != 'voided'
    WHERE c.company_id = ? AND c.balance > 0.005
    GROUP BY c.id
    ORDER BY c.balance DESC
  `).bind(company_id).all<{
    id: number; code: string; name: string; balance: number; credit_limit: number
    oldest_unpaid_date: string | null
  }>()

  const buckets = { current: 0, days_31_60: 0, days_61_90: 0, days_91_plus: 0 }
  const todayMs = new Date(today).getTime()

  const rows = customers_with_balance.map(r => {
    const days = r.oldest_unpaid_date
      ? Math.floor((todayMs - new Date(r.oldest_unpaid_date).getTime()) / 86_400_000)
      : 0
    let bucket: keyof typeof buckets
    if      (days <= 30)  { bucket = 'current';      buckets.current      += r.balance }
    else if (days <= 60)  { bucket = 'days_31_60';   buckets.days_31_60   += r.balance }
    else if (days <= 90)  { bucket = 'days_61_90';   buckets.days_61_90   += r.balance }
    else                  { bucket = 'days_91_plus';  buckets.days_91_plus  += r.balance }
    return { ...r, days_outstanding: days, bucket }
  })

  return c.json({ success: true, data: { total_ar: rows.reduce((s, r) => s + r.balance, 0), buckets, rows } })
})

// ── GET /api/customers/:id ─────────────────────────────────────────────────────
customers.get('/:id', permissionGuard('sales', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const row = await c.env.DB.prepare(
    `SELECT c.id, c.code, c.name, c.phone, c.credit_limit, c.balance,
            c.is_active, c.created_at, c.tier_id,
            t.name AS tier_name,
            (SELECT COUNT(*) FROM sales_orders WHERE customer_id = c.id AND company_id = c.company_id) AS order_count
     FROM customers c
     LEFT JOIN customer_price_tiers t ON t.id = c.tier_id
     WHERE c.id = ? AND c.company_id = ?`
  ).bind(id, company_id).first<{
    id: number; code: string; name: string; phone: string | null
    credit_limit: number; balance: number; is_active: number
    created_at: string; tier_id: number | null; tier_name: string | null
    order_count: number
  }>()

  if (!row) return c.json({ success: false, error: 'العميل غير موجود' }, 404)
  return c.json(row)
})

// ── POST /api/customers ────────────────────────────────────────────────────────
customers.post('/', permissionGuard('sales', 'create'), async (c) => {
  const { company_id } = getUser(c)

  const b = await c.req.json<{
    code:          string
    name:          string
    phone?:        string
    credit_limit?: number
    tier_id?:      number | null
  }>()

  if (!b.code?.trim()) return c.json({ success: false, error: 'كود العميل مطلوب' }, 400)
  if (!b.name?.trim()) return c.json({ success: false, error: 'اسم العميل مطلوب' }, 400)

  const existing = await c.env.DB.prepare(
    `SELECT id FROM customers WHERE company_id = ? AND code = ?`
  ).bind(company_id, b.code.trim().toUpperCase()).first<{ id: number }>()

  if (existing) return c.json({ success: false, error: 'كود العميل مستخدم مسبقاً', code: 'DUPLICATE_CODE' }, 409)

  const result = await c.env.DB.prepare(
    `INSERT INTO customers (company_id, code, name, phone, credit_limit, tier_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    company_id,
    b.code.trim().toUpperCase(),
    b.name.trim(),
    b.phone?.trim() ?? null,
    b.credit_limit ?? 0,
    b.tier_id ?? null,
  ).run()

  return c.json({ success: true, id: result.meta.last_row_id }, 201)
})

// ── PATCH /api/customers/:id ───────────────────────────────────────────────────
customers.patch('/:id', permissionGuard('sales', 'update'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB.prepare(
    `SELECT id, code FROM customers WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).first<{ id: number; code: string }>()
  if (!existing) return c.json({ success: false, error: 'العميل غير موجود' }, 404)

  const b = await c.req.json<{
    name?:         string
    phone?:        string | null
    credit_limit?: number
    tier_id?:      number | null
    is_active?:    0 | 1
  }>()

  const sets: string[] = []
  const binds: unknown[] = []

  if (b.name !== undefined)         { sets.push('name = ?');         binds.push(b.name.trim()) }
  if ('phone' in b)                 { sets.push('phone = ?');        binds.push(b.phone ?? null) }
  if (b.credit_limit !== undefined) { sets.push('credit_limit = ?'); binds.push(b.credit_limit) }
  if ('tier_id' in b)               { sets.push('tier_id = ?');      binds.push(b.tier_id ?? null) }
  if (b.is_active !== undefined)    { sets.push('is_active = ?');    binds.push(b.is_active) }

  if (sets.length === 0) return c.json({ success: false, error: 'لا توجد بيانات للتحديث' }, 400)

  binds.push(id, company_id)
  await c.env.DB.prepare(
    `UPDATE customers SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...binds).run()

  return c.json({ success: true })
})

// ── DELETE /api/customers/:id ──────────────────────────────────────────────────
customers.delete('/:id', permissionGuard('sales', 'delete'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const row = await c.env.DB.prepare(
    `SELECT id, code FROM customers WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).first<{ id: number; code: string }>()
  if (!row) return c.json({ success: false, error: 'العميل غير موجود' }, 404)

  if (row.code === 'WALKIN') {
    return c.json({ success: false, error: 'لا يمكن حذف العميل النقدي الافتراضي' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE customers SET is_active = 0 WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).run()

  return c.json({ success: true })
})

// ── POST /api/customers/:id/collect ───────────────────────────────────────────
// Record a cash receipt from a credit customer.
// DR Cash (cash_default) / CR AR (receivable_default), updates customer.balance.
customers.post('/:id/collect', permissionGuard('sales', 'update'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const customer = await c.env.DB.prepare(
    'SELECT id, name, balance FROM customers WHERE id = ? AND company_id = ? AND is_active = 1'
  ).bind(id, company_id).first<{ id: number; name: string; balance: number }>()
  if (!customer) return c.json({ success: false, error: 'العميل غير موجود أو غير نشط' }, 404)

  const b = await c.req.json<{
    amount:          number
    payment_date?:   string
    payment_method?: 'cash' | 'card' | 'bank_transfer' | 'cheque'
    reference?:      string
    notes?:          string
  }>()

  if (!b.amount || b.amount <= 0) {
    return c.json({ success: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }, 400)
  }
  const amount = Math.round(b.amount * 100) / 100
  if (amount > Math.round(customer.balance * 100) / 100 + 0.01) {
    return c.json({
      success: false,
      error: `المبلغ المُحصَّل (${amount}) يتجاوز الرصيد المديون (${customer.balance.toFixed(2)})`,
      code: 'OVERPAYMENT',
    }, 422)
  }

  const paymentDate   = b.payment_date ?? new Date().toISOString().slice(0, 10)
  const paymentMethod = b.payment_method ?? 'cash'

  // Insert payment record
  const pr = await c.env.DB.prepare(
    `INSERT INTO customer_payments
       (company_id, customer_id, payment_date, amount, payment_method, reference, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  ).bind(
    company_id, id, paymentDate, amount, paymentMethod,
    b.reference?.trim() ?? null, b.notes?.trim() ?? null, userId,
  ).first<{ id: number }>()

  if (!pr) return c.json({ success: false, error: 'فشل في تسجيل الدفعة' }, 500)

  // Reduce customer AR balance
  const newBalance = Math.round((customer.balance - amount) * 100) / 100
  await c.env.DB.prepare(
    'UPDATE customers SET balance = ? WHERE id = ? AND company_id = ?'
  ).bind(newBalance, id, company_id).run()

  // ── GL: DR Cash / CR AR ────────────────────────────────────────────────────
  let glEntryId: number | null = null
  try {
    const cashAcc       = await resolveControlAccount(c.env.DB, company_id, 'cash_default')
    const receivableAcc = await resolveControlAccount(c.env.DB, company_id, 'receivable_default')
    if (cashAcc && receivableAcc) {
      glEntryId = await postFromBusinessEvent(c.env.DB, {
        company_id,
        event_type:    'customer_payment_receipt',
        source_module: 'sales',
        source_id:     pr.id,
        event_date:    paymentDate,
        description:   `تحصيل من ${customer.name} — دفعة رقم ${pr.id}`,
        created_by:    userId,
        payload:       { customer_id: id, amount, payment_method: paymentMethod },
        lines: [
          { account_code: cashAcc,       debit: amount, credit: 0,      description: `تحصيل مديونية — ${customer.name}`, rule_slot: 'cash',            source_ledger: 'cash' as const, source_record_id: pr.id },
          { account_code: receivableAcc, debit: 0,      credit: amount, description: `تسوية ذمم مدينة — ${customer.name}`, rule_slot: 'receivable_account', source_ledger: 'cash' as const, source_record_id: pr.id },
        ],
        onJournalEntryPosted: async (entryId) => {
          await c.env.DB.prepare(
            'UPDATE customer_payments SET journal_entry_id = ? WHERE id = ? AND company_id = ?'
          ).bind(entryId, pr.id, company_id).run()
        },
      })
    }
  } catch {
    // Non-blocking — payment recorded, GL retry via batch posting center
  }

  return c.json({
    success: true,
    data: {
      payment_id:   pr.id,
      customer_id:  id,
      amount,
      new_balance:  newBalance,
      gl_entry_id:  glEntryId,
    },
  }, 201)
})

// ── GET /api/customers/:id/collections ────────────────────────────────────────
customers.get('/:id/collections', permissionGuard('sales', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const { limit = '30', offset = '0' } = c.req.query()

  const exists = await c.env.DB.prepare(
    'SELECT id FROM customers WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number }>()
  if (!exists) return c.json({ success: false, error: 'العميل غير موجود' }, 404)

  const { results } = await c.env.DB.prepare(`
    SELECT cp.id, cp.payment_date, cp.amount, cp.payment_method,
           cp.reference, cp.notes, cp.journal_entry_id, cp.created_at
    FROM customer_payments cp
    WHERE cp.company_id = ? AND cp.customer_id = ?
    ORDER BY cp.payment_date DESC, cp.id DESC
    LIMIT ? OFFSET ?
  `).bind(company_id, id, Number(limit), Number(offset)).all<{
    id: number; payment_date: string; amount: number; payment_method: string
    reference: string | null; notes: string | null
    journal_entry_id: number | null; created_at: string
  }>()

  const total = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(amount),0) AS total_collected FROM customer_payments WHERE company_id = ? AND customer_id = ?'
  ).bind(company_id, id).first<{ total_collected: number }>()

  return c.json({ success: true, data: { payments: results, total_collected: total?.total_collected ?? 0 } })
})

// ── GET /api/customers/:id/ledger ─────────────────────────────────────────────
customers.get('/:id/ledger', permissionGuard('sales', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const { limit = '20', offset = '0' } = c.req.query()

  const exists = await c.env.DB.prepare(
    `SELECT id FROM customers WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).first<{ id: number }>()
  if (!exists) return c.json({ success: false, error: 'العميل غير موجود' }, 404)

  const [orders, summary] = await Promise.all([
    c.env.DB.prepare(
      `SELECT o.id, o.order_date, o.subtotal, o.tax_amount, o.total,
              o.payment_method, o.status, o.notes,
              s.cashier_user_id
       FROM sales_orders o
       LEFT JOIN sales_sessions s ON s.id = o.session_id
       WHERE o.customer_id = ? AND o.company_id = ?
       ORDER BY o.order_date DESC
       LIMIT ? OFFSET ?`
    ).bind(id, company_id, Number(limit), Number(offset)).all<{
      id: number; order_date: string; subtotal: number; tax_amount: number
      total: number; payment_method: string | null; status: string
      notes: string | null; cashier_user_id: number | null
    }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS order_count,
              COALESCE(SUM(CASE WHEN status != 'voided' THEN total ELSE 0 END), 0) AS total_spent,
              COALESCE(SUM(CASE WHEN status = 'voided' THEN 1 ELSE 0 END), 0) AS voided_count
       FROM sales_orders WHERE customer_id = ? AND company_id = ?`
    ).bind(id, company_id).first<{ order_count: number; total_spent: number; voided_count: number }>(),
  ])

  return c.json({
    summary,
    orders: orders.results,
  })
})

export default customers
