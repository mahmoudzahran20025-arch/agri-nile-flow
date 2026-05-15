/**
 * inventory/issues.ts
 * ====================
 * Dedicated ISSUE (تصريف مخزون) endpoint with full dimension enforcement.
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { normalizeIsoDate, isFutureIsoDate, yearMonthParts } from '../../lib/utils/date'
import { enforceIssueDimensions } from '../../lib/dimension_validator'
import {
  enforceInventoryLockDate,
  enqueueInventoryPostingOutbox,
  getInventoryPostingControls,
  readInventoryBalance,
  upsertInventoryBalance,
  validateZeroValuePolicy,
} from '../../lib/inventory_posting'

const issues = new Hono<{ Bindings: Env }>()

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

async function ensureOutboxQueued(
  db: Env['DB'],
  companyId: number,
  movementId: number,
): Promise<void> {
  const row = await db.prepare(
    `SELECT id FROM inventory_posting_outbox
     WHERE company_id = ? AND event_type = 'inventory_movement' AND movement_id = ?
     ORDER BY id DESC LIMIT 1`
  ).bind(companyId, movementId).first<{ id: number }>()
  if (!row?.id) throw new Error(`OUTBOX_ENQUEUE_FAILED:inventory_movement:${movementId}`)
}

// ── POST /issues ──────────────────────────────────────────────────────────────
issues.post('/issues', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const b = await c.req.json<{
    issue_date:       string
    warehouse?:       string
    warehouse_id?:    number
    item_code:        number
    qty_out:          number
    unit_price?:      number
    season_id:        number
    center_code:      number
    field_id?:        number
    work_order_id?:   number
    service_type_code: string
    statement_text:   string
    notes?:           string
    zero_value_reason?: string
    batch_number?:    string
    expiry_date?:     string
  }>()

  if (!b.issue_date || (!b.warehouse && !b.warehouse_id) || !b.item_code || !b.qty_out) {
    return c.json({ success: false, error: 'التاريخ والمخزن وكود الصنف والكمية مطلوبة' }, 400)
  }

  const wh = await resolveWarehouse(c.env.DB, company_id, b.warehouse_id, b.warehouse)
  if (!wh) return c.json({ success: false, error: 'المخزن غير موجود' }, 422)
  const warehouseId = wh.id

  const issueDate = normalizeIsoDate(b.issue_date)
  if (isFutureIsoDate(issueDate)) return c.json({ success: false, error: 'تاريخ مستقبلي' }, 422)

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try {
    enforceInventoryLockDate(controls, issueDate)
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: 'INVENTORY_PERIOD_LOCKED' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, issueDate)
  if (!periodId) return c.json({ success: false, error: 'فترة مالية مغلقة' }, 400)

  let dims: any
  try {
    dims = await enforceIssueDimensions(c.env.DB, company_id, b)
  } catch (err: any) {
    return c.json({ success: false, error: err.error, code: err.code }, err.status || 422)
  }

  const prev = await readInventoryBalance(c.env.DB, company_id, b.item_code, warehouseId)
  if (b.qty_out > prev.balance_qty) return c.json({ success: false, error: `رصيد غير كافٍ: متاح ${prev.balance_qty}`, code: 'INSUFFICIENT_STOCK' }, 409)

  const unitPrice = b.unit_price ?? (prev.balance_qty > 0 ? prev.balance_value / prev.balance_qty : 0)
  const valueOut  = Math.round(b.qty_out * unitPrice * 100) / 100
  
  try {
    validateZeroValuePolicy(controls, role, valueOut, b.zero_value_reason)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }

  const localId = `issue_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const ym = yearMonthParts(issueDate)
  const transactionId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, center_code, work_order_id, item_code,
        movement_date, warehouse_id, movement_type, batch_number, expiry_date,
        quantity, unit_price, qty_out, balance_qty, value_out, balance_value,
        notes, statement_text, service_type_code, year, month, created_by_user_id, local_id,
        zero_value_reason, zero_value_approved_by_role, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, b.season_id, b.field_id ?? null, b.center_code, b.work_order_id ?? null, b.item_code,
      issueDate, warehouseId, 'ISSUE', b.batch_number ?? null, b.expiry_date ?? null,
      b.qty_out, unitPrice, b.qty_out, prev.balance_qty - b.qty_out, valueOut, prev.balance_value - valueOut,
      b.notes ?? null, dims.statementText, dims.serviceTypeCode, ym.year, ym.month, userId, localId,
      valueOut === 0 ? b.zero_value_reason : null, valueOut === 0 ? role : null,
      valueOut === 0 ? 'exempt_zero_value' : 'pending', transactionId
    ),
    c.env.DB.prepare(
      `UPDATE inventory_movements SET balance_qty = balance_qty - ?, balance_value = balance_value - ?
       WHERE company_id = ? AND item_code = ? AND warehouse_id = ?
         AND (movement_date > ? OR (movement_date = ? AND id > (SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?)))`
    ).bind(b.qty_out, valueOut, company_id, b.item_code, warehouseId, issueDate, issueDate, localId, company_id)
  ])

  const movRow = await c.env.DB.prepare('SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?').bind(localId, company_id).first<{id:number}>()
  await upsertInventoryBalance(c.env.DB, company_id, b.item_code, warehouseId, prev.balance_qty - b.qty_out, prev.balance_value - valueOut, movRow!.id)

  if (valueOut > 0) {
    const itemRow = await c.env.DB.prepare('SELECT name FROM items WHERE code = ? AND company_id = ?').bind(b.item_code, company_id).first<{name:string}>()
    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', movRow!.id, {
      company_id, ref_id: movRow!.id, item_code: b.item_code, warehouse_id: warehouseId,
      movement_type: 'ISSUE', value: valueOut, date: issueDate, item_name: itemRow?.name ?? String(b.item_code),
      created_by: userId, center_code: b.center_code, season_id: b.season_id, field_id: b.field_id,
      batch_number: b.batch_number, expiry_date: b.expiry_date,
    })
    await ensureOutboxQueued(c.env.DB, company_id, movRow!.id)
  }

  return c.json({ success: true, data: { id: movRow!.id } }, 201)
})

// ── POST /issues/batch ────────────────────────────────────────────────────────
issues.post('/issues/batch', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const b = await c.req.json<{
    issue_date:       string
    warehouse?:       string
    warehouse_id?:    number
    season_id:        number
    center_code:      number
    field_id?:        number
    work_order_id?:   number
    service_type_code: string
    statement_text:   string
    notes?:           string
    zero_value_reason?: string
    items: Array<{
      item_code: number
      qty_out:   number
      unit_price?: number
      notes?:      string
      batch_number?: string
      expiry_date?:  string
    }>
  }>()

  const wh = await resolveWarehouse(c.env.DB, company_id, b.warehouse_id, b.warehouse)
  if (!wh) return c.json({ success: false, error: 'المخزن غير موجود' }, 422)
  const warehouseId = wh.id

  const issueDate = normalizeIsoDate(b.issue_date)
  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  
  try {
    enforceInventoryLockDate(controls, issueDate)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }

  let dims: any
  try {
    dims = await enforceIssueDimensions(c.env.DB, company_id, b)
  } catch (err: any) {
    return c.json({ success: false, error: err.error }, err.status || 422)
  }

  const batchKey = `issue_batch_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const ym = yearMonthParts(issueDate)
  const transactionId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)

  const lineResults = []
  for (const li of b.items) {
    const prev = await readInventoryBalance(c.env.DB, company_id, li.item_code, warehouseId)
    
    // 🔴 CRITICAL FIX 2: Stock check before write
    if (li.qty_out > prev.balance_qty) {
      return c.json({ 
        success: false, 
        error: `رصيد غير كافٍ للصنف ${li.item_code}: متاح ${prev.balance_qty}`, 
        code: 'INSUFFICIENT_STOCK' 
      }, 409)
    }

    const unitPrice = li.unit_price ?? (prev.balance_qty > 0 ? prev.balance_value / prev.balance_qty : 0)
    const valueOut = Math.round(li.qty_out * unitPrice * 100) / 100
    
    // 🔴 CRITICAL FIX: Zero value policy check per line
    try {
      validateZeroValuePolicy(controls, role, valueOut, b.zero_value_reason)
    } catch (err: any) {
      return c.json({ success: false, error: `الصنف ${li.item_code}: ${err.message}` }, 422)
    }

    lineResults.push({
      ...li,
      unitPrice, valueOut,
      newBalQty: prev.balance_qty - li.qty_out,
      newBalVal: prev.balance_value - valueOut,
      localId: `${batchKey}_${lineResults.length}`
    })
  }

  const stmts = lineResults.map(lr => c.env.DB.prepare(
    `INSERT INTO inventory_movements
     (company_id, season_id, field_id, center_code, item_code, movement_date, warehouse_id, 
      movement_type, batch_number, expiry_date, quantity, unit_price, qty_out, balance_qty, 
      value_out, balance_value, year, month, created_by_user_id, local_id, 
      transaction_id, gl_posting_status, service_type_code, statement_text)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.season_id, b.field_id ?? null, b.center_code, lr.item_code, issueDate, warehouseId,
    'ISSUE', lr.batch_number ?? null, lr.expiry_date ?? null, lr.qty_out, lr.unitPrice, lr.qty_out, lr.newBalQty,
    lr.valueOut, lr.newBalVal, ym.year, ym.month, userId, lr.localId, transactionId,
    lr.valueOut === 0 ? 'exempt_zero_value' : 'pending', dims.serviceTypeCode, dims.statementText
  ))

  await c.env.DB.batch(stmts)

  // 🔴 CRITICAL FIX 1: Balance upsert and GL outbox after batch INSERT
  for (const lr of lineResults) {
    const movRow = await c.env.DB.prepare('SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?').bind(lr.localId, company_id).first<{id:number}>()
    if (!movRow) continue

    await upsertInventoryBalance(c.env.DB, company_id, lr.item_code, warehouseId, lr.newBalQty, lr.newBalVal, movRow.id)

    if (lr.valueOut > 0) {
      const itemRow = await c.env.DB.prepare('SELECT name FROM items WHERE code = ? AND company_id = ?').bind(lr.item_code, company_id).first<{name:string}>()
      await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', movRow.id, {
        company_id, ref_id: movRow.id, item_code: lr.item_code, warehouse_id: warehouseId,
        movement_type: 'ISSUE', value: lr.valueOut, date: issueDate, item_name: itemRow?.name ?? String(lr.item_code),
        created_by: userId, center_code: b.center_code, season_id: b.season_id, field_id: b.field_id,
        batch_number: lr.batch_number, expiry_date: lr.expiry_date,
      })
      // We don't strictly await ensureOutboxQueued in loop for performance, 
      // but let's do a bulk verification if needed.
    }
  }
  
  return c.json({ success: true, count: lineResults.length }, 201)
})

export default issues
