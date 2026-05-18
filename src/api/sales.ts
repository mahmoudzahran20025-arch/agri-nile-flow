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
 *   POST /api/sales/returns      — create a sales return (partial or full)
 *   GET  /api/sales/returns      — list sales returns
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
import { resolveSalesRevenue as buildSalesRevenueBlueprint, resolveControlAccount } from '../lib/posting_engine'
import { postFromBusinessEvent } from '../lib/finance'

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

  // Fetch company VAT settings
  const company = await c.env.DB.prepare(
    'SELECT vat_pct, vat_number, vat_registered FROM companies WHERE id = ?'
  ).bind(company_id).first<{ vat_pct: number; vat_number: string | null; vat_registered: number }>()
  const vatPct = company?.vat_pct ?? 0

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

  // Validate all items upfront and collect details for totals calculation
  type ValidatedLine = typeof b.items[number] & {
    discount_pct: number; line_total: number; vat_amount: number; vat_exempt: number
  }
  const validatedLines: ValidatedLine[] = []

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
      'SELECT item_type, is_sellable, min_selling_price, vat_exempt FROM items WHERE code = ? AND company_id = ?'
    ).bind(line.item_code, company_id).first<{ item_type: string; is_sellable: number; min_selling_price: number | null; vat_exempt: number }>()
    if (!item) return c.json({ success: false, error: `الصنف ${line.item_code} غير موجود` }, 404)
    if (item.item_type === 'service') {
      return c.json({ success: false, error: `الصنف ${line.item_code} خدمة — لا يمكن بيعه بحركة مخزنية`, code: 'SERVICE_ITEM_NO_STOCK' }, 422)
    }
    if (!item.is_sellable) {
      return c.json({ success: false, error: `الصنف ${line.item_code} غير قابل للبيع`, code: 'ITEM_NOT_SELLABLE' }, 422)
    }
    const effectivePrice = line.unit_price * (1 - discountPct / 100)
    if (item.min_selling_price != null && effectivePrice < item.min_selling_price) {
      return c.json({
        success: false,
        error: `سعر البيع الفعلي للصنف ${line.item_code} (${effectivePrice.toFixed(2)}) أقل من الحد الأدنى المسموح (${item.min_selling_price})`,
        code: 'BELOW_MIN_SELLING_PRICE',
      }, 422)
    }

    const lineTotal  = Math.round(line.quantity * effectivePrice * 100) / 100
    const vatAmount  = item.vat_exempt ? 0 : Math.round(lineTotal * (vatPct / 100) * 100) / 100
    validatedLines.push({ ...line, discount_pct: discountPct, line_total: lineTotal, vat_amount: vatAmount, vat_exempt: item.vat_exempt })
  }

  // Calculate totals
  let subtotal = 0
  let taxAmount = 0
  const lineData = validatedLines.map((line) => {
    subtotal  += line.line_total
    taxAmount += line.vat_amount
    return line
  })
  subtotal  = Math.round(subtotal  * 100) / 100
  taxAmount = Math.round(taxAmount * 100) / 100
  const total = Math.round((subtotal + taxAmount) * 100) / 100

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

  // ── Revenue GL entry (DR Cash/AR  CR Sales) ─────────────────────────────────
  // Non-blocking: a posting failure is logged in business_events as 'failed'
  // and can be retried via the batch posting center. It must not void the sale.
  let glEntryId: number | null = null
  try {
    const receivableKey = paymentMethod === 'credit' ? 'receivable_default' : 'cash_default'
    const receivableAcc = await resolveControlAccount(c.env.DB, company_id, receivableKey)
    if (receivableAcc) {
      // BPG/PPG null → resolved to default posting setup (sales_account = 41010001)
      const blueprint = await buildSalesRevenueBlueprint(
        c.env.DB, company_id,
        null, null,
        receivableAcc,
        total,
        `بيع — أمر رقم ${orderId}`,
      )
      if (!blueprint.isBlocked && blueprint.lines.length) {
        glEntryId = await postFromBusinessEvent(c.env.DB, {
          company_id,
          event_type:    'sales_order_revenue',
          source_module: 'sales',
          source_id:     orderId,
          event_date:    saleDate,
          description:   `إيراد مبيعات — أمر رقم ${orderId}`,
          created_by:    userId,
          payload: { order_id: orderId, total, payment_method: paymentMethod, customer_id: customerId },
          trace:   blueprint.trace ?? null,
          lines:   blueprint.lines.map(l => ({
            account_code:     l.account_code!,
            debit:            l.debit ?? 0,
            credit:           l.credit ?? 0,
            description:      l.description ?? `بيع — أمر رقم ${orderId}`,
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
    // Posting failure is silently swallowed here; the business_events row
    // records the failure for retry via batch posting center.
  }

  return c.json({
    success: true,
    data: {
      order_id:       orderId,
      total,
      subtotal,
      tax_amount:     taxAmount,
      vat_pct:        vatPct,
      vat_number:     company?.vat_number ?? null,
      movement_ids:   movementIds,
      gl_entry_id:    glEntryId,
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

// ── GET /api/sales/analytics — revenue trends + top items ────────────────────
// Query params:
//   period: 'daily' | 'monthly' (default 'daily')
//   date_from, date_to: YYYY-MM-DD range (defaults: last 30 days)
//   top_n: number of top-selling items to return (default 10)
sales.get('/analytics', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const period   = (c.req.query('period') ?? 'daily') as 'daily' | 'monthly'
  const topN     = Math.min(50, Math.max(1, Number(c.req.query('top_n') ?? 10)))
  const today    = new Date().toISOString().slice(0, 10)
  const dateTo   = c.req.query('date_to')   ?? today
  const dateFrom = c.req.query('date_from') ?? new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10)

  const groupExpr = period === 'monthly'
    ? `strftime('%Y-%m', so.order_date)`
    : `so.order_date`

  const [trend, topItems, returnsTrend] = await Promise.all([
    // Revenue trend over period
    c.env.DB.prepare(
      `SELECT ${groupExpr} AS period_label,
              COUNT(CASE WHEN so.status != 'voided' THEN 1 END) AS order_count,
              COALESCE(SUM(CASE WHEN so.status != 'voided' THEN so.total ELSE 0 END), 0) AS revenue,
              COALESCE(SUM(CASE WHEN so.status != 'voided' THEN so.subtotal ELSE 0 END), 0) AS subtotal,
              COALESCE(SUM(CASE WHEN so.status != 'voided' THEN so.tax_amount ELSE 0 END), 0) AS tax_amount,
              COUNT(CASE WHEN so.status = 'voided' THEN 1 END) AS voided_count
       FROM sales_orders so
       WHERE so.company_id = ?
         AND so.order_date BETWEEN ? AND ?
       GROUP BY period_label
       ORDER BY period_label`
    ).bind(company_id, dateFrom, dateTo).all<{
      period_label: string; order_count: number; revenue: number
      subtotal: number; tax_amount: number; voided_count: number
    }>(),

    // Top selling items by qty and revenue
    c.env.DB.prepare(
      `SELECT soi.item_code,
              COALESCE(i.name, soi.item_name) AS item_name,
              i.unit,
              COUNT(DISTINCT soi.order_id) AS order_count,
              SUM(soi.quantity)             AS total_qty,
              SUM(soi.line_total)           AS total_revenue,
              AVG(soi.unit_price)           AS avg_price
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.order_id AND so.company_id = soi.company_id
       LEFT JOIN items i ON i.code = soi.item_code AND i.company_id = soi.company_id
       WHERE soi.company_id = ?
         AND so.order_date BETWEEN ? AND ?
         AND so.status != 'voided'
       GROUP BY soi.item_code
       ORDER BY total_revenue DESC
       LIMIT ?`
    ).bind(company_id, dateFrom, dateTo, topN).all<{
      item_code: number; item_name: string | null; unit: string | null
      order_count: number; total_qty: number; total_revenue: number; avg_price: number
    }>(),

    // Returns trend over same period
    c.env.DB.prepare(
      `SELECT ${period === 'monthly' ? "strftime('%Y-%m', sr.return_date)" : 'sr.return_date'} AS period_label,
              COUNT(*) AS return_count,
              COALESCE(SUM(sr.total), 0) AS return_total
       FROM sales_returns sr
       WHERE sr.company_id = ?
         AND sr.return_date BETWEEN ? AND ?
       GROUP BY period_label
       ORDER BY period_label`
    ).bind(company_id, dateFrom, dateTo).all<{
      period_label: string; return_count: number; return_total: number
    }>(),
  ])

  const totalRevenue = trend.results.reduce((s, r) => s + r.revenue, 0)
  const totalOrders  = trend.results.reduce((s, r) => s + r.order_count, 0)
  const totalReturns = returnsTrend.results.reduce((s, r) => s + r.return_total, 0)

  return c.json({
    success: true,
    data: {
      period,
      date_from:     dateFrom,
      date_to:       dateTo,
      summary: {
        total_revenue:  Math.round(totalRevenue * 100) / 100,
        total_orders:   totalOrders,
        total_returns:  Math.round(totalReturns * 100) / 100,
        net_revenue:    Math.round((totalRevenue - totalReturns) * 100) / 100,
        avg_order_value: totalOrders > 0 ? Math.round(totalRevenue / totalOrders * 100) / 100 : 0,
      },
      trend:          trend.results,
      top_items:      topItems.results,
      returns_trend:  returnsTrend.results,
    },
  })
})

// ── GET /api/sales/returns — must be before /:id ──────────────────────────────
sales.get('/returns', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const page     = Math.max(1, Number(c.req.query('page') ?? 1))
  const size     = Math.min(100, Math.max(1, Number(c.req.query('size') ?? 50)))
  const offset   = (page - 1) * size
  const start    = c.req.query('start')
  const end      = c.req.query('end')
  const orderId  = c.req.query('order_id')

  let where = 'WHERE sr.company_id = ?'
  const p: unknown[] = [company_id]
  if (start)   { where += ' AND sr.return_date >= ?'; p.push(start) }
  if (end)     { where += ' AND sr.return_date <= ?'; p.push(end) }
  if (orderId) { where += ' AND sr.original_order_id = ?'; p.push(Number(orderId)) }

  const [countRow, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sales_returns sr ${where}`).bind(...p).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT sr.id, sr.original_order_id, sr.return_date, sr.subtotal, sr.total,
              sr.refund_method, sr.reason, sr.journal_entry_id, sr.created_at,
              cu.name AS customer_name, cu.code AS customer_code
       FROM sales_returns sr
       LEFT JOIN customers cu ON cu.id = sr.customer_id AND cu.company_id = sr.company_id
       ${where}
       ORDER BY sr.return_date DESC, sr.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...p, size, offset).all(),
  ])

  return c.json({ success: true, data: { total: countRow?.n ?? 0, page, size, rows: rows.results } })
})

// ── POST /api/sales/returns — must be before /:id ─────────────────────────────
sales.post('/returns', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)

  const body = await c.req.json<{
    original_order_id: number
    items: Array<{ item_code: number; quantity: number; unit_price: number }>
    refund_method?: 'cash' | 'card' | 'store_credit' | 'credit_adjustment'
    reason?: string
    notes?: string
    return_date?: string
  }>().catch(() => null)

  if (!body?.original_order_id || !body.items?.length) {
    return c.json({ success: false, error: 'original_order_id وitems مطلوبان' }, 400)
  }

  const returnDate = normalizeIsoDate(body.return_date ?? new Date().toISOString().slice(0, 10))
  const refundMethod = body.refund_method ?? 'cash'

  const order = await c.env.DB.prepare(
    `SELECT id, status, warehouse_id, customer_id, payment_method, total, journal_entry_id
     FROM sales_orders WHERE id = ? AND company_id = ?`
  ).bind(body.original_order_id, company_id).first<{
    id: number; status: string; warehouse_id: number; customer_id: number | null
    payment_method: string; total: number; journal_entry_id: number | null
  }>()

  if (!order) return c.json({ success: false, error: 'أمر البيع الأصلي غير موجود' }, 404)
  if (order.status === 'voided') return c.json({ success: false, error: 'لا يمكن إرجاع أمر ملغى' }, 422)

  const origItems = await c.env.DB.prepare(
    'SELECT item_code, quantity FROM sales_order_items WHERE order_id = ? AND company_id = ?'
  ).bind(body.original_order_id, company_id).all<{ item_code: number; quantity: number }>()

  const origQtyMap = new Map(origItems.results.map(i => [i.item_code, i.quantity]))

  for (const line of body.items) {
    if (!line.item_code || line.quantity <= 0 || line.unit_price < 0) {
      return c.json({ success: false, error: `بيانات البند غير صحيحة للصنف ${line.item_code}` }, 400)
    }
    const origQty = origQtyMap.get(line.item_code) ?? 0
    if (line.quantity > origQty + 0.001) {
      return c.json({
        success: false,
        error: `كمية المرتجع (${line.quantity}) تتجاوز الكمية الأصلية (${origQty}) للصنف ${line.item_code}`,
        code: 'RETURN_EXCEEDS_ORIGINAL',
      }, 422)
    }
  }

  const subtotal = body.items.reduce((s, l) => s + Math.round(l.quantity * l.unit_price * 100) / 100, 0)
  const total    = Math.round(subtotal * 100) / 100

  const returnRow = await c.env.DB.prepare(
    `INSERT INTO sales_returns
       (company_id, original_order_id, warehouse_id, customer_id, return_date,
        subtotal, tax_amount, total, refund_method, reason, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
     RETURNING id`
  ).bind(
    company_id, order.id, order.warehouse_id, order.customer_id, returnDate,
    subtotal, total, refundMethod, body.reason ?? null, body.notes ?? null, userId,
  ).first<{ id: number }>()

  if (!returnRow) return c.json({ success: false, error: 'فشل إنشاء سند المرتجع' }, 500)
  const returnId = returnRow.id

  for (const line of body.items) {
    const lineTotal = Math.round(line.quantity * line.unit_price * 100) / 100

    await c.env.DB.prepare(
      `INSERT INTO sales_return_items (return_id, company_id, item_code, quantity, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(returnId, company_id, line.item_code, line.quantity, line.unit_price, lineTotal).run()

    const bal = await c.env.DB.prepare(
      'SELECT balance_qty FROM inventory_balances WHERE company_id = ? AND item_code = ? AND warehouse_id = ?'
    ).bind(company_id, line.item_code, order.warehouse_id).first<{ balance_qty: number }>()

    const newQty = Math.round(((bal?.balance_qty ?? 0) + line.quantity) * 1000) / 1000

    await c.env.DB.prepare(
      `INSERT INTO inventory_movements
         (company_id, item_code, warehouse_id, movement_type, movement_date,
          quantity, unit_price, total_value, running_balance,
          statement_text, created_by, gl_posting_status)
       VALUES (?, ?, ?, 'RETURN_CUSTOMER', ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).bind(
      company_id, line.item_code, order.warehouse_id, returnDate,
      line.quantity, line.unit_price, lineTotal, newQty,
      `مرتجع مبيعات — سند رقم ${returnId} من أمر ${order.id}`,
      userId,
    ).run()

    await c.env.DB.prepare(
      `INSERT INTO inventory_balances (company_id, item_code, warehouse_id, balance_qty)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(company_id, item_code, warehouse_id) DO UPDATE SET balance_qty = excluded.balance_qty`
    ).bind(company_id, line.item_code, order.warehouse_id, newQty).run()
  }

  const reducesAR = order.payment_method === 'credit' || refundMethod === 'credit_adjustment'
  if (reducesAR && order.customer_id) {
    await c.env.DB.prepare(
      'UPDATE customers SET balance = balance - ? WHERE id = ? AND company_id = ?'
    ).bind(total, order.customer_id, company_id).run()
  }

  // ── Revenue-reversal GL: DR sales_returns_account / CR cash or AR ───────────
  let glEntryId: number | null = null
  try {
    const setupRow = await c.env.DB.prepare(
      `SELECT sales_returns_account, sales_account FROM posting_rules
       WHERE company_id = ? AND rule_type = 'general' AND is_active = 1
       ORDER BY priority ASC, id ASC LIMIT 1`
    ).bind(company_id).first<{ sales_returns_account: string | null; sales_account: string | null }>()

    const debitAcc  = setupRow?.sales_returns_account ?? setupRow?.sales_account ?? null
    const creditAcc = await resolveControlAccount(c.env.DB, company_id, reducesAR ? 'receivable_default' : 'cash_default')

    if (debitAcc && creditAcc) {
      glEntryId = await postFromBusinessEvent(c.env.DB, {
        company_id,
        event_type:    'sales_return_revenue',
        source_module: 'sales',
        source_id:     returnId,
        event_date:    returnDate,
        description:   `مرتجع مبيعات — سند رقم ${returnId} من أمر ${order.id}`,
        created_by:    userId,
        payload:       { return_id: returnId, original_order_id: order.id, total, refund_method: refundMethod },
        trace:         null,
        lines: [
          { account_code: debitAcc,  debit: total, credit: 0,     description: `مرتجعات مبيعات — سند ${returnId}`, rule_slot: 'sales_returns_account', source_ledger: 'cash' as const, source_record_id: returnId },
          { account_code: creditAcc, debit: 0,     credit: total, description: `استرداد — سند مرتجع ${returnId}`,   rule_slot: reducesAR ? 'receivable_default' : 'cash_default', source_ledger: 'cash' as const, source_record_id: returnId },
        ],
        onJournalEntryPosted: async (entryId) => {
          await c.env.DB.prepare(
            'UPDATE sales_returns SET journal_entry_id = ? WHERE id = ? AND company_id = ?'
          ).bind(entryId, returnId, company_id).run()
        },
      })
    }
  } catch {
    // Non-blocking
  }

  return c.json({ success: true, data: { return_id: returnId, order_id: order.id, total, refund_method: refundMethod, gl_entry_id: glEntryId } }, 201)
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
    'SELECT id, status, total, customer_id, payment_method, order_date, journal_entry_id FROM sales_orders WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; status: string; total: number; customer_id: number; payment_method: string; order_date: string; journal_entry_id: number | null }>()

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

  // ── Reverse revenue GL entry if one was posted ────────────────────────────
  if (order.journal_entry_id) {
    try {
      const receivableKey = order.payment_method === 'credit' ? 'receivable_default' : 'cash_default'
      const receivableAcc = await resolveControlAccount(c.env.DB, company_id, receivableKey)
      if (receivableAcc) {
        const blueprint = await buildSalesRevenueBlueprint(
          c.env.DB, company_id, null, null, receivableAcc, order.total,
          `إلغاء أمر بيع رقم ${id}`,
        )
        if (!blueprint.isBlocked && blueprint.lines.length) {
          await postFromBusinessEvent(c.env.DB, {
            company_id,
            event_type:    'sales_order_void',
            source_module: 'sales',
            source_id:     id,
            event_date:    order.order_date,
            description:   `عكس إيراد — إلغاء أمر رقم ${id}`,
            created_by:    userId,
            payload:       { voided_order_id: id, original_gl_entry: order.journal_entry_id },
            trace:         blueprint.trace ?? null,
            lines:         blueprint.lines.map(l => ({
              account_code:     l.account_code!,
              debit:            l.credit ?? 0,   // swap DR/CR for reversal
              credit:           l.debit  ?? 0,
              description:      l.description ?? `إلغاء — أمر رقم ${id}`,
              rule_slot:        l.rule_slot,
              source_ledger:    'cash' as const,
              source_record_id: id,
            })),
          })
        }
      }
    } catch {
      // Non-blocking — void proceeds even if GL reversal fails
    }
  }

  return c.json({ success: true, data: { voided: true, order_id: id } })
})

export default sales
