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
