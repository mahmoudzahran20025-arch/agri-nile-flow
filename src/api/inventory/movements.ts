import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { resolveMovementDirection } from '../../lib/posting_engine'
import { FinanceCore } from '../../lib/finance_core'
import {
  enforceInventoryLockDate,
  enqueueInventoryPostingOutbox,
  getInventoryPostingControls,
  readInventoryBalance,
  upsertInventoryBalance,
  validateZeroValuePolicy,
} from '../../lib/inventory_posting'
import { normalizeIsoDate, isFutureIsoDate, yearMonthParts } from '../../lib/utils/date'
import { logFinancialWorkflowFailure } from '../../lib/finance/workflow_policy'

const movements = new Hono<{ Bindings: Env }>()

const SUPPORTED_MOVEMENT_TYPES = new Set([
  'GRN', 'ISSUE',
  'TRANSFER_IN', 'TRANSFER_OUT',
  'RETURN_SUPPLIER', 'RETURN_CUSTOMER',
  'ADJUSTMENT_PROFIT', 'ADJUSTMENT_LOSS',
  'PRODUCTION_INPUT', 'PRODUCTION_OUTPUT',
])

function isSupportedMovementType(movementType: string): boolean {
  return SUPPORTED_MOVEMENT_TYPES.has(movementType)
}

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

async function isKnownServiceTypeCode(db: Env['DB'], company_id: number, code: string): Promise<boolean> {
  const normalized = code.trim()
  if (!normalized) return false

  const row = await db.prepare(
    'SELECT 1 AS ok FROM service_types WHERE company_id = ? AND code = ? AND is_active = 1 LIMIT 1'
  ).bind(company_id, normalized).first<{ ok: number }>()
  return !!row?.ok
}

async function validateInventoryGovernance(
  db: Env['DB'],
  company_id: number,
  input: {
    movement_type: string
    supplier_code?: number | null
    document_number?: string | null
    center_code?: number | null
    statement_text?: string | null
    notes?: string | null
    service_type_code?: string | null
  },
): Promise<{ statementText: string | null; serviceTypeCode: string | null }> {
  const statementText = (input.statement_text ?? input.notes ?? '').trim() || null
  const serviceTypeCode = input.service_type_code?.trim() || null

  if (input.movement_type === 'GRN') {
    if (input.supplier_code == null) {
      throw new Error('GRN_REQUIRES_SUPPLIER')
    }
    if (input.document_number == null) {
      throw new Error('GRN_REQUIRES_DOCUMENT')
    }
  }

  if (input.movement_type === 'ISSUE') {
    if (input.center_code == null) {
      throw new Error('ISSUE_REQUIRES_CENTER')
    }
    if (!statementText || statementText.length < 3) {
      throw new Error('ISSUE_REQUIRES_STATEMENT')
    }
    if (!serviceTypeCode) {
      throw new Error('ISSUE_REQUIRES_SERVICE_TYPE')
    }
  }

  if (serviceTypeCode) {
    const known = await isKnownServiceTypeCode(db, company_id, serviceTypeCode)
    if (!known) {
      throw new Error('UNKNOWN_SERVICE_TYPE_CODE')
    }
  }

  return { statementText, serviceTypeCode }
}

async function markMovementFinancialFailure(
  db: Env['DB'],
  companyId: number,
  userId: number,
  movementId: number,
  error: string,
): Promise<void> {
  await db.prepare(
    `UPDATE inventory_movements
     SET gl_posting_status = 'failed', gl_posting_error = ?
     WHERE id = ? AND company_id = ?`
  ).bind(error, movementId, companyId).run()

  await logFinancialWorkflowFailure(db, {
    company_id: companyId,
    user_id: userId,
    module: 'inventory',
    stage: 'mirroring',
    table_name: 'inventory_movements',
    record_id: movementId,
    error: error,
  })
}

// ── GET /movements (list) ─────────────────────────────────────

movements.get('/movements', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const itemCode    = c.req.query('item_code')
  const warehouseId = c.req.query('warehouse_id')
  const page        = Math.max(1, Number(c.req.query('page') ?? 1))
  const size        = Math.min(200, Number(c.req.query('size') ?? 50))
  const offset      = (page - 1) * size

  let where = 'WHERE im.company_id = ?'
  const binds: unknown[] = [company_id]

  if (itemCode)    { where += ' AND im.item_code = ?';    binds.push(Number(itemCode)) }
  if (warehouseId) { where += ' AND im.warehouse_id = ?'; binds.push(Number(warehouseId)) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT im.*, i.name AS item_name, i.unit, w.name AS warehouse_name
       FROM inventory_movements im
       LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
       LEFT JOIN warehouses w ON w.id = im.warehouse_id AND w.company_id = im.company_id
       ${where}
       ORDER BY im.movement_date DESC, im.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM inventory_movements im ${where}`
    ).bind(...binds).first<{ n: number }>(),
  ])

  return c.json({
    success: true, data: rows.results,
    total: cnt?.n ?? 0, page, page_size: size,
    has_more: offset + size < (cnt?.n ?? 0),
  })
})

// ── POST /movements (single) ──────────────────────────────────

movements.post('/movements', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const b = await c.req.json<{
    movement_date: string; warehouse?: string; warehouse_id?: number; movement_type: string
    item_code: number; quantity: number; unit_price?: number
    supplier_code?: number; document_number?: string; notes?: string
    statement_text?: string; service_type_code?: string
    season_id?: number; field_id?: number; work_order_id?: number
    center_code?: number; pack_capacity?: number; pack_count?: number
    payment_method?: 'cash' | 'credit'
    zero_value_reason?: string
    batch_number?: string; expiry_date?: string
  }>()

  if (!b.movement_date || (!b.warehouse && !b.warehouse_id) || !b.movement_type || !b.item_code || !b.quantity) {
    return c.json({ success: false, error: 'بيانات الحركة ناقصة' }, 400)
  }

  const wh = await resolveWarehouse(c.env.DB, company_id, b.warehouse_id, b.warehouse)
  if (!wh) return c.json({ success: false, error: 'المخزن غير موجود أو غير نشط' }, 422)
  
  const warehouseId = wh.id

  if (!isSupportedMovementType(b.movement_type)) {
    return c.json({ success: false, error: 'نوع حركة غير مدعوم' }, 400)
  }

  let movementDate: string = normalizeIsoDate(b.movement_date)
  if (isFutureIsoDate(movementDate)) {
    return c.json({ success: false, error: 'غير مسموح بترحيل حركة مخزنية بتاريخ مستقبلي' }, 422)
  }

  const isInbound = resolveMovementDirection(b.movement_type) === 'IN'
  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  
  try {
    enforceInventoryLockDate(controls, movementDate)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, movementDate)
  if (!periodId) return c.json({ success: false, error: "لا توجد فترة مالية مفتوحة لهذا التاريخ" }, 400)

  let centerCode = b.center_code
  if (!centerCode && b.field_id) {
    const field = await c.env.DB.prepare("SELECT center_code FROM fields WHERE id = ? AND company_id = ?").bind(b.field_id, company_id).first<{ center_code: number }>()
    if (field) centerCode = field.center_code
  }

  let resolvedFieldId = b.field_id ?? null
  let resolvedSeasonId = b.season_id ?? null
  if (b.work_order_id) {
    const wo = await c.env.DB.prepare(
      'SELECT field_id, season_id, center_code FROM work_orders WHERE id = ? AND company_id = ?'
    ).bind(b.work_order_id, company_id).first<{ field_id: number | null; season_id: number | null; center_code: number | null }>()
    if (!wo) return c.json({ success: false, error: 'أمر العمل المحدد غير موجود' }, 422)
    if (!resolvedFieldId && wo.field_id) resolvedFieldId = wo.field_id
    if (!resolvedSeasonId && wo.season_id) resolvedSeasonId = wo.season_id
    if (!centerCode && wo.center_code) centerCode = wo.center_code
  }

  if (b.movement_type === 'GRN' && resolvedSeasonId == null) {
    return c.json({ success: false, error: 'الموسم مطلوب في استلام المخزون GRN' }, 422)
  }

  const { statementText, serviceTypeCode } = await validateInventoryGovernance(c.env.DB, company_id, {
    movement_type: b.movement_type, supplier_code: b.supplier_code,
    document_number: b.document_number, center_code: centerCode, statement_text: b.statement_text,
    service_type_code: b.service_type_code,
  })

  const prev = await readInventoryBalance(c.env.DB, company_id, b.item_code, warehouseId)
  if (!isInbound && b.quantity > prev.balance_qty) {
    return c.json({ success: false, error: `رصيد غير كافٍ: ${prev.balance_qty}`, code: 'INSUFFICIENT_STOCK' }, 409)
  }

  const unitPrice = b.unit_price ?? (prev.balance_qty > 0 ? prev.balance_value / prev.balance_qty : 0)
  const qtyIn = isInbound ? b.quantity : 0
  const qtyOut = isInbound ? 0 : b.quantity
  const valueIn = isInbound ? b.quantity * unitPrice : 0
  const valueOut = isInbound ? 0 : b.quantity * unitPrice
  const movementValue = isInbound ? valueIn : valueOut

  validateZeroValuePolicy(controls, role, movementValue, b.zero_value_reason)

  const localId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const ym = yearMonthParts(movementDate)
  const transactionId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, supplier_code, item_code, center_code,
        movement_date, warehouse_id, movement_type, document_number, batch_number, expiry_date,
        pack_capacity, pack_count, quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, statement_text, service_type_code, year, month, created_by_user_id, local_id,
        zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, resolvedSeasonId, resolvedFieldId, b.work_order_id ?? null,
      b.supplier_code ?? null, b.item_code, centerCode ?? null,
      movementDate, warehouseId, b.movement_type, b.document_number ?? null,
      b.batch_number ?? null, b.expiry_date ?? null,
      b.pack_capacity ?? null, b.pack_count ?? null, b.quantity, unitPrice,
      qtyIn, qtyOut, prev.balance_qty + qtyIn - qtyOut, valueIn, valueOut, prev.balance_value + valueIn - valueOut,
      b.notes ?? null, statementText, serviceTypeCode, ym.year, ym.month, userId, localId,
      movementValue === 0 ? b.zero_value_reason : null,
      movementValue === 0 ? role : null,
      controls.posting_mode,
      movementValue === 0 ? 'exempt_zero_value' : 'pending',
      transactionId,
    ),
    c.env.DB.prepare(
      `UPDATE inventory_movements
       SET balance_qty = balance_qty + ?, balance_value = balance_value + ?
       WHERE company_id = ? AND item_code = ? AND warehouse_id = ?
         AND (movement_date > ? OR (movement_date = ? AND id > (SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?)))`
    ).bind(qtyIn - qtyOut, valueIn - valueOut, company_id, b.item_code, warehouseId, movementDate, movementDate, localId, company_id)
  ])

  const movRow = await c.env.DB.prepare('SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?').bind(localId, company_id).first<{id:number}>()
  const movId = movRow!.id
  await upsertInventoryBalance(c.env.DB, company_id, b.item_code, warehouseId, prev.balance_qty + qtyIn - qtyOut, prev.balance_value + valueIn - valueOut, movId)

  if (movementValue > 0) {
    const itemRow = await c.env.DB.prepare('SELECT name FROM items WHERE code = ? AND company_id = ?').bind(b.item_code, company_id).first<{name:string}>()
    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', movId, {
      company_id, ref_id: movId, item_code: b.item_code, warehouse_id: warehouseId,
      movement_type: b.movement_type, value: movementValue, date: movementDate,
      item_name: itemRow?.name ?? String(b.item_code), created_by: userId,
      center_code: centerCode, supplier_code: b.supplier_code, work_order_id: b.work_order_id,
      batch_number: b.batch_number, expiry_date: b.expiry_date,
    })
  }

  // Cash mirror logic (simplified)
  if (b.movement_type === 'GRN' && b.payment_method === 'cash' && valueIn > 0) {
    try {
      const itemRow = await c.env.DB.prepare('SELECT name FROM items WHERE code = ? AND company_id = ?').bind(b.item_code, company_id).first<{name:string}>()
      await FinanceCore.prepareCashMovement(c.env.DB, {
        company_id, userId, transaction_date: movementDate, direction: 'م',
        amount: valueIn, narration: `شراء نقدي: ${itemRow?.name ?? b.item_code}`,
        document_number: b.document_number, supplier_code: b.supplier_code,
        center_code: centerCode, notes: b.notes, skipGlPosting: true,
      })
    } catch (e: any) {
      await markMovementFinancialFailure(c.env.DB, company_id, userId, movId, `CASH_MIRROR_FAILED:${e.message}`)
    }
  }

  return c.json({ success: true, data: { id: movId } }, 201)
})

export default movements
