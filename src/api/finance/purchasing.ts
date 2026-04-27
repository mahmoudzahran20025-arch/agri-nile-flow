import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'
import { getOpenPeriod } from '../../lib/gl'
import { FinanceCore } from '../../lib/finance_core'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const purchasing = new Hono<{ Bindings: Env }>()

const poStatusSchema = z.object({
  status: z.enum(['sent', 'partial', 'received', 'cancelled', 'closed']),
  notes: z.string().optional().nullable(),
})

const poCreateSchema = z.object({
  po_number: z.string().optional().nullable(),
  supplier_code: z.number().optional().nullable(),
  supplier_name: z.string().optional().nullable(),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ خاطئة'),
  expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    item_code: z.union([z.string(), z.number()]).optional().nullable(),
    item_name: z.string().min(2, 'اسم الصنف قصير جداً'),
    unit: z.string().optional().nullable(),
    qty_ordered: z.number().positive('الكمية يجب أن تكون موجبة'),
    unit_price: z.number().nonnegative('السعر لا يمكن أن يكون سالباً'),
    center_code: z.number().optional().nullable(),
    notes: z.string().optional().nullable(),
  })).min(1, 'يجب إضافة صنف واحد على الأقل'),
})

// ═══════════════════════════════════════════════════════════
// PURCHASE ORDERS — طلبات الشراء
// ═══════════════════════════════════════════════════════════

purchasing.get('/purchase-orders', async (c) => {
  const { company_id } = getUser(c)
  const status = c.req.query('status')
  const page   = Math.max(1, Number(c.req.query('page') ?? 1))
  const size   = Math.min(100, Number(c.req.query('size') ?? 50))
  const offset = (page - 1) * size

  let where = 'WHERE po.company_id = ?'
  const p: unknown[] = [company_id]
  if (status) { where += ' AND po.status = ?'; p.push(status) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT po.*,
              u1.full_name AS requested_by_name,
              u2.full_name AS approved_by_name,
              s.name       AS supplier_name_resolved,
              (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = po.id) AS item_count
       FROM purchase_orders po
       LEFT JOIN users    u1 ON u1.id = po.requested_by
       LEFT JOIN users    u2 ON u2.id = po.approved_by
       LEFT JOIN suppliers s  ON s.code = po.supplier_code AND s.company_id = po.company_id
       ${where}
       ORDER BY po.order_date DESC, po.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...p, size, offset).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM purchase_orders po ${where}`
    ).bind(...p).first<{n:number}>(),
  ])
  return c.json({ success: true, data: rows.results, total: cnt?.n ?? 0, page, page_size: size })
})

purchasing.get('/purchase-orders/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const [po, items] = await Promise.all([
    c.env.DB.prepare(
      `SELECT po.*, u1.full_name AS requested_by_name, u2.full_name AS approved_by_name,
              s.name AS supplier_name_resolved
       FROM purchase_orders po
       LEFT JOIN users    u1 ON u1.id = po.requested_by
       LEFT JOIN users    u2 ON u2.id = po.approved_by
       LEFT JOIN suppliers s  ON s.code = po.supplier_code AND s.company_id = po.company_id
       WHERE po.id = ? AND po.company_id = ?`
    ).bind(id, company_id).first(),
    c.env.DB.prepare(
      'SELECT * FROM purchase_order_items WHERE po_id = ? AND company_id = ? ORDER BY id'
    ).bind(id, company_id).all(),
  ])
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)
  return c.json({ success: true, data: { ...po, items: items.results } })
})

purchasing.post('/purchase-orders', zValidator('json', poCreateSchema), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = c.req.valid('json')

  const poNumber = b.po_number ?? await (async () => {
    const yr = new Date(b.order_date).getFullYear()
    const cnt = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM purchase_orders WHERE company_id = ? AND order_date LIKE ?`
    ).bind(company_id, `${yr}%`).first<{n:number}>()
    return `PO-${yr}-${String((cnt?.n ?? 0) + 1).padStart(4, '0')}`
  })()

  const totalAmount = b.items.reduce((s, i) => s + i.qty_ordered * i.unit_price, 0)

  const poRes = await c.env.DB.prepare(
    `INSERT INTO purchase_orders
     (company_id, po_number, supplier_code, supplier_name, order_date,
      expected_date, total_amount, notes, requested_by, created_by, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,'draft')`
  ).bind(
    company_id, poNumber, b.supplier_code ?? null,
    b.supplier_name ?? null, b.order_date,
    b.expected_date ?? null, totalAmount, b.notes ?? null, userId, userId
  ).run()

  const poId = poRes.meta.last_row_id

  const itemStmts = b.items.map(i =>
    c.env.DB.prepare(
      `INSERT INTO purchase_order_items
       (po_id, company_id, item_code, item_name, unit, qty_ordered, unit_price, center_code, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(poId, company_id, i.item_code ?? null, i.item_name, i.unit ?? null,
           i.qty_ordered, i.unit_price, i.center_code ?? null, i.notes ?? null)
  )
  await c.env.DB.batch(itemStmts)

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'purchase_orders', record_id: poId,
    new_value: { po_number: poNumber, total: totalAmount, items: b.items.length },
  })

  return c.json({ success: true, data: { id: poId, po_number: poNumber } }, 201)
})

purchasing.patch('/purchase-orders/:id/status', zValidator('json', poStatusSchema), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id   = Number(c.req.param('id'))
  const b    = c.req.valid('json')
  const { status, notes } = b

  const po = await c.env.DB
    .prepare('SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string }>()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)

  if (['cancelled','closed'].includes(po.status)) {
    return c.json({ success: false, error: `لا يمكن تعديل طلب شراء ${po.status}` }, 400)
  }

  let extra = ''
  const extraBinds: unknown[] = []
  if (status === 'received') {
    extra = ", received_by = ?, received_at = datetime('now')"
    extraBinds.push(userId)
  }
  if (status === 'sent' && po.status === 'draft') {
    extra = ", approved_by = ?, approved_at = datetime('now')"
    extraBinds.push(userId)
  }

  await c.env.DB.prepare(
    `UPDATE purchase_orders
     SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now')${extra}
     WHERE id = ? AND company_id = ?`
  ).bind(status, notes ?? null, ...extraBinds, id, company_id).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'purchase_orders', record_id: id,
    new_value: { status },
  })

  return c.json({ success: true, data: null })
})

purchasing.patch('/purchase-orders/:id/receive', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { items } = await c.req.json<{
    items: Array<{ item_id: number; qty_received: number; warehouse?: string }>
  }>()

  if (!items?.length) return c.json({ success: false, error: 'البنود مطلوبة' }, 400)

  const po = await c.env.DB
    .prepare('SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string }>()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)
  if (['cancelled','closed'].includes(po.status)) {
    return c.json({ success: false, error: 'لا يمكن استلام طلب ملغي أو مغلق' }, 400)
  }

  const today = new Date().toISOString().slice(0, 10)
  const periodId = await getOpenPeriod(c.env.DB, company_id, today)
  if (!periodId) {
    return c.json({ success: false,
      error: `لا توجد فترة مالية مفتوحة للتاريخ ${today} — تحقق من إعدادات الفترات المالية` }, 400)
  }

  const receiveRows: Array<{
    po_item_id: number
    item_code: number
    item_name: string
    qty_received: number
    unit_price: number
    warehouse: string
  }> = []

  for (const recv of items.filter(i => i.qty_received > 0)) {
    const poItem = await c.env.DB.prepare(
      `SELECT id, item_code, item_name, unit_price, warehouse
       FROM purchase_order_items
       WHERE id = ? AND po_id = ? AND company_id = ?`
    ).bind(recv.item_id, id, company_id).first<{
      id: number
      item_code: string | null
      item_name: string
      unit_price: number
      warehouse: string | null
    }>()

    if (!poItem) {
      return c.json({ success: false, error: `بند الاستلام ${recv.item_id} غير موجود في أمر الشراء` }, 404)
    }

    const warehouse = (recv.warehouse ?? poItem.warehouse ?? '').trim()
    const itemCodeNum = poItem.item_code ? Number(poItem.item_code) : NaN
    if (!warehouse || isNaN(itemCodeNum) || itemCodeNum <= 0) {
      return c.json({ success: false, error: `بيانات البند ${recv.item_id} غير مكتملة (المخزن أو كود الصنف)` }, 400)
    }

    receiveRows.push({
      po_item_id: poItem.id,
      item_code: itemCodeNum,
      item_name: poItem.item_name,
      qty_received: recv.qty_received,
      unit_price: poItem.unit_price ?? 0,
      warehouse,
    })
  }

  if (!receiveRows.length) {
    return c.json({ success: false, error: 'لا توجد كميات صالحة للاستلام' }, 400)
  }

  try {
    const result = await FinanceCore.processPOReceipt(c.env.DB, {
      company_id,
      userId,
      po_id: id,
      received_date: today,
      items: receiveRows,
    })

    return c.json({ success: true, data: { status: result.status, received_items: result.movements } })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'فشل استلام أمر الشراء'
    return c.json({ success: false, error: message }, 400)
  }
})

// ═══════════════════════════════════════════════════════════
// CASH TRANSACTION SEARCH — for bank statement matching
// ═══════════════════════════════════════════════════════════

purchasing.get('/cash-tx-search', async (c) => {
  const { company_id } = getUser(c)
  const q         = c.req.query('q') ?? ''
  const direction = c.req.query('direction')

  let where = `
    WHERE ct.company_id = ?
    AND ct.id NOT IN (
      SELECT DISTINCT bs.matched_tx_id FROM bank_statements bs
      WHERE bs.matched_tx_id IS NOT NULL AND bs.company_id = ?
    )`
  const binds: unknown[] = [company_id, company_id]

  if (q.length >= 2) {
    where += ' AND (ct.narration LIKE ? OR ct.recipient_name LIKE ?)'
    binds.push(`%${q}%`, `%${q}%`)
  }
  if (direction) { where += ' AND ct.direction = ?'; binds.push(direction) }

  const { results } = await c.env.DB.prepare(
    `SELECT ct.id, ct.transaction_date, ct.direction, ct.narration,
            ct.recipient_name, ct.amount, ct.document_number, ct.running_balance
     FROM cash_transactions ct
     ${where}
     ORDER BY ct.transaction_date DESC, ct.id DESC
     LIMIT 60`
  ).bind(...binds).all()

  return c.json({ success: true, data: results })
})

// ═══════════════════════════════════════════════════════════
// SUPPLIER INVOICES — المطابقة الثلاثية (PO → GR → Invoice)
// ═══════════════════════════════════════════════════════════

purchasing.get('/purchase-orders/:id/match', async (c) => {
  const { company_id } = getUser(c)
  const poId = Number(c.req.param('id'))

  const po = await c.env.DB.prepare(
    'SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?'
  ).bind(poId, company_id).first()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)

  const [items, invoices] = await Promise.all([
    c.env.DB.prepare(
      'SELECT * FROM purchase_order_items WHERE po_id = ? AND company_id = ? ORDER BY id'
    ).bind(poId, company_id).all(),

    c.env.DB.prepare(`
      SELECT si.id AS invoice_id, si.invoice_number, si.invoice_date,
             si.total_amount, si.notes AS invoice_notes,
             sii.po_item_id, sii.qty_invoiced, sii.unit_price AS invoice_unit_price
      FROM supplier_invoices si
      JOIN supplier_invoice_items sii ON sii.invoice_id = si.id
      WHERE si.po_id = ? AND si.company_id = ?
      ORDER BY si.invoice_date DESC, si.id DESC
    `).bind(poId, company_id).all<{
      invoice_id: number; invoice_number: string; invoice_date: string
      total_amount: number; invoice_notes: string | null
      po_item_id: number; qty_invoiced: number; invoice_unit_price: number
    }>(),
  ])

  const invoicedByItem = new Map<number, { qty: number; price: number; invoice_id: number; invoice_number: string }>()
  for (const row of invoices.results) {
    const existing = invoicedByItem.get(row.po_item_id)
    if (existing) {
      existing.qty += row.qty_invoiced
    } else {
      invoicedByItem.set(row.po_item_id, {
        qty:            row.qty_invoiced,
        price:          row.invoice_unit_price,
        invoice_id:     row.invoice_id,
        invoice_number: row.invoice_number,
      })
    }
  }

  const matchRows = (items.results as Array<{
    id: number; item_name: string; unit: string | null
    qty_ordered: number; qty_received: number; unit_price: number
  }>).map(item => {
    const inv = invoicedByItem.get(item.id)
    const qtyInv  = inv?.qty   ?? 0
    const priceInv = inv?.price ?? item.unit_price

    let match_status: 'matched' | 'price_variance' | 'qty_variance' | 'over_invoiced' | 'pending_invoice' | 'no_gr'
    if (item.qty_received === 0) {
      match_status = 'no_gr'
    } else if (qtyInv === 0) {
      match_status = 'pending_invoice'
    } else if (qtyInv > item.qty_received) {
      match_status = 'over_invoiced'
    } else if (Math.abs(qtyInv - item.qty_received) > 0.001) {
      match_status = 'qty_variance'
    } else if (Math.abs(priceInv - item.unit_price) > 0.01) {
      match_status = 'price_variance'
    } else {
      match_status = 'matched'
    }

    return {
      po_item_id:     item.id,
      item_name:      item.item_name,
      unit:           item.unit,
      qty_ordered:    item.qty_ordered,
      qty_received:   item.qty_received,
      qty_invoiced:   qtyInv,
      po_unit_price:  item.unit_price,
      inv_unit_price: priceInv,
      match_status,
      invoice_id:     inv?.invoice_id     ?? null,
      invoice_number: inv?.invoice_number ?? null,
    }
  })

  const uniqueInvoices = [...new Map(
    invoices.results.map(r => [r.invoice_id, {
      id: r.invoice_id, number: r.invoice_number,
      date: r.invoice_date, total: r.total_amount,
    }])
  ).values()]

  return c.json({ success: true, data: { po, match_rows: matchRows, invoices: uniqueInvoices } })
})

purchasing.post('/purchase-orders/:id/invoices', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const poId = Number(c.req.param('id'))

  const b = await c.req.json<{
    invoice_number: string; invoice_date: string; notes?: string
    items: Array<{ po_item_id: number; qty_invoiced: number; unit_price: number }>
  }>()

  if (!b.invoice_number || !b.invoice_date || !b.items?.length) {
    return c.json({ success: false, error: 'رقم الفاتورة والتاريخ والبنود مطلوبة' }, 400)
  }

  const dupCheck = await c.env.DB.prepare(
    'SELECT id FROM supplier_invoices WHERE company_id = ? AND invoice_number = ?'
  ).bind(company_id, b.invoice_number).first()
  if (dupCheck) {
    return c.json({ success: false, error: `رقم الفاتورة "${b.invoice_number}" مستخدم مسبقاً` }, 409)
  }

  const po = await c.env.DB.prepare(
    'SELECT id, supplier_code FROM purchase_orders WHERE id = ? AND company_id = ?'
  ).bind(poId, company_id).first<{ id: number; supplier_code: number | null }>()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)

  const periodId = await getOpenPeriod(c.env.DB, company_id, b.invoice_date)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.invoice_date}` }, 400)
  }

  for (const item of b.items) {
    const poItem = await c.env.DB.prepare(
      `SELECT item_name, qty_received, (SELECT COALESCE(SUM(qty_invoiced),0) FROM supplier_invoice_items WHERE po_item_id = ?) AS already_invoiced
       FROM purchase_order_items WHERE id = ? AND po_id = ? AND company_id = ?`
    ).bind(item.po_item_id, item.po_item_id, poId, company_id).first<{ item_name: string; qty_received: number; already_invoiced: number }>()

    if (!poItem) return c.json({ success: false, error: `البند ${item.po_item_id} غير موجود` }, 404)

    const remainingToInvoice = poItem.qty_received - poItem.already_invoiced
    if (item.qty_invoiced > remainingToInvoice) {
      return c.json({
        success: false,
        error: `الكمية المفوترة (${item.qty_invoiced}) تتجاوز المتبقي من الاستلام (${remainingToInvoice}) لبند ${poItem.item_name}. المطابقة الثلاثية مطلوبة.`
      }, 409)
    }
  }

  const totalAmount = b.items.reduce((s, i) => s + i.qty_invoiced * i.unit_price, 0)

  const invRes = await c.env.DB.prepare(
    `INSERT INTO supplier_invoices
     (company_id, po_id, invoice_number, invoice_date, supplier_code, total_amount, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(company_id, poId, b.invoice_number, b.invoice_date,
         po.supplier_code ?? null, totalAmount, b.notes ?? null, userId).run()

  const invoiceId = invRes.meta.last_row_id

  await c.env.DB.batch(b.items.map(i =>
    c.env.DB.prepare(
      `INSERT INTO supplier_invoice_items (invoice_id, po_item_id, company_id, qty_invoiced, unit_price)
       VALUES (?,?,?,?,?)`
    ).bind(invoiceId, i.po_item_id, company_id, i.qty_invoiced, i.unit_price)
  ))

  const glEntryId = await FinanceCore.resolveSupplierInvoice(c.env.DB, {
    company_id,
    ref_id: invoiceId,
    supplier_code: po.supplier_code ?? null,
    amount: totalAmount,
    date: b.invoice_date,
    description: `فاتورة مورد: ${b.invoice_number}`,
    created_by: userId,
  })

  if (glEntryId) {
    await c.env.DB.prepare('UPDATE supplier_invoices SET journal_entry_id = ? WHERE id = ?')
      .bind(glEntryId, invoiceId).run()
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'supplier_invoices', record_id: invoiceId,
    new_value: { po_id: poId, invoice_number: b.invoice_number, total: totalAmount, gl_entry_id: glEntryId },
  })

  return c.json({ success: true, data: { id: invoiceId, gl_entry_id: glEntryId } }, 201)
})

// ═══════════════════════════════════════════════════════════
// AP AGING — شيخوخة الذمم الدائنة
// ═══════════════════════════════════════════════════════════

purchasing.get('/ap-aging', async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(`
    SELECT
      si.id,
      si.invoice_number,
      si.invoice_date,
      si.supplier_code,
      COALESCE(si.due_date_days, 30)             AS due_date_days,
      DATE(si.invoice_date, '+' || COALESCE(si.due_date_days,30) || ' days') AS due_date,
      si.total_amount,
      COALESCE(si.paid_amount, 0)                AS paid_amount,
      si.total_amount - COALESCE(si.paid_amount, 0) AS outstanding,
      si.payment_date,
      si.payment_ref,
      po.po_number,
      COALESCE(s.name, po.supplier_name)         AS supplier_name,
      COALESCE(CAST(
        julianday('now') -
        julianday(DATE(si.invoice_date, '+' || COALESCE(si.due_date_days,30) || ' days'))
        AS INTEGER
      ), 0) AS days_overdue
    FROM supplier_invoices si
    LEFT JOIN purchase_orders po ON po.id = si.po_id AND po.company_id = si.company_id
    LEFT JOIN suppliers s ON s.code = si.supplier_code AND s.company_id = si.company_id
    WHERE si.company_id = ?
      AND si.total_amount > COALESCE(si.paid_amount, 0)
    ORDER BY due_date ASC
  `).bind(company_id).all()

  return c.json({ success: true, data: results })
})

// ═══════════════════════════════════════════════════════════
// SUPPLIER INVOICE PAYMENT
// ═══════════════════════════════════════════════════════════

purchasing.patch('/supplier-invoices/:id/pay', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{
    paid_amount: number; payment_date?: string; payment_ref?: string
  }>()

  const inv = await c.env.DB.prepare(
    `SELECT id, invoice_number, total_amount, COALESCE(paid_amount,0) AS paid_amount,
            supplier_code, payment_date, payment_ref
     FROM supplier_invoices WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).first<{
    id: number; invoice_number: string; total_amount: number; paid_amount: number
    supplier_code: number | null; payment_date: string | null; payment_ref: string | null
  }>()
  if (!inv) return c.json({ success: false, error: 'الفاتورة غير موجودة' }, 404)

  const paymentAmount = Math.min(
    Number(b.paid_amount) || 0,
    inv.total_amount - inv.paid_amount,
  )
  if (paymentAmount <= 0) {
    return c.json({ success: false, error: 'لا يوجد مبلغ صالح للدفع — الفاتورة مسددة بالكامل' }, 400)
  }

  const today = b.payment_date ?? new Date().toISOString().slice(0, 10)
  const narration = `سداد فاتورة مورد #${inv.invoice_number}${b.payment_ref ? ` (${b.payment_ref})` : ''}`

  try {
    await FinanceCore.recordCashMovement(c.env.DB, {
      company_id,
      userId,
      transaction_date: today,
      direction: 'م',
      amount: paymentAmount,
      narration,
      supplier_code: inv.supplier_code ?? undefined,
      status: 'posted',
    })

    await c.env.DB.prepare(
      `UPDATE supplier_invoices
       SET paid_amount    = paid_amount + ?,
           payment_date   = COALESCE(?, payment_date),
           payment_ref    = COALESCE(?, payment_ref)
       WHERE id = ? AND company_id = ?`
    ).bind(paymentAmount, b.payment_date ?? null, b.payment_ref ?? null, id, company_id).run()

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'فشل تسجيل الدفعة'
    return c.json({ success: false, error: msg }, 400)
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'supplier_invoices', record_id: id,
    new_value: { paid_amount: paymentAmount, payment_date: today },
  })

  return c.json({ success: true, data: null })
})

export default purchasing
