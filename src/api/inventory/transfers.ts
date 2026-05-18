/**
 * inventory/transfers.ts
 * =======================
 * POST /inventory/movements/transfer-batch
 *
 * Inter-warehouse transfer: for each line item, creates a paired
 * TRANSFER_OUT row on the source warehouse and TRANSFER_IN row on the
 * destination warehouse, then enqueues a single 'inventory_transfer'
 * outbox job that resolves DR dst_inventory / CR src_inventory via
 * resolveInventoryTransfer() in posting_engine.ts.
 *
 * The two movement rows share a transaction_id so they can be linked
 * in queries (e.g. transactions.ts TRANSFER grouping).
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import {
  enforceInventoryLockDate,
  enqueueInventoryPostingOutbox,
  getInventoryPostingControls,
  readInventoryBalance,
  upsertInventoryBalance,
} from '../../lib/inventory_posting'
import { normalizeIsoDate, isFutureIsoDate, yearMonthParts } from '../../lib/utils/date'

const transfers = new Hono<{ Bindings: Env }>()

// ── Resolve warehouse by name or id ──────────────────────────────────────────
async function resolveWarehouse(
  db: Env['DB'], companyId: number, id?: number, name?: string
): Promise<{ id: number; name: string; inv_posting_group_code: string | null } | null> {
  if (id) {
    return db.prepare(
      'SELECT id, name, inv_posting_group_code FROM warehouses WHERE id = ? AND company_id = ? AND is_active = 1'
    ).bind(id, companyId).first<{ id: number; name: string; inv_posting_group_code: string | null }>() ?? null
  }
  if (name) {
    return db.prepare(
      'SELECT id, name, inv_posting_group_code FROM warehouses WHERE name = ? AND company_id = ? AND is_active = 1'
    ).bind(name, companyId).first<{ id: number; name: string; inv_posting_group_code: string | null }>() ?? null
  }
  return null
}

// ── POST /movements/transfer-batch ───────────────────────────────────────────

transfers.post('/movements/transfer-batch', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)

  const b = await c.req.json<{
    movement_date:  string
    from_warehouse: string
    to_warehouse:   string
    notes?:         string
    season_id?:     number
    center_code?:   number
    field_id?:      number
    work_order_id?: number
    crop_cycle_id?: number
    items: Array<{
      item_code:  number
      quantity:   number
    }>
  }>()

  // ── Basic validation ────────────────────────────────────────────────────────
  if (!b.movement_date || !b.from_warehouse || !b.to_warehouse) {
    return c.json({ success: false, error: 'التاريخ والمخزن المصدر والمخزن الوجهة مطلوبة' }, 400)
  }
  if (!Array.isArray(b.items) || b.items.length === 0) {
    return c.json({ success: false, error: 'يجب تحديد صنف واحد على الأقل' }, 400)
  }
  if (b.from_warehouse === b.to_warehouse) {
    return c.json({ success: false, error: 'المخزن المصدر والوجهة لا يمكن أن يكونا نفس المخزن' }, 400)
  }

  const movementDate = normalizeIsoDate(b.movement_date)
  if (isFutureIsoDate(movementDate)) {
    return c.json({ success: false, error: 'غير مسموح بترحيل حركة بتاريخ مستقبلي' }, 422)
  }

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try { enforceInventoryLockDate(controls, movementDate) }
  catch (err: any) { return c.json({ success: false, error: err.message }, 422) }

  const periodId = await getOpenPeriod(c.env.DB, company_id, movementDate)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${movementDate}` }, 400)
  }

  // ── Resolve both warehouses ─────────────────────────────────────────────────
  const [srcWh, dstWh] = await Promise.all([
    resolveWarehouse(c.env.DB, company_id, undefined, b.from_warehouse),
    resolveWarehouse(c.env.DB, company_id, undefined, b.to_warehouse),
  ])
  if (!srcWh) return c.json({ success: false, error: `المخزن المصدر "${b.from_warehouse}" غير موجود أو غير نشط` }, 422)
  if (!dstWh) return c.json({ success: false, error: `المخزن الوجهة "${b.to_warehouse}" غير موجود أو غير نشط` }, 422)

  // ── Validate all items before touching balances ─────────────────────────────
  const lineData: Array<{
    item_code:    number
    item_name:    string
    ppg_code:     string | null
    quantity:     number
    unitPrice:    number
    srcBalance:   { balance_qty: number; balance_value: number; version: number }
    dstBalance:   { balance_qty: number; balance_value: number; version: number }
  }> = []

  for (const line of b.items) {
    if (!line.item_code || !(line.quantity > 0)) {
      return c.json({ success: false, error: `بيانات الصنف #${line.item_code} غير صحيحة` }, 400)
    }

    const [item, srcBal, dstBal] = await Promise.all([
      c.env.DB.prepare(
        'SELECT name, prod_posting_group_code, item_type FROM items WHERE code = ? AND company_id = ?'
      ).bind(line.item_code, company_id).first<{ name: string; prod_posting_group_code: string | null; item_type: string | null }>(),
      readInventoryBalance(c.env.DB, company_id, line.item_code, srcWh.id),
      readInventoryBalance(c.env.DB, company_id, line.item_code, dstWh.id),
    ])

    if (!item) {
      return c.json({ success: false, error: `الصنف #${line.item_code} غير موجود` }, 422)
    }
    if (item.item_type === 'service') {
      return c.json({ success: false, error: `أصناف الخدمة لا تُحوَّل بين المخازن: #${line.item_code}`, code: 'SERVICE_ITEM_NO_STOCK' }, 422)
    }
    if (srcBal.balance_qty < line.quantity) {
      return c.json({
        success: false,
        error: `رصيد غير كافٍ للصنف "${item.name}" في "${srcWh.name}": المتاح ${srcBal.balance_qty}`,
        code: 'INSUFFICIENT_STOCK',
      }, 409)
    }

    const unitPrice = srcBal.balance_qty > 0
      ? srcBal.balance_value / srcBal.balance_qty
      : 0

    lineData.push({
      item_code:  line.item_code,
      item_name:  item.name,
      ppg_code:   item.prod_posting_group_code,
      quantity:   line.quantity,
      unitPrice,
      srcBalance: srcBal,
      dstBalance: dstBal,
    })
  }

  // ── Create movement pairs ───────────────────────────────────────────────────
  const ym          = yearMonthParts(movementDate)
  const created: Array<{ item_code: number; out_id: number; in_id: number; value: number }> = []

  for (const line of lineData) {
    const transferValue = line.quantity * line.unitPrice
    const sharedTxnId  = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)
    const localIdOut   = `trf_out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const localIdIn    = `trf_in_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

    const newSrcQty = line.srcBalance.balance_qty - line.quantity
    const newSrcVal = line.srcBalance.balance_value - transferValue
    const newDstQty = line.dstBalance.balance_qty + line.quantity
    const newDstVal = line.dstBalance.balance_value + transferValue

    // Insert TRANSFER_OUT
    await c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, crop_cycle_id, item_code, center_code,
        movement_date, warehouse_id, movement_type,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, year, month, created_by_user_id, local_id,
        posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,0,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, b.season_id ?? null, b.field_id ?? null, b.work_order_id ?? null, b.crop_cycle_id ?? null,
      line.item_code, b.center_code ?? null,
      movementDate, srcWh.id, 'TRANSFER_OUT',
      line.quantity, line.unitPrice, line.quantity,
      newSrcQty, transferValue, newSrcVal,
      b.notes ?? null, ym.year, ym.month, userId, localIdOut,
      controls.posting_mode, transferValue > 0 ? 'pending' : 'exempt_zero_value',
      sharedTxnId
    ).run()

    const outRow = await c.env.DB.prepare(
      'SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?'
    ).bind(localIdOut, company_id).first<{ id: number }>()
    const outId = outRow!.id

    // Insert TRANSFER_IN
    await c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, crop_cycle_id, item_code, center_code,
        movement_date, warehouse_id, movement_type,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, year, month, created_by_user_id, local_id,
        posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,0,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, b.season_id ?? null, b.field_id ?? null, b.work_order_id ?? null, b.crop_cycle_id ?? null,
      line.item_code, b.center_code ?? null,
      movementDate, dstWh.id, 'TRANSFER_IN',
      line.quantity, line.unitPrice, line.quantity,
      newDstQty, transferValue, newDstVal,
      b.notes ?? null, ym.year, ym.month, userId, localIdIn,
      controls.posting_mode, transferValue > 0 ? 'pending' : 'exempt_zero_value',
      sharedTxnId
    ).run()

    const inRow = await c.env.DB.prepare(
      'SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?'
    ).bind(localIdIn, company_id).first<{ id: number }>()
    const inId = inRow!.id

    // Update running balances
    await Promise.all([
      upsertInventoryBalance(c.env.DB, company_id, line.item_code, srcWh.id, newSrcQty, newSrcVal, outId, line.srcBalance.version),
      upsertInventoryBalance(c.env.DB, company_id, line.item_code, dstWh.id, newDstQty, newDstVal, inId, line.dstBalance.version),
    ])

    // Enqueue GL posting — single job covers both movements via target_movement_id
    if (transferValue > 0) {
      await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_transfer', outId, {
        company_id,
        ref_id:             outId,
        target_movement_id: inId,
        item_code:          line.item_code,
        item_name:          line.item_name,
        src_warehouse_id:   srcWh.id,
        dst_warehouse_id:   dstWh.id,
        src_ipg_code:       srcWh.inv_posting_group_code,
        dst_ipg_code:       dstWh.inv_posting_group_code,
        ppg_code:           line.ppg_code,
        value:              transferValue,
        date:               movementDate,
        created_by:         userId,
        center_code:        b.center_code,
        season_id:          b.season_id,
        field_id:           b.field_id,
      })
    }

    created.push({ item_code: line.item_code, out_id: outId, in_id: inId, value: transferValue })
  }

  return c.json({
    success: true,
    data: {
      from_warehouse: srcWh.name,
      to_warehouse:   dstWh.name,
      movement_date:  movementDate,
      lines:          created,
      total_lines:    created.length,
      total_value:    created.reduce((s, l) => s + l.value, 0),
    },
  }, 201)
})

export default transfers
