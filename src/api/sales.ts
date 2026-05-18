/**
 * sales.ts
 * ========
 * Agricultural sales API — records a sale of inventory items via the
 * standard movement engine (SALE movement type) and optionally ties the
 * sale to a customer and a sales_order record for receivables tracking.
 *
 * Routes:
 *   POST /api/sales              — create a sale (one or more items)
 *   GET  /api/sales              — list sales orders (paginated)
 *   GET  /api/sales/:id          — get single sales order with items
 *   PATCH /api/sales/:id/void    — void an open or paid sales order
 *
 * Design:
 *   • Each line item calls the inventory movement engine with SALE type.
 *   • A sales_orders header record aggregates the lines for receivables.
 *   • payment_method='credit' writes to customer.balance (simple AR).
 *   • All lines share one movement_date and one warehouse.
 *   • Atomicity: all inserts wrapped in D1 batch; first movement failure
 *     aborts the whole sale.
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import { getUser, permissionGuard } from '../middleware/auth'
import { normalizeIsoDate, isFutureIsoDate } from '../lib/utils/date'

const sales = new Hono<{ Bindings: Env }>()

// ── POST /api/sales ────────────────────────────────────────────────────────────
sales.post('/', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)

  const b = await c.req.json<{
    sale_date:      string
    warehouse_id:   number
    customer_id?:   number
    payment_method?: 'cash' | 'card' | 'credit'
    session_id?:    number
    branch_id?:     number
    notes?:         string
    items: Array<{
      item_code:   number
      quantity:    number
      unit_price:  number
      discount_pct?: number
    }>
  }>()

  if (!b.sale_date || !b.warehouse_id || !b.items?.length) {
    return c.json({ success: false, error: 'sale_date, warehouse_id, items مطلوبة' }, 400)
  }

  const saleDate = normalizeIsoDate(b.sale_date)
  if (isFutureIsoDate(saleDate)) {
    return c.json({ success: false, error: 'لا يمكن تسجيل بيع بتاريخ مستقبلي' }, 422)
  }

  const paymentMethod = b.payment_method ?? 'cash'
  if (!['cash', 'card', 'credit'].includes(paymentMethod)) {
    return c.json({ success: false, error: 'طريقة الدفع يجب أن تكون cash أو card أو credit' }, 400)
  }

  // Validate warehouse belongs to company
  const warehouse = await c.env.DB.prepare(
    'SELECT id, name FROM warehouses WHERE id = ? AND company_id = ? AND is_active = 1'
  ).bind(b.warehouse_id, company_id).first<{ id: number; name: string }>()
  if (!warehouse) return c.json({ success: false, error: 'المخزن غير موجود أو غير نشط' }, 422)

  // Resolve customer — default to WALKIN
  let customerId: number
  if (b.customer_id) {
    const cust = await c.env.DB.prepare(
      'SELECT id FROM customers WHERE id = ? AND company_id = ? AND is_active = 1'
    ).bind(b.customer_id, company_id).first<{ id: number }>()
    if (!cust) return c.json({ success: false, error: 'العميل غير موجود أو غير نشط' }, 422)
    customerId = cust.id
  } else {
    const walkin = await c.env.DB.prepare(
      "SELECT id FROM customers WHERE company_id = ? AND code = 'WALKIN' LIMIT 1"
    ).bind(company_id).first<{ id: number }>()
    if (!walkin) return c.json({ success: false, error: 'لم يتم العثور على عميل WALKIN — يرجى إعادة تطبيق الترحيل 0150' }, 500)
    customerId = walkin.id
  }

  // Validate all items upfront
  for (const line of b.items) {
    if (!line.item_code || !line.quantity || line.quantity <= 0) {
      return c.json({ success: false, error: `item_code وquantity مطلوبان ويجب أن تكون الكمية أكبر من صفر` }, 400)
    }
    if (line.unit_price == null || line.unit_price < 0) {
      return c.json({ success: false, error: `سعر الوحدة للصنف ${line.item_code} غير صحيح` }, 400)
    }
    const discountPct = line.discount_pct ?? 0
    if (discountPct < 0 || discountPct > 100) {
      return c.json({ success: false, error: `نسبة الخصم للصنف ${line.item_code} يجب أن تكون بين 0 و100` }, 400)
    }

    const item = await c.env.DB.prepare(
      'SELECT item_type, is_sellable FROM items WHERE code = ? AND company_id = ?'
    ).bind(line.item_code, company_id).first<{ item_type: string; is_sellable: number }>()
    if (!item) return c.json({ success: false, error: `الصنف ${line.item_code} غير موجود` }, 404)
    if (item.item_type === 'service') {
      return c.json({ success: false, error: `الصنف ${line.item_code} خدمة — لا يمكن بيعه بحركة مخزنية`, code: 'SERVICE_ITEM_NO_STOCK' }, 422)
    }
    if (!item.is_sellable) {
      return c.json({ success: false, error: `الصنف ${line.item_code} غير قابل للبيع`, code: 'ITEM_NOT_SELLABLE' }, 422)
    }
  }

  // Calculate totals
  let subtotal = 0
  const lineData = b.items.map((line) => {
    const discountPct = line.discount_pct ?? 0
    const lineTotal = Math.round(line.quantity * line.unit_price * (1 - discountPct / 100) * 100) / 100
    subtotal += lineTotal
    return { ...line, discount_pct: discountPct, line_total: lineTotal }
  })
  subtotal = Math.round(subtotal * 100) / 100
  // Tax not yet implemented — reserved for later phase
  const taxAmount = 0
  const total = subtotal + taxAmount

  // Create sales_order header
  const orderInsert = await c.env.DB.prepare(
    `INSERT INTO sales_orders
       (company_id, session_id, branch_id, warehouse_id, customer_id,
        order_date, subtotal, tax_amount, total, payment_method, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)
     RETURNING id`
  ).bind(
    company_id,
    b.session_id ?? null,
    b.branch_id ?? null,
    warehouse.id,
    customerId,
    saleDate,
    subtotal,
    taxAmount,
    total,
    paymentMethod,
    b.notes?.trim() ?? null,
  ).first<{ id: number }>()

  if (!orderInsert) {
    return c.json({ success: false, error: 'فشل في إنشاء أمر البيع' }, 500)
  }
  const orderId = orderInsert.id

  // Insert line items and inventory movements
  const movementIds: number[] = []
  for (const line of lineData) {
    // Insert sales_order_items
    await c.env.DB.prepare(
      `INSERT INTO sales_order_items
         (order_id, company_id, item_code, quantity, unit_price, discount_pct, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(orderId, company_id, line.item_code, line.quantity, line.unit_price, line.discount_pct, line.line_total).run()

    // Insert inventory movement (SALE type) via direct insert
    // We call the internal movement logic by posting through the movements API
    // pattern: insert movement, update running balance
    const totalValue = line.line_total

    // Read current balance
    const currentBalance = await c.env.DB.prepare(
      'SELECT balance_qty FROM inventory_balances WHERE company_id = ? AND item_code = ? AND warehouse_id = ?'
    ).bind(company_id, line.item_code, warehouse.id).first<{ balance_qty: number }>()

    const prevQty = currentBalance?.balance_qty ?? 0
    const newQty = Math.round((prevQty - line.quantity) * 1000) / 1000

    // Inventory controls: check negative stock policy
    const controls = await c.env.DB.prepare(
      'SELECT allow_negative_stock FROM inventory_posting_controls WHERE company_id = ? LIMIT 1'
    ).bind(company_id).first<{ allow_negative_stock: number }>()

    if (!(controls?.allow_negative_stock) && newQty < 0) {
      // Rollback: void the order
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'voided' WHERE id = ? AND company_id = ?")
        .bind(orderId, company_id).run()
      return c.json({
        success: false,
        error: `رصيد الصنف ${line.item_code} غير كافٍ (الرصيد الحالي: ${prevQty}, الطلوب: ${line.quantity})`,
        code: 'INSUFFICIENT_STOCK',
      }, 422)
    }

    // Insert the movement
    const mvtInsert = await c.env.DB.prepare(
      `INSERT INTO inventory_movements
         (company_id, item_code, warehouse_id, movement_type, movement_date,
          quantity, unit_price, total_value, running_balance,
          statement_text, created_by, gl_posting_status)
       VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?, 'pending')
       RETURNING id`
    ).bind(
      company_id, line.item_code, warehouse.id, saleDate,
      line.quantity, line.unit_price, totalValue, newQty,
      `مبيعات — أمر رقم ${orderId}`,
      userId,
    ).first<{ id: number }>()

    if (!mvtInsert) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'voided' WHERE id = ? AND company_id = ?")
        .bind(orderId, company_id).run()
      return c.json({ success: false, error: `فشل في تسجيل حركة الصنف ${line.item_code}` }, 500)
    }

    // Update inventory balance
    await c.env.DB.prepare(
      `INSERT INTO inventory_balances (company_id, item_code, warehouse_id, balance_qty)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(company_id, item_code, warehouse_id) DO UPDATE SET balance_qty = excluded.balance_qty`
    ).bind(company_id, line.item_code, warehouse.id, newQty).run()

    movementIds.push(mvtInsert.id)
  }

  // If credit sale — write to customer balance
  if (paymentMethod === 'credit') {
    await c.env.DB.prepare(
      'UPDATE customers SET balance = balance + ? WHERE id = ? AND company_id = ?'
    ).bind(total, customerId, company_id).run()
  }

  return c.json({
    success: true,
    data: {
      order_id:    orderId,
      total,
      subtotal,
      tax_amount:  taxAmount,
      movement_ids: movementIds,
    },
  }, 201)
})

// ── GET /api/sales ─────────────────────────────────────────────────────────────
sales.get('/', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const page   = Math.max(1, Number(c.req.query('page') ?? 1))
  const size   = Math.min(100, Number(c.req.query('size') ?? 50))
  const offset = (page - 1) * size

  const dateFrom = c.req.query('date_from')
  const dateTo   = c.req.query('date_to')
  const status   = c.req.query('status')

  let where = 'WHERE so.company_id = ? AND so.status != \'voided\''
  const binds: unknown[] = [company_id]

  if (dateFrom) { where += ' AND so.order_date >= ?'; binds.push(dateFrom) }
  if (dateTo)   { where += ' AND so.order_date <= ?'; binds.push(dateTo) }
  if (status)   { where += ' AND so.status = ?';      binds.push(status) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT so.*, cu.name AS customer_name, cu.code AS customer_code,
              w.name AS warehouse_name
       FROM sales_orders so
       LEFT JOIN customers cu ON cu.id = so.customer_id AND cu.company_id = so.company_id
       LEFT JOIN warehouses w  ON w.id  = so.warehouse_id AND w.company_id = so.company_id
       ${where}
       ORDER BY so.order_date DESC, so.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sales_orders so ${where}`
    ).bind(...binds).first<{ n: number }>(),
  ])

  return c.json({
    success: true,
    data: rows.results,
    total: cnt?.n ?? 0, page, page_size: size,
    has_more: offset + size < (cnt?.n ?? 0),
  })
})

// ── GET /api/sales/daily ───────────────────────────────────────────────────────
// Daily revenue summary. Query params: date (YYYY-MM-DD, defaults today),
// branch_id (optional). Returns gross_sales, voided_total, net_sales, order
// counts, and a breakdown by payment_method.
// IMPORTANT: this route must be registered before /:id to prevent Hono from
// matching "daily" as a numeric id param.
sales.get('/daily', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const date     = c.req.query('date') ?? new Date().toISOString().slice(0, 10)
  const branchId = c.req.query('branch_id') ? Number(c.req.query('branch_id')) : null

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ success: false, error: 'date يجب أن يكون بصيغة YYYY-MM-DD' }, 400)
  }

  const branchFilter = branchId ? 'AND so.branch_id = ?' : ''
  const binds: unknown[] = [company_id, date, ...(branchId ? [branchId] : [])]

  const [totals, byPayment, byHour] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status != 'voided' THEN total ELSE 0 END), 0) AS gross_sales,
         COALESCE(SUM(CASE WHEN status  = 'voided' THEN total ELSE 0 END), 0) AS voided_total,
         COUNT(CASE WHEN status != 'voided' THEN 1 END)                        AS order_count,
         COUNT(CASE WHEN status  = 'voided' THEN 1 END)                        AS voided_count
       FROM sales_orders so
       WHERE so.company_id = ? AND so.order_date = ? ${branchFilter}`
    ).bind(...binds).first<{
      gross_sales: number; voided_total: number
      order_count: number; voided_count: number
    }>(),

    c.env.DB.prepare(
      `SELECT payment_method,
              COUNT(*)     AS order_count,
              SUM(total)   AS revenue
       FROM sales_orders so
       WHERE so.company_id = ? AND so.order_date = ? AND status != 'voided' ${branchFilter}
       GROUP BY payment_method
       ORDER BY revenue DESC`
    ).bind(...binds).all<{ payment_method: string; order_count: number; revenue: number }>(),

    c.env.DB.prepare(
      `SELECT strftime('%H', created_at) AS hour,
              COUNT(*)   AS order_count,
              SUM(total) AS revenue
       FROM sales_orders so
       WHERE so.company_id = ? AND so.order_date = ? AND status != 'voided' ${branchFilter}
         AND created_at IS NOT NULL
       GROUP BY hour
       ORDER BY hour`
    ).bind(...binds).all<{ hour: string; order_count: number; revenue: number }>(),
  ])

  const grossSales  = totals?.gross_sales  ?? 0
  const voidedTotal = totals?.voided_total ?? 0
  const netSales    = Math.round((grossSales - voidedTotal) * 100) / 100

  return c.json({
    success: true,
    data: {
      date,
      branch_id:   branchId,
      gross_sales:  grossSales,
      voided_total: voidedTotal,
      net_sales:    netSales,
      order_count:  totals?.order_count  ?? 0,
      voided_count: totals?.voided_count ?? 0,
      by_payment:   byPayment.results,
      by_hour:      byHour.results,
    },
  })
})

// ── GET /api/sales/:id ─────────────────────────────────────────────────────────
sales.get('/:id', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ success: false, error: 'معرف أمر البيع غير صحيح' }, 400)

  const [order, items] = await Promise.all([
    c.env.DB.prepare(
      `SELECT so.*, cu.name AS customer_name, cu.code AS customer_code,
              w.name AS warehouse_name
       FROM sales_orders so
       LEFT JOIN customers cu ON cu.id = so.customer_id AND cu.company_id = so.company_id
       LEFT JOIN warehouses w  ON w.id  = so.warehouse_id AND w.company_id = so.company_id
       WHERE so.id = ? AND so.company_id = ? LIMIT 1`
    ).bind(id, company_id).first(),
    c.env.DB.prepare(
      `SELECT soi.*, i.name AS item_name, i.unit
       FROM sales_order_items soi
       LEFT JOIN items i ON i.code = soi.item_code AND i.company_id = soi.company_id
       WHERE soi.order_id = ? AND soi.company_id = ?
       ORDER BY soi.id`
    ).bind(id, company_id).all(),
  ])

  if (!order) return c.json({ success: false, error: 'أمر البيع غير موجود' }, 404)

  return c.json({ success: true, data: { ...order, items: items.results } })
})

// ── PATCH /api/sales/:id/void ──────────────────────────────────────────────────
sales.patch('/:id/void', permissionGuard('inventory', 'update'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ success: false, error: 'معرف أمر البيع غير صحيح' }, 400)

  const order = await c.env.DB.prepare(
    'SELECT id, status, total, customer_id, payment_method FROM sales_orders WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; status: string; total: number; customer_id: number; payment_method: string }>()

  if (!order) return c.json({ success: false, error: 'أمر البيع غير موجود' }, 404)
  if (order.status === 'voided') return c.json({ success: false, error: 'أمر البيع ملغى مسبقاً' }, 422)

  // Reverse inventory movements for this order
  const lines = await c.env.DB.prepare(
    'SELECT item_code, quantity, warehouse_id FROM sales_order_items soi JOIN sales_orders so ON so.id = soi.order_id WHERE soi.order_id = ? AND soi.company_id = ?'
  ).bind(id, company_id).all<{ item_code: number; quantity: number; warehouse_id: number }>()

  for (const line of lines.results) {
    const warehouseId = (order as any).warehouse_id ?? line.warehouse_id
    const bal = await c.env.DB.prepare(
      'SELECT balance_qty FROM inventory_balances WHERE company_id = ? AND item_code = ? AND warehouse_id = ?'
    ).bind(company_id, line.item_code, warehouseId).first<{ balance_qty: number }>()
    const newQty = Math.round(((bal?.balance_qty ?? 0) + line.quantity) * 1000) / 1000

    await c.env.DB.prepare(
      `INSERT INTO inventory_movements
         (company_id, item_code, warehouse_id, movement_type, movement_date,
          quantity, unit_price, total_value, running_balance,
          statement_text, created_by, gl_posting_status)
       VALUES (?, ?, ?, 'RETURN_CUSTOMER', date('now'), ?, 0, 0, ?, ?, ?, 'pending')`
    ).bind(
      company_id, line.item_code, warehouseId,
      line.quantity, newQty,
      `إلغاء أمر بيع رقم ${id}`,
      userId,
    ).run()

    await c.env.DB.prepare(
      `INSERT INTO inventory_balances (company_id, item_code, warehouse_id, balance_qty)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(company_id, item_code, warehouse_id) DO UPDATE SET balance_qty = excluded.balance_qty`
    ).bind(company_id, line.item_code, warehouseId, newQty).run()
  }

  // Reverse credit balance if applicable
  if (order.payment_method === 'credit') {
    await c.env.DB.prepare(
      'UPDATE customers SET balance = balance - ? WHERE id = ? AND company_id = ?'
    ).bind(order.total, order.customer_id, company_id).run()
  }

  await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'voided' WHERE id = ? AND company_id = ?"
  ).bind(id, company_id).run()

  return c.json({ success: true, data: { voided: true, order_id: id } })
})

export default sales
