import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { FinanceCore } from '../../lib/finance_core'
import { logAudit } from '../../lib/audit'
import { resolveControlAccount } from '../../lib/posting_engine'

const receipts = new Hono<{ Bindings: Env }>()

async function resolveWarehouse(db: Env['DB'], companyId: number, id?: number, name?: string): Promise<{ id: number, name: string } | null> {
  if (id) {
    const wh = await db.prepare("SELECT id, name FROM warehouses WHERE id = ? AND company_id = ? AND is_active = 1").bind(id, companyId).first<{ id: number, name: string }>()
    return wh ?? null
  }
  if (name) {
    const wh = await db.prepare("SELECT id, name FROM warehouses WHERE name = ? AND company_id = ? AND is_active = 1").bind(name, companyId).first<{ id: number, name: string }>()
    return wh ?? null
  }
  return null
}

receipts.post('/receive-po/:po_id', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const poId = Number(c.req.param('po_id'))

  const b = await c.req.json<{
    received_date: string
    notes?: string
    items: Array<{
      po_item_id:   number
      qty_received: number
      warehouse?:    string
      warehouse_id?: number
      unit_price?:  number
    }>
  }>()

  if (!b.received_date || !Array.isArray(b.items) || b.items.length === 0) {
    return c.json({ success: false, error: 'التاريخ وبنود الاستلام مطلوبة' }, 400)
  }

  const po = await c.env.DB.prepare(
    'SELECT id, status, supplier_code FROM purchase_orders WHERE id = ? AND company_id = ?'
  ).bind(poId, company_id)
    .first<{ id: number; status: string; supplier_code: number | null }>()

  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)
  if (po.status === 'cancelled' || po.status === 'closed') {
    return c.json({ success: false, error: `لا يمكن استلام طلب بحالة: ${po.status}` }, 400)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, b.received_date)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.received_date}` }, 400)
  }

  try {
    await resolveControlAccount(c.env.DB, company_id, 'inventory')
    await resolveControlAccount(c.env.DB, company_id, 'accounts_payable')
  } catch {
    return c.json({ success: false, error: 'GL_MAPPING_MISSING: حسابات التحكم (المخزون/الموردين) غير مربوطة في posting_rules.' }, 400)
  }

  const enrichedLines: Array<{
    po_item_id: number; item_code: number; item_name: string
    qty_received: number; unit_price: number; warehouse_id: number
  }> = []

  for (const item of b.items) {
    const wh = await resolveWarehouse(c.env.DB, company_id, item.warehouse_id, item.warehouse)
    if (!wh) return c.json({ success: false, error: 'المخزن غير موجود أو غير نشط' }, 422)

    const poItem = await c.env.DB.prepare(
      `SELECT id, item_code, item_name, unit_price, qty_ordered, qty_received
       FROM purchase_order_items WHERE id = ? AND po_id = ? AND company_id = ?`
    ).bind(item.po_item_id, poId, company_id)
      .first<{ id: number; item_code: number; item_name: string; unit_price: number; qty_ordered: number; qty_received: number }>()

    if (!poItem) return c.json({ success: false, error: `البند ${item.po_item_id} غير موجود` }, 404)

    const remaining = poItem.qty_ordered - poItem.qty_received
    if (item.qty_received > remaining) {
      return c.json({ success: false, error: `الكمية المستلمة (${item.qty_received}) تتجاوز المتبقي (${remaining}) لبند ${poItem.item_name}` }, 409)
    }

    enrichedLines.push({
      po_item_id:   item.po_item_id,
      item_code:    poItem.item_code,
      item_name:    poItem.item_name,
      qty_received: item.qty_received,
      unit_price:   item.unit_price ?? poItem.unit_price,
      warehouse_id: wh.id
    })
  }

  const { movements, status: newStatus } = await FinanceCore.processPOReceipt(c.env.DB, {
    company_id, userId, po_id: poId,
    received_date: b.received_date,
    supplier_code: po.supplier_code ?? undefined,
    notes: b.notes,
    items: enrichedLines
  })

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'RECEIVE_PO',
    table_name: 'purchase_orders', record_id: poId,
    new_value: { po_id: poId, lines_count: enrichedLines.length, status: newStatus },
  })

  return c.json({
    success: true,
    data: { po_id: poId, status: newStatus, movements_created: movements },
  }, 201)
})

export default receipts
