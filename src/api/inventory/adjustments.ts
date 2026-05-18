import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { yearMonthParts } from '../../lib/utils/date'
import {
  readInventoryBalance,
  enforceInventoryLockDate,
  enqueueInventoryPostingOutbox,
  getInventoryPostingControls,
  upsertInventoryBalance,
  validateZeroValuePolicy,
} from '../../lib/inventory_posting'

const adjustments = new Hono<{ Bindings: Env }>()

adjustments.get('/adjustments', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, w.name as warehouse_name
     FROM inventory_adjustments a
     JOIN warehouses w ON w.id = a.warehouse_id
     WHERE a.company_id = ? ORDER BY a.adjustment_date DESC, a.id DESC`
  ).bind(company_id).all()
  return c.json({ success: true, data: results })
})

adjustments.post('/adjustments', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{ warehouse_id: number; adjustment_date: string; notes?: string; lines?: any[] }>()

  if (!b.warehouse_id || !b.adjustment_date) {
    return c.json({ success: false, error: 'بيانات التسوية غير مكتملة' }, 400)
  }

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try {
    enforceInventoryLockDate(controls, b.adjustment_date)
  } catch {
    return c.json({ success: false, error: `الفترة المخزنية مغلقة حتى ${controls.locked_through_date}`, code: 'INVENTORY_PERIOD_LOCKED' }, 422)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO inventory_adjustments (company_id, warehouse_id, adjustment_date, notes, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(company_id, b.warehouse_id, b.adjustment_date, b.notes ?? null, userId).run()

  const adjId = result.meta.last_row_id
  const lines = Array.isArray(b.lines) ? b.lines : []

  const lineStmts = lines
    .filter((l: any) => l?.item_code && l?.counted_qty != null)
    .map((l: any) =>
    c.env.DB.prepare(
      `INSERT INTO inventory_adjustment_lines (adjustment_id, item_code, theoretical_qty, counted_qty, difference, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(adjId, l.item_code, l.theoretical_qty, l.counted_qty, l.counted_qty - l.theoretical_qty, l.notes ?? null)
  )

  if (lineStmts.length > 0) await c.env.DB.batch(lineStmts)

  return c.json({ success: true, id: adjId })
})

adjustments.put('/adjustments/:id/lines', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{ lines: Array<{ item_code: number; theoretical_qty: number; counted_qty: number; notes?: string }> }>()

  if (!Array.isArray(b.lines) || b.lines.length === 0) {
    return c.json({ success: false, error: 'أضف بند جرد واحد على الأقل قبل الحفظ' }, 400)
  }

  const adj = await c.env.DB.prepare(
    'SELECT id, status FROM inventory_adjustments WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; status: string }>()

  if (!adj) return c.json({ success: false, error: 'التسوية غير موجودة' }, 404)
  if (adj.status !== 'draft') return c.json({ success: false, error: 'لا يمكن تعديل بنود تسوية مرحّلة' }, 400)

  // adj already validated to belong to this company above; use it to scope the DELETE
  await c.env.DB.prepare(
    'DELETE FROM inventory_adjustment_lines WHERE adjustment_id = ?'
  ).bind(adj.id).run()

  // Validate item types — service and non_stock items have no perpetual balance
  const itemCodes = b.lines.map((l) => Number(l.item_code))
  const placeholders = itemCodes.map(() => '?').join(',')
  const { results: itemTypes } = await c.env.DB.prepare(
    `SELECT code, item_type FROM items WHERE code IN (${placeholders}) AND company_id = ?`
  ).bind(...itemCodes, company_id).all<{ code: number; item_type: string | null }>()
  const typeMap = new Map(itemTypes.map(r => [r.code, r.item_type]))
  for (const code of itemCodes) {
    const t = typeMap.get(code) ?? 'inventory'
    if (t === 'service') return c.json({ success: false, error: `الصنف #${code} نوع خدمة ولا يدخل في الجرد`, code: 'SERVICE_ITEM_NO_STOCK' }, 422)
    if (t === 'non_stock') return c.json({ success: false, error: `الصنف #${code} غير مخزني ولا يدخل في الجرد`, code: 'NON_STOCK_ITEM_NO_ADJUSTMENT' }, 422)
  }

  const lineStmts = b.lines.map((l) => {
    const theoreticalQty = Number(l.theoretical_qty ?? 0)
    const countedQty = Number(l.counted_qty ?? 0)
    return c.env.DB.prepare(
      `INSERT INTO inventory_adjustment_lines (adjustment_id, item_code, theoretical_qty, counted_qty, difference, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, Number(l.item_code), theoreticalQty, countedQty, countedQty - theoreticalQty, l.notes ?? null)
  })

  if (lineStmts.length > 0) await c.env.DB.batch(lineStmts)

  return c.json({ success: true, data: { lines_count: lineStmts.length } })
})

adjustments.get('/adjustments/:id', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const adj = await c.env.DB.prepare(
    `SELECT a.*, w.name as warehouse_name
     FROM inventory_adjustments a
     JOIN warehouses w ON w.id = a.warehouse_id
     WHERE a.id = ? AND a.company_id = ?`
  ).bind(id, company_id).first()

  if (!adj) return c.json({ success: false, error: 'التسوية غير موجودة' }, 404)

  const { results: lines } = await c.env.DB.prepare(
    `SELECT al.*, i.name as item_name, i.unit
     FROM inventory_adjustment_lines al
     JOIN items i ON i.code = al.item_code AND i.company_id = ?
     WHERE al.adjustment_id = ?`
  ).bind(company_id, id).all()

  return c.json({ success: true, data: { ...adj, lines } })
})

// DEPRECATED: PhysicalCountPage now uses POST /movements/batch via useMovementPostingPipeline.
adjustments.post('/adjustments/:id/post', permissionGuard('inventory', 'create'), async (c) => {
  c.header('X-Deprecated', 'true')
  c.header('X-Deprecated-Use', 'POST /movements/batch with movement_type=ADJUSTMENT_PROFIT or ADJUSTMENT_LOSS')
  const { company_id, sub: userId, role } = getUser(c)
  const id = Number(c.req.param('id'))

  const adj = await c.env.DB.prepare(
    'SELECT * FROM inventory_adjustments WHERE id = ? AND company_id = ?'
  ).bind(id, company_id)
    .first<{ id: number; status: string; warehouse_id: number; adjustment_date: string }>()

  if (!adj) return c.json({ success: false, error: 'التسوية غير موجودة' }, 404)
  if (adj.status !== 'draft') return c.json({ success: false, error: 'التسوية تم ترحيلها بالفعل' }, 400)

  const { results: lines } = await c.env.DB.prepare(
    `SELECT al.*
     FROM inventory_adjustment_lines al
     JOIN inventory_adjustments a ON a.id = al.adjustment_id
     WHERE al.adjustment_id = ? AND a.company_id = ?`
  ).bind(id, company_id).all<{ item_code: number; difference: number; theoretical_qty: number; counted_qty: number }>()

  if (!lines.length) {
    return c.json({ success: false, error: 'لا يمكن ترحيل تسوية بدون بنود محفوظة', code: 'ADJUSTMENT_LINES_REQUIRED' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, adj.adjustment_date)
  if (!periodId) return c.json({ success: false, error: 'الفترة المالية مغلقة' }, 400)

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try {
    enforceInventoryLockDate(controls, adj.adjustment_date)
  } catch {
    return c.json({ success: false, error: `الفترة المخزنية مغلقة حتى ${controls.locked_through_date}`, code: 'INVENTORY_PERIOD_LOCKED' }, 422)
  }

  const batchKey = `adj_${id}_${Date.now()}`
  const adjTransactionId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)

  for (const l of lines) {
    if (l.difference === 0) continue

    // Skip non-inventory items (guards already applied at line-save time, but re-check defensively)
    const lineItemType = await c.env.DB.prepare(
      'SELECT item_type FROM items WHERE code = ? AND company_id = ?'
    ).bind(l.item_code, company_id).first<{ item_type: string | null }>()
    if (lineItemType?.item_type === 'service' || lineItemType?.item_type === 'non_stock') continue

    const movementType = l.difference > 0 ? 'ADJUSTMENT_PROFIT' : 'ADJUSTMENT_LOSS'
    const absQty = Math.abs(l.difference)

    const lastRow = await readInventoryBalance(c.env.DB, company_id, l.item_code, adj.warehouse_id)
    const prevQty = lastRow.balance_qty ?? 0
    const prevVal = lastRow.balance_value ?? 0
    const unitPrice  = prevQty > 0 ? prevVal / prevQty : 0
    const totalValue = Math.round(absQty * unitPrice * 100) / 100

    if (movementType === 'ADJUSTMENT_LOSS' && absQty > prevQty) {
      return c.json({ success: false, error: `الصنف #${l.item_code}: الرصيد المتاح (${prevQty}) أقل من كمية التسوية (${absQty})`, code: 'INSUFFICIENT_STOCK' }, 409)
    }

    const qtyIn  = movementType === 'ADJUSTMENT_PROFIT' ? absQty : 0
    const qtyOut = movementType === 'ADJUSTMENT_LOSS'   ? absQty : 0
    const valIn  = movementType === 'ADJUSTMENT_PROFIT' ? totalValue : 0
    const valOut = movementType === 'ADJUSTMENT_LOSS'   ? totalValue : 0

    try {
      validateZeroValuePolicy(controls, role, totalValue, `inventory_adjustment:${id}`)
    } catch {
      return c.json({ success: false, error: `الصنف #${l.item_code}: حركة تسوية صفرية غير مسموحة بدون اعتماد`, code: 'ZERO_VALUE_POLICY_BLOCKED' }, 422)
    }

    const ym = yearMonthParts(adj.adjustment_date)
    const insertRes = await c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, item_code, movement_date, warehouse_id, movement_type,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, created_by_user_id, local_id,
        zero_value_reason, zero_value_approved_by_role, gl_posting_status, transaction_id,
        year, month)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, l.item_code, adj.adjustment_date, adj.warehouse_id, movementType,
      absQty, unitPrice, qtyIn, qtyOut, prevQty + qtyIn - qtyOut, valIn, valOut, prevVal + valIn - valOut,
      `تسوية جردية رقم #${id}`, userId, `${batchKey}_${l.item_code}`,
      totalValue === 0 ? `inventory_adjustment:${id}` : null,
      totalValue === 0 ? role : null,
      totalValue === 0 ? 'exempt_zero_value' : 'pending',
      adjTransactionId,
      ym.year, ym.month,
    ).run()

    const movementId = Number(insertRes.meta.last_row_id)
    await upsertInventoryBalance(c.env.DB, company_id, l.item_code, adj.warehouse_id, prevQty + qtyIn - qtyOut, prevVal + valIn - valOut, movementId, lastRow.version)

    if (totalValue > 0) {
      await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', movementId, {
        company_id, ref_id: movementId, item_code: l.item_code, warehouse_id: adj.warehouse_id,
        movement_type: movementType, value: totalValue, date: adj.adjustment_date,
        item_name: `تسوية جردية - ${l.item_code}`, created_by: userId,
      })
    }
  }

  await c.env.DB.prepare(
    'UPDATE inventory_adjustments SET status = "posted" WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).run()

  return c.json({ success: true })
})

export default adjustments
