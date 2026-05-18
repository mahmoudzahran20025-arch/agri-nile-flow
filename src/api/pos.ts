/**
 * pos.ts
 * ======
 * Retail POS API — cashier session management and fast-entry sales.
 *
 * Routes:
 *   POST /api/pos/sessions              — open a cashier session (shift)
 *   GET  /api/pos/sessions              — list sessions for company
 *   PATCH /api/pos/sessions/:id/close   — close a session with closing count
 *   POST /api/pos/sales                 — create a POS sale (faster than /api/sales; requires session)
 *   GET  /api/pos/sessions/:id/summary  — session revenue summary
 *
 * Design:
 *   • Each sale is linked to an open session (session_id required).
 *   • Returns a receipt-style JSON with line items, totals, change.
 *   • Internally creates sales_order + SALE inventory movements (same as /api/sales).
 *   • One session per cashier per day (enforced: reject open session on same branch+user).
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import { getUser, permissionGuard } from '../middleware/auth'
import { normalizeIsoDate } from '../lib/utils/date'
import { resolveSalesRevenue as buildSalesRevenueBlueprint, resolveControlAccount } from '../lib/posting_engine'
import { postFromBusinessEvent } from '../lib/finance'
import { getCompanyConfig } from '../lib/company_config'

const pos = new Hono<{ Bindings: Env }>()

// ── POST /api/pos/sessions ─────────────────────────────────────────────────────
pos.post('/sessions', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)

  const b = await c.req.json<{
    branch_id?:      number
    opening_float?:  number
  }>()

  // Reject if user already has an open session today on this branch
  const existing = await c.env.DB.prepare(
    `SELECT id FROM sales_sessions
     WHERE company_id = ? AND cashier_user_id = ? AND status = 'open'
       AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
     LIMIT 1`
  ).bind(company_id, userId, b.branch_id ?? null, b.branch_id ?? null).first<{ id: number }>()

  if (existing) {
    return c.json({
      success: false,
      error:   'يوجد جلسة مفتوحة بالفعل لهذا الكاشير',
      code:    'SESSION_ALREADY_OPEN',
      existing_session_id: existing.id,
    }, 409)
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO sales_sessions (company_id, branch_id, cashier_user_id, opening_float, status)
     VALUES (?, ?, ?, ?, 'open')
     RETURNING id, opened_at`
  ).bind(
    company_id,
    b.branch_id ?? null,
    userId,
    b.opening_float ?? 0,
  ).first<{ id: number; opened_at: string }>()

  if (!row) return c.json({ success: false, error: 'فشل في إنشاء الجلسة' }, 500)

  return c.json({ success: true, data: { session_id: row.id, opened_at: row.opened_at } }, 201)
})

// ── GET /api/pos/sessions ──────────────────────────────────────────────────────
pos.get('/sessions', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const status   = c.req.query('status')
  const branchId = c.req.query('branch_id')

  let where = 'WHERE ss.company_id = ?'
  const binds: unknown[] = [company_id]

  if (status)   { where += ' AND ss.status = ?';    binds.push(status) }
  if (branchId) { where += ' AND ss.branch_id = ?'; binds.push(Number(branchId)) }

  const { results } = await c.env.DB.prepare(
    `SELECT ss.*, u.name AS cashier_name, b.name AS branch_name
     FROM sales_sessions ss
     LEFT JOIN users u ON u.id = ss.cashier_user_id AND u.company_id = ss.company_id
     LEFT JOIN branches b ON b.id = ss.branch_id
     ${where}
     ORDER BY ss.opened_at DESC
     LIMIT 100`
  ).bind(...binds).all()

  return c.json({ success: true, data: results })
})

// ── PATCH /api/pos/sessions/:id/close ─────────────────────────────────────────
pos.patch('/sessions/:id/close', permissionGuard('inventory', 'update'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ success: false, error: 'معرف الجلسة غير صحيح' }, 400)

  const b = await c.req.json<{ closing_count?: number }>()

  const session = await c.env.DB.prepare(
    'SELECT id, status, cashier_user_id FROM sales_sessions WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; status: string; cashier_user_id: number }>()

  if (!session) return c.json({ success: false, error: 'الجلسة غير موجودة' }, 404)
  if (session.status !== 'open') return c.json({ success: false, error: `الجلسة ${session.status === 'closed' ? 'مغلقة' : 'مُسوّاة'} بالفعل` }, 422)

  await c.env.DB.prepare(
    `UPDATE sales_sessions
     SET status = 'closed', closed_at = datetime('now'), closing_count = ?
     WHERE id = ? AND company_id = ?`
  ).bind(b.closing_count ?? null, id, company_id).run()

  return c.json({ success: true, data: { session_id: id, status: 'closed' } })
})

// ── POST /api/pos/sales ────────────────────────────────────────────────────────
pos.post('/sales', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)

  const b = await c.req.json<{
    session_id:      number
    warehouse_id:    number
    customer_id?:    number
    payment_method?: 'cash' | 'card' | 'credit'
    tendered?:       number
    notes?:          string
    items: Array<{
      item_code:    number
      quantity:     number
      unit_price?:  number
      discount_pct?: number
    }>
  }>()

  if (!b.session_id || !b.warehouse_id || !b.items?.length) {
    return c.json({ success: false, error: 'session_id, warehouse_id, items مطلوبة' }, 400)
  }

  // Validate session is open and belongs to company
  const session = await c.env.DB.prepare(
    'SELECT id, branch_id FROM sales_sessions WHERE id = ? AND company_id = ? AND status = \'open\' LIMIT 1'
  ).bind(b.session_id, company_id).first<{ id: number; branch_id: number | null }>()

  if (!session) {
    return c.json({ success: false, error: 'الجلسة غير موجودة أو مغلقة', code: 'SESSION_NOT_OPEN' }, 422)
  }

  // Validate warehouse
  const warehouse = await c.env.DB.prepare(
    'SELECT id, name FROM warehouses WHERE id = ? AND company_id = ? AND is_active = 1'
  ).bind(b.warehouse_id, company_id).first<{ id: number; name: string }>()
  if (!warehouse) return c.json({ success: false, error: 'المخزن غير موجود أو غير نشط' }, 422)

  const paymentMethod = b.payment_method ?? 'cash'
  if (!['cash', 'card', 'credit'].includes(paymentMethod)) {
    return c.json({ success: false, error: 'طريقة الدفع غير صحيحة' }, 400)
  }

  // Resolve customer
  let customerId: number
  if (b.customer_id) {
    const cust = await c.env.DB.prepare(
      'SELECT id FROM customers WHERE id = ? AND company_id = ? AND is_active = 1'
    ).bind(b.customer_id, company_id).first<{ id: number }>()
    if (!cust) return c.json({ success: false, error: 'العميل غير موجود' }, 422)
    customerId = cust.id
  } else {
    const walkin = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE company_id = ? AND code = 'WALKIN' LIMIT 1"
    ).bind(company_id).first<{ id: number }>()
    if (!walkin) return c.json({ success: false, error: 'عميل WALKIN غير موجود' }, 500)
    customerId = walkin.id
  }

  const saleDate = normalizeIsoDate(new Date().toISOString().slice(0, 10))

  const companyCfg = await getCompanyConfig(c.env.DB, company_id)
  const vatPct = companyCfg.vat_pct

  // Validate items and resolve prices
  const resolvedLines: Array<{
    item_code:    number
    item_name:    string
    unit:         string | null
    quantity:     number
    unit_price:   number
    discount_pct: number
    line_total:   number
    vat_amount:   number
  }> = []

  for (const line of b.items) {
    if (!line.item_code || !line.quantity || line.quantity <= 0) {
      return c.json({ success: false, error: `بيانات الصنف غير صحيحة` }, 400)
    }

    const item = await c.env.DB.prepare(
      'SELECT code, name, unit, item_type, is_sellable, list_price, vat_exempt FROM items WHERE code = ? AND company_id = ?'
    ).bind(line.item_code, company_id).first<{
      code: number; name: string; unit: string | null
      item_type: string; is_sellable: number; list_price: number | null; vat_exempt: number
    }>()

    if (!item) return c.json({ success: false, error: `الصنف ${line.item_code} غير موجود` }, 404)
    if (item.item_type === 'service') {
      return c.json({ success: false, error: `الصنف ${line.item_code} خدمة — لا يمكن بيعه`, code: 'SERVICE_ITEM_NO_STOCK' }, 422)
    }
    if (!item.is_sellable) {
      return c.json({ success: false, error: `الصنف ${line.item_code} غير قابل للبيع`, code: 'ITEM_NOT_SELLABLE' }, 422)
    }

    const unitPrice   = line.unit_price ?? item.list_price ?? 0
    const discountPct = line.discount_pct ?? 0
    const lineTotal   = Math.round(line.quantity * unitPrice * (1 - discountPct / 100) * 100) / 100
    const vatAmount   = item.vat_exempt ? 0 : Math.round(lineTotal * (vatPct / 100) * 100) / 100

    resolvedLines.push({
      item_code:    item.code,
      item_name:    item.name,
      unit:         item.unit,
      quantity:     line.quantity,
      unit_price:   unitPrice,
      discount_pct: discountPct,
      line_total:   lineTotal,
      vat_amount:   vatAmount,
    })
  }

  const subtotal    = Math.round(resolvedLines.reduce((s, l) => s + l.line_total, 0) * 100) / 100
  const taxAmount   = Math.round(resolvedLines.reduce((s, l) => s + l.vat_amount, 0) * 100) / 100
  const total       = Math.round((subtotal + taxAmount) * 100) / 100
  const tendered    = b.tendered ?? (paymentMethod === 'cash' ? total : null)
  const change      = tendered != null ? Math.round((tendered - total) * 100) / 100 : null

  // Create order header
  const orderRow = await c.env.DB.prepare(
    `INSERT INTO sales_orders
       (company_id, session_id, branch_id, warehouse_id, customer_id,
        order_date, subtotal, tax_amount, total, payment_method, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)
     RETURNING id`
  ).bind(
    company_id,
    session.id,
    session.branch_id,
    warehouse.id,
    customerId,
    saleDate,
    subtotal,
    taxAmount,
    total,
    paymentMethod,
    b.notes?.trim() ?? null,
  ).first<{ id: number }>()

  if (!orderRow) return c.json({ success: false, error: 'فشل في إنشاء أمر البيع' }, 500)
  const orderId = orderRow.id

  const movementIds: number[] = []
  for (const line of resolvedLines) {
    await c.env.DB.prepare(
      `INSERT INTO sales_order_items
         (order_id, company_id, item_code, quantity, unit_price, discount_pct, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(orderId, company_id, line.item_code, line.quantity, line.unit_price, line.discount_pct, line.line_total).run()

    // Stock deduction
    const controls = await c.env.DB.prepare(
      'SELECT allow_negative_stock FROM inventory_posting_controls WHERE company_id = ? LIMIT 1'
    ).bind(company_id).first<{ allow_negative_stock: number }>()

    const balRow = await c.env.DB.prepare(
      'SELECT balance_qty FROM inventory_balances WHERE company_id = ? AND item_code = ? AND warehouse_id = ?'
    ).bind(company_id, line.item_code, warehouse.id).first<{ balance_qty: number }>()

    const prevQty = balRow?.balance_qty ?? 0
    const newQty  = Math.round((prevQty - line.quantity) * 1000) / 1000

    if (!(controls?.allow_negative_stock) && newQty < 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'voided' WHERE id = ? AND company_id = ?")
        .bind(orderId, company_id).run()
      return c.json({
        success: false,
        error:   `رصيد الصنف ${line.item_code} غير كافٍ (${prevQty} متاح، ${line.quantity} مطلوب)`,
        code:    'INSUFFICIENT_STOCK',
      }, 422)
    }

    const mvt = await c.env.DB.prepare(
      `INSERT INTO inventory_movements
         (company_id, item_code, warehouse_id, movement_type, movement_date,
          quantity, unit_price, total_value, running_balance,
          statement_text, created_by, gl_posting_status)
       VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?, 'pending')
       RETURNING id`
    ).bind(
      company_id, line.item_code, warehouse.id, saleDate,
      line.quantity, line.unit_price, line.line_total, newQty,
      `مبيعات POS — جلسة ${session.id} / أمر ${orderId}`,
      userId,
    ).first<{ id: number }>()

    if (!mvt) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'voided' WHERE id = ? AND company_id = ?")
        .bind(orderId, company_id).run()
      return c.json({ success: false, error: `فشل في تسجيل حركة الصنف ${line.item_code}` }, 500)
    }

    await c.env.DB.prepare(
      `INSERT INTO inventory_balances (company_id, item_code, warehouse_id, balance_qty)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(company_id, item_code, warehouse_id) DO UPDATE SET balance_qty = excluded.balance_qty`
    ).bind(company_id, line.item_code, warehouse.id, newQty).run()

    movementIds.push(mvt.id)
  }

  // Credit AR balance if credit sale
  if (paymentMethod === 'credit') {
    await c.env.DB.prepare(
      'UPDATE customers SET balance = balance + ? WHERE id = ? AND company_id = ?'
    ).bind(total, customerId, company_id).run()
  }

  // ── Revenue GL entry ─────────────────────────────────────────────────────────
  let glEntryId: number | null = null
  try {
    const receivableKey = paymentMethod === 'credit' ? 'receivable_default' : 'cash_default'
    const receivableAcc = await resolveControlAccount(c.env.DB, company_id, receivableKey)
    if (receivableAcc) {
      const blueprint = await buildSalesRevenueBlueprint(
        c.env.DB, company_id, null, null, receivableAcc, total,
        `بيع POS — أمر رقم ${orderId}`,
      )
      if (!blueprint.isBlocked && blueprint.lines.length) {
        glEntryId = await postFromBusinessEvent(c.env.DB, {
          company_id,
          event_type:    'sales_order_revenue',
          source_module: 'sales',
          source_id:     orderId,
          event_date:    saleDate,
          description:   `إيراد POS — أمر رقم ${orderId}`,
          created_by:    userId,
          payload: { order_id: orderId, total, payment_method: paymentMethod, session_id: session.id },
          trace:   blueprint.trace ?? null,
          lines:   blueprint.lines.map(l => ({
            account_code:     l.account_code!,
            debit:            l.debit ?? 0,
            credit:           l.credit ?? 0,
            description:      l.description ?? `بيع POS — أمر رقم ${orderId}`,
            rule_slot:        l.rule_slot,
            source_ledger:    'cash' as const,
            source_record_id: orderId,
          })),
          onJournalEntryPosted: async (entryId) => {
            await c.env.DB.prepare(
              'UPDATE sales_orders SET journal_entry_id = ? WHERE id = ? AND company_id = ?'
            ).bind(entryId, orderId, company_id).run()
          },
        })
      }
    }
  } catch {
    // Non-blocking
  }

  return c.json({
    success: true,
    data: {
      order_id:      orderId,
      session_id:    session.id,
      subtotal,
      tax_amount:    taxAmount,
      total,
      tendered,
      change,
      payment_method: paymentMethod,
      movement_ids:  movementIds,
      gl_entry_id:   glEntryId,
      receipt: {
        date:     saleDate,
        cashier:  userId,
        lines:    resolvedLines.map(l => ({
          item_code:  l.item_code,
          item_name:  l.item_name,
          unit:       l.unit,
          qty:        l.quantity,
          unit_price: l.unit_price,
          discount:   l.discount_pct,
          total:      l.line_total,
          vat_amount: l.vat_amount,
        })),
        subtotal,
        tax:       taxAmount,
        vat_pct:   vatPct,
        vat_number: companyCfg.vat_number,
        total,
        tendered,
        change,
      },
    },
  }, 201)
})

// ── GET /api/pos/sessions/:id/summary ─────────────────────────────────────────
pos.get('/sessions/:id/summary', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ success: false, error: 'معرف الجلسة غير صحيح' }, 400)

  const [session, totals, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ss.*, u.name AS cashier_name, b.name AS branch_name
       FROM sales_sessions ss
       LEFT JOIN users u ON u.id = ss.cashier_user_id AND u.company_id = ss.company_id
       LEFT JOIN branches b ON b.id = ss.branch_id
       WHERE ss.id = ? AND ss.company_id = ? LIMIT 1`
    ).bind(id, company_id).first(),
    c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status != 'voided' THEN total ELSE 0 END) AS gross_sales,
         SUM(CASE WHEN status = 'voided'  THEN total ELSE 0 END) AS voided_total,
         SUM(CASE WHEN status != 'voided' AND payment_method = 'cash'   THEN total ELSE 0 END) AS cash_sales,
         SUM(CASE WHEN status != 'voided' AND payment_method = 'card'   THEN total ELSE 0 END) AS card_sales,
         SUM(CASE WHEN status != 'voided' AND payment_method = 'credit' THEN total ELSE 0 END) AS credit_sales
       FROM sales_orders WHERE session_id = ? AND company_id = ?`
    ).bind(id, company_id).first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sales_orders WHERE session_id = ? AND company_id = ? AND status != 'voided'`
    ).bind(id, company_id).first<{ n: number }>(),
  ])

  if (!session) return c.json({ success: false, error: 'الجلسة غير موجودة' }, 404)

  return c.json({ success: true, data: { session, totals, order_count: count?.n ?? 0 } })
})

// ── GET /api/pos/sessions/:id/orders ──────────────────────────────────────────
pos.get('/sessions/:id/orders', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ success: false, error: 'معرف الجلسة غير صحيح' }, 400)

  const { results } = await c.env.DB.prepare(
    `SELECT id, order_date, subtotal, tax_amount, total,
            payment_method, status, customer_id, notes
     FROM sales_orders
     WHERE session_id = ? AND company_id = ?
     ORDER BY id DESC`
  ).bind(id, company_id).all<{
    id: number; order_date: string; subtotal: number; tax_amount: number; total: number
    payment_method: string; status: string; customer_id: number | null; notes: string | null
  }>()

  return c.json({ success: true, data: results })
})

export default pos
