import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { getTodayIsoDate } from '../../lib/utils/date'
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

  const totalAmount = b.items.reduce((s, i) => s + i.qty_ordered * (i.unit_price || 0), 0)

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
    items: Array<{ item_id: number; qty_received: number; warehouse_id?: number }>
  }>()

  if (!items?.length) return c.json({ success: false, error: 'البنود مطلوبة' }, 400)

  const po = await c.env.DB
    .prepare('SELECT status FROM purchase_orders WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string }>()
  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)
  if (['cancelled','closed'].includes(po.status)) {
    return c.json({ success: false, error: 'لا يمكن استلام طلب ملغي أو مغلق' }, 400)
  }

  const today = getTodayIsoDate()
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
    warehouse_id: number
  }> = []

  for (const recv of items.filter(i => i.qty_received > 0)) {
    const poItem = await c.env.DB.prepare(
      `SELECT id, item_code, item_name, unit_price FROM purchase_order_items WHERE id = ? AND po_id = ? AND company_id = ?`
    ).bind(recv.item_id, id, company_id).first<{
      id: number
      item_code: string | null
      item_name: string
      unit_price: number
    }>()

    if (!poItem) {
      return c.json({ success: false, error: `بند الاستلام ${recv.item_id} غير موجود في أمر الشراء` }, 404)
    }

    const warehouseId = recv.warehouse_id
    if (!warehouseId) {
      return c.json({ success: false, error: `المخزن مطلوب للبند ${recv.item_id}` }, 400)
    }

    const itemCodeNum = poItem.item_code ? Number(poItem.item_code) : NaN
    if (isNaN(itemCodeNum) || itemCodeNum <= 0) {
      return c.json({ success: false, error: `بيانات البند ${recv.item_id} غير مكتملة (كود الصنف)` }, 400)
    }

    receiveRows.push({
      po_item_id: poItem.id,
      item_code: itemCodeNum,
      item_name: poItem.item_name,
      qty_received: recv.qty_received,
      unit_price: poItem.unit_price ?? 0,
      warehouse_id: warehouseId,
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

export default purchasing
