import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { FinanceCore } from '../../lib/finance_core'
import { logAudit } from '../../lib/audit'
import { resolveControlAccount } from '../../lib/posting_engine'
import { enrichPOReceiptItems } from '../../lib/finance'

const receipts = new Hono<{ Bindings: Env }>()

receipts.post('/receive-po/:po_id', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const poId = Number(c.req.param('po_id'))

  const b = await c.req.json<{
    received_date: string
    notes?: string
    season_id?:   number
    center_code?: number
    field_id?:    number
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

  let enrichedLines: Awaited<ReturnType<typeof enrichPOReceiptItems>>
  try {
    enrichedLines = await enrichPOReceiptItems(c.env.DB, company_id, poId, b.items)
  } catch (err: unknown) {
    const e = err as Error & { status?: number }
    return c.json({ success: false, error: e.message }, (e.status ?? 422) as 404 | 409 | 422)
  }

  const { movements, movement_ids, status: newStatus } = await FinanceCore.processPOReceipt(c.env.DB, {
    company_id, userId, po_id: poId,
    received_date: b.received_date,
    supplier_code: po.supplier_code ?? undefined,
    notes:        b.notes,
    season_id:    b.season_id,
    center_code:  b.center_code,
    field_id:     b.field_id,
    items: enrichedLines
  })

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'RECEIVE_PO',
    table_name: 'purchase_orders', record_id: poId,
    new_value: { po_id: poId, lines_count: enrichedLines.length, status: newStatus },
  })

  return c.json({
    success: true,
    data: { po_id: poId, status: newStatus, movements_created: movements, movement_ids },
  }, 201)
})

export default receipts
