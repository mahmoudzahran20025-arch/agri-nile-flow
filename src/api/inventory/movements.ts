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

/**
 * Packaging invariant: if both pack_count and pack_capacity are provided,
 * quantity MUST equal pack_count × pack_capacity (±0.001 tolerance for float rounding).
 *
 * This is the single choke point that prevents valuation corruption from bag/kg confusion.
 * Example: 10 bags × 50 KG/bag → quantity must be 500 KG, not 10.
 */
function assertPackagingInvariant(
  quantity: number,
  pack_count: number | null | undefined,
  pack_capacity: number | null | undefined,
  itemCode: number | string,
): void {
  if (pack_count != null && pack_capacity != null && pack_capacity > 0) {
    const expected = pack_count * pack_capacity
    if (Math.abs(quantity - expected) > 0.001) {
      throw new Error(
        `PACKAGING_MISMATCH:${itemCode}:` +
        `quantity=${quantity} must equal pack_count(${pack_count}) × pack_capacity(${pack_capacity})=${expected}`
      )
    }
  }
}

const SUPPORTED_MOVEMENT_TYPES = new Set([
  'GRN', 'ISSUE',
  'TRANSFER_IN', 'TRANSFER_OUT',
  'RETURN_SUPPLIER', 'RETURN_CUSTOMER',
  'ADJUSTMENT_PROFIT', 'ADJUSTMENT_LOSS',
  'PRODUCTION_INPUT', 'PRODUCTION_OUTPUT',
  'SALE',
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
    work_order_id?: number | null
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

  if (input.movement_type === 'PRODUCTION_INPUT' || input.movement_type === 'PRODUCTION_OUTPUT') {
    // Production movements must reference a work order — prevents unexplained stock changes
    // without a production record (BOM enforcement will be added in a future phase)
    if (input.work_order_id == null) {
      throw new Error('PRODUCTION_MOVEMENT_REQUIRES_WORK_ORDER')
    }
  }

  // SALE: dedicated governance — does NOT require service_type_code, center_code, or statement_text.
  // is_sellable enforcement happens before this function is called (item flag check).
  if (input.movement_type === 'SALE') {
    return { statementText, serviceTypeCode: null }
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

// ── GET /movements/:id ────────────────────────────────────────

movements.get('/movements/:id', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ success: false, error: 'معرف الحركة غير صحيح' }, 400)

  const row = await c.env.DB.prepare(
    `SELECT im.*,
            i.name AS item_name, i.unit,
            w.name AS warehouse_name,
            je.is_posted AS je_is_posted
     FROM inventory_movements im
     LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
     LEFT JOIN warehouses w ON w.id = im.warehouse_id AND w.company_id = im.company_id
     LEFT JOIN journal_entries je ON je.id = im.journal_entry_id AND je.company_id = im.company_id
     WHERE im.id = ? AND im.company_id = ? LIMIT 1`
  ).bind(id, company_id).first()

  if (!row) return c.json({ success: false, error: 'الحركة غير موجودة' }, 404)
  return c.json({ success: true, data: row })
})

// ── POST /movements (single) ──────────────────────────────────

movements.post('/movements', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const b = await c.req.json<{
    movement_date: string; warehouse?: string; warehouse_id?: number; movement_type: string
    item_code: number; quantity: number; unit_price?: number; total_value?: number
    supplier_code?: number; document_number?: string; notes?: string
    statement_text?: string; service_type_code?: string
    season_id?: number; field_id?: number; work_order_id?: number; crop_cycle_id?: number
    center_code?: number; pack_capacity?: number; pack_count?: number
    payment_method?: 'cash' | 'credit'
    zero_value_reason?: string
    batch_number?: string; expiry_date?: string
  }>()

  if (!b.movement_date || (!b.warehouse && !b.warehouse_id) || !b.movement_type || !b.item_code || !b.quantity) {
    return c.json({ success: false, error: 'بيانات الحركة ناقصة' }, 400)
  }

  try {
    assertPackagingInvariant(b.quantity, b.pack_count, b.pack_capacity, b.item_code)
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: 'PACKAGING_MISMATCH' }, 422)
  }

  const wh = await resolveWarehouse(c.env.DB, company_id, b.warehouse_id, b.warehouse)
  if (!wh) return c.json({ success: false, error: 'المخزن غير موجود أو غير نشط' }, 422)

  const warehouseId = wh.id
  const usedStringWarehouse = !b.warehouse_id && !!b.warehouse

  if (!isSupportedMovementType(b.movement_type)) {
    return c.json({ success: false, error: 'نوع حركة غير مدعوم' }, 400)
  }

  const itemTypeRow = await c.env.DB.prepare(
    'SELECT item_type, is_purchasable, is_sellable, expiry_tracking FROM items WHERE code = ? AND company_id = ?'
  ).bind(b.item_code, company_id).first<{ item_type: string | null; is_purchasable: number; is_sellable: number; expiry_tracking: number }>()
  if (!itemTypeRow) return c.json({ success: false, error: 'الصنف غير موجود' }, 404)
  if (itemTypeRow.item_type === 'service') {
    return c.json({ success: false, error: 'أصناف الخدمة لا تُسجَّل في حركات المخزون', code: 'SERVICE_ITEM_NO_STOCK' }, 422)
  }
  if ((b.movement_type === 'GRN' || b.movement_type === 'RETURN_SUPPLIER') && !itemTypeRow.is_purchasable) {
    return c.json({ success: false, error: 'هذا الصنف غير قابل للشراء', code: 'ITEM_NOT_PURCHASABLE' }, 422)
  }
  if ((b.movement_type === 'RETURN_CUSTOMER' || b.movement_type === 'SALE') && !itemTypeRow.is_sellable) {
    return c.json({ success: false, error: 'هذا الصنف غير قابل للبيع', code: 'ITEM_NOT_SELLABLE' }, 422)
  }
  const isNonStock = itemTypeRow.item_type === 'non_stock'

  let movementDate: string = normalizeIsoDate(b.movement_date)
  if (isFutureIsoDate(movementDate)) {
    return c.json({ success: false, error: 'غير مسموح بترحيل حركة مخزنية بتاريخ مستقبلي' }, 422)
  }

  const isInbound = resolveMovementDirection(b.movement_type) === 'IN'

  if (isInbound && itemTypeRow.expiry_tracking && !b.expiry_date) {
    return c.json({ success: false, error: 'هذا الصنف يتطلب تاريخ انتهاء الصلاحية على الحركات الواردة', code: 'EXPIRY_DATE_REQUIRED' }, 422)
  }
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
  if (b.movement_type === 'ISSUE' && resolvedSeasonId == null) {
    return c.json({ success: false, error: 'الموسم مطلوب في حركة الصرف ISSUE' }, 422)
  }

  const { statementText, serviceTypeCode } = await validateInventoryGovernance(c.env.DB, company_id, {
    movement_type: b.movement_type, supplier_code: b.supplier_code,
    document_number: b.document_number, center_code: centerCode, statement_text: b.statement_text,
    service_type_code: b.service_type_code, work_order_id: b.work_order_id ?? null,
  })

  // non_stock: no perpetual balance — use unit_price from request (or 0), no balance check
  const prev = isNonStock
    ? { balance_qty: 0, balance_value: 0, version: 0 }
    : await readInventoryBalance(c.env.DB, company_id, b.item_code, warehouseId)
  if (!isNonStock && !isInbound && b.quantity > prev.balance_qty) {
    return c.json({ success: false, error: `رصيد غير كافٍ: ${prev.balance_qty}`, code: 'INSUFFICIENT_STOCK' }, 409)
  }

  // Derive unit_price: if total_value provided, use total_value/qty for accurate cost entry.
  // Floor at 0 — negative unit price would corrupt inventory valuation.
  const derivedUnitPrice = b.total_value != null && b.quantity > 0
    ? b.total_value / b.quantity
    : (b.unit_price ?? (prev.balance_qty > 0 ? prev.balance_value / prev.balance_qty : 0))
  const unitPrice = Math.max(0, Math.round(derivedUnitPrice * 10000) / 10000)
  const qtyIn = isInbound ? b.quantity : 0
  const qtyOut = isInbound ? 0 : b.quantity
  const valueIn = Math.round((isInbound ? b.quantity * unitPrice : 0) * 100) / 100
  const valueOut = Math.round((isInbound ? 0 : b.quantity * unitPrice) * 100) / 100
  const movementValue = isInbound ? valueIn : valueOut

  validateZeroValuePolicy(controls, role, movementValue, b.zero_value_reason)

  const localId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const ym = yearMonthParts(movementDate)
  const transactionId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)

  // non_stock: INSERT only (no balance propagation UPDATE needed)
  const batchStmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, crop_cycle_id, supplier_code, item_code, center_code,
        movement_date, warehouse_id, movement_type, document_number, batch_number, expiry_date,
        pack_capacity, pack_count, quantity, unit_price, total_value_entered, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, statement_text, service_type_code, year, month, created_by_user_id, local_id,
        zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, resolvedSeasonId, resolvedFieldId, b.work_order_id ?? null, b.crop_cycle_id ?? null,
      b.supplier_code ?? null, b.item_code, centerCode ?? null,
      movementDate, warehouseId, b.movement_type, b.document_number ?? null,
      b.batch_number ?? null, b.expiry_date ?? null,
      b.pack_capacity ?? null, b.pack_count ?? null, b.quantity, unitPrice, b.total_value ?? null,
      qtyIn, qtyOut, isNonStock ? 0 : prev.balance_qty + qtyIn - qtyOut,
      valueIn, valueOut, isNonStock ? 0 : prev.balance_value + valueIn - valueOut,
      b.notes ?? null, statementText, serviceTypeCode, ym.year, ym.month, userId, localId,
      movementValue === 0 ? b.zero_value_reason : null,
      movementValue === 0 ? role : null,
      controls.posting_mode,
      movementValue === 0 ? 'exempt_zero_value' : 'pending',
      transactionId,
    ),
  ]

  if (!isNonStock) {
    batchStmts.push(
      c.env.DB.prepare(
        `UPDATE inventory_movements
         SET balance_qty = balance_qty + ?, balance_value = balance_value + ?
         WHERE company_id = ? AND item_code = ? AND warehouse_id = ?
           AND (movement_date > ? OR (movement_date = ? AND id > (SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?)))`
      ).bind(qtyIn - qtyOut, valueIn - valueOut, company_id, b.item_code, warehouseId, movementDate, movementDate, localId, company_id)
    )
  }

  await c.env.DB.batch(batchStmts)

  const movRow = await c.env.DB.prepare('SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?').bind(localId, company_id).first<{id:number}>()
  const movId = movRow!.id
  if (!isNonStock) {
    await upsertInventoryBalance(c.env.DB, company_id, b.item_code, warehouseId, prev.balance_qty + qtyIn - qtyOut, prev.balance_value + valueIn - valueOut, movId, prev.version)
  }

  if (movementValue > 0) {
    const itemRow = await c.env.DB.prepare('SELECT name FROM items WHERE code = ? AND company_id = ?').bind(b.item_code, company_id).first<{name:string}>()
    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', movId, {
      company_id, ref_id: movId, item_code: b.item_code, warehouse_id: warehouseId,
      movement_type: b.movement_type, value: movementValue, date: movementDate,
      item_name: itemRow?.name ?? String(b.item_code), created_by: userId,
      center_code: centerCode, supplier_code: b.supplier_code, work_order_id: b.work_order_id,
      season_id: resolvedSeasonId, field_id: resolvedFieldId, crop_cycle_id: b.crop_cycle_id ?? null,
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

  const response = c.json({ success: true, data: { id: movId } }, 201)
  if (usedStringWarehouse) {
    console.warn(`[DEPRECATION] POST /movements: 'warehouse' string param used by company ${company_id}. Use 'warehouse_id' integer instead.`)
    c.header('X-Deprecated-Param', 'warehouse; use warehouse_id instead')
  }
  return response
})

// ── POST /movements/:id/reverse ──────────────────────────────
// Creates a mirror movement that fully negates a posted movement.
// The original movement is marked is_reversed = 1.
// The reversal movement references reversal_of_id = original.id.
// Only movements with gl_posting_status IN ('posted', 'pending', 'failed') can be reversed.
// Zero-value and already-reversed movements are blocked.

movements.post('/movements/:id/reverse', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const origId = Number(c.req.param('id'))
  if (!origId) return c.json({ success: false, error: 'معرف الحركة غير صحيح' }, 400)

  const b: { reason?: string; reversal_date?: string } = await c.req.json<{ reason?: string; reversal_date?: string }>().catch(() => ({}))

  // 1. Load original movement
  const orig = await c.env.DB.prepare(
    `SELECT im.*,
            w.name AS warehouse_name
     FROM inventory_movements im
     LEFT JOIN warehouses w ON w.id = im.warehouse_id AND w.company_id = im.company_id
     WHERE im.id = ? AND im.company_id = ?`
  ).bind(origId, company_id).first<{
    id: number; company_id: number; item_code: number; warehouse_id: number; warehouse_name: string | null
    movement_type: string; movement_date: string; quantity: number; unit_price: number
    qty_in: number; qty_out: number; value_in: number; value_out: number
    season_id: number | null; field_id: number | null; work_order_id: number | null; crop_cycle_id: number | null
    supplier_code: number | null; document_number: string | null; center_code: number | null
    statement_text: string | null; service_type_code: string | null; notes: string | null
    gl_posting_status: string; journal_entry_id: number | null
    is_reversed: number | null; reversal_of_id: number | null
    posting_mode: string; zero_value_reason: string | null
  }>()

  if (!orig) return c.json({ success: false, error: 'الحركة غير موجودة' }, 404)

  if (orig.is_reversed) {
    return c.json({ success: false, error: 'هذه الحركة تم عكسها مسبقاً' }, 409)
  }
  if (orig.reversal_of_id) {
    return c.json({ success: false, error: 'لا يمكن عكس حركة عكسية' }, 409)
  }
  if (orig.gl_posting_status === 'exempt_zero_value') {
    return c.json({ success: false, error: 'حركة القيمة الصفرية لا تحتاج إلى عكس' }, 409)
  }

  // 2. Check period + lock date
  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  const reversalDate = b.reversal_date
    ? normalizeIsoDate(b.reversal_date)
    : new Date().toISOString().slice(0, 10)

  try {
    enforceInventoryLockDate(controls, reversalDate)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, reversalDate)
  if (!periodId) return c.json({ success: false, error: 'لا توجد فترة مالية مفتوحة لتاريخ العكس' }, 400)

  // 3. Reversal inverts qty direction — inbound becomes outbound and vice versa
  const isOrigInbound = orig.qty_in > 0
  const revQtyIn    = isOrigInbound ? 0 : orig.quantity
  const revQtyOut   = isOrigInbound ? orig.quantity : 0
  const revValueIn  = isOrigInbound ? 0 : orig.value_out  // original value_out is now the reverse value_in
  const revValueOut = isOrigInbound ? orig.value_in : 0   // original value_in is now the reverse value_out
  const revValue    = Math.max(revValueIn, revValueOut)

  // Reversal movement type is the mirror type
  const REVERSAL_TYPES: Record<string, string> = {
    GRN:               'RETURN_SUPPLIER',
    ISSUE:             'RETURN_CUSTOMER',
    TRANSFER_IN:       'TRANSFER_OUT',
    TRANSFER_OUT:      'TRANSFER_IN',
    RETURN_SUPPLIER:   'GRN',
    RETURN_CUSTOMER:   'ISSUE',
    ADJUSTMENT_PROFIT: 'ADJUSTMENT_LOSS',
    ADJUSTMENT_LOSS:   'ADJUSTMENT_PROFIT',
    PRODUCTION_INPUT:  'PRODUCTION_OUTPUT',
    PRODUCTION_OUTPUT: 'PRODUCTION_INPUT',
  }
  const reversalType = REVERSAL_TYPES[orig.movement_type] ?? orig.movement_type

  // 4. Stock check: if reversal is outbound, ensure enough balance exists
  const prev = await readInventoryBalance(c.env.DB, company_id, orig.item_code, orig.warehouse_id)
  if (revQtyOut > 0 && prev.balance_qty < revQtyOut) {
    return c.json({
      success: false,
      error: `رصيد غير كافٍ للعكس: الرصيد الحالي ${prev.balance_qty}، الكمية المطلوبة ${revQtyOut}`,
      code: 'INSUFFICIENT_STOCK',
    }, 409)
  }

  const ym = yearMonthParts(reversalDate)
  const localId = `inv_rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const transactionId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)
  const newBalQty = prev.balance_qty + revQtyIn - revQtyOut
  const newBalVal = prev.balance_value + revValueIn - revValueOut

  // 5. Insert reversal movement + mark original as reversed (batch)
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, crop_cycle_id, supplier_code, item_code, center_code,
        movement_date, warehouse_id, movement_type, document_number,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, statement_text, service_type_code, year, month, created_by_user_id, local_id,
        posting_mode, gl_posting_status, transaction_id, reversal_of_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, orig.season_id, orig.field_id, orig.work_order_id,
      orig.crop_cycle_id,
      orig.supplier_code,
      orig.item_code, orig.center_code, reversalDate, orig.warehouse_id,
      reversalType, orig.document_number ? `REV-${orig.document_number}` : null,
      orig.quantity, orig.unit_price,
      revQtyIn, revQtyOut, newBalQty, revValueIn, revValueOut, newBalVal,
      b.reason ? `عكس: ${b.reason}` : `عكس الحركة رقم ${origId}`,
      orig.statement_text, orig.service_type_code,
      ym.year, ym.month, userId, localId,
      controls.posting_mode,
      revValue === 0 ? 'exempt_zero_value' : 'pending',
      transactionId, origId,
    ),
    c.env.DB.prepare(
      `UPDATE inventory_movements SET is_reversed = 1 WHERE id = ? AND company_id = ?`
    ).bind(origId, company_id),
  ])

  // 6. Get new movement id
  const revRow = await c.env.DB.prepare(
    'SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?'
  ).bind(localId, company_id).first<{ id: number }>()
  const revId = revRow!.id

  // 7. Update balance snapshot
  await upsertInventoryBalance(c.env.DB, company_id, orig.item_code, orig.warehouse_id, newBalQty, newBalVal, revId, prev.version)

  // 8. Enqueue GL reversal posting
  if (revValue > 0) {
    const itemRow = await c.env.DB.prepare(
      'SELECT name FROM items WHERE code = ? AND company_id = ?'
    ).bind(orig.item_code, company_id).first<{ name: string }>()
    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', revId, {
      company_id, ref_id: revId, item_code: orig.item_code, warehouse_id: orig.warehouse_id,
      movement_type: reversalType, value: revValue, date: reversalDate,
      item_name: itemRow?.name ?? String(orig.item_code), created_by: userId,
      center_code: orig.center_code, supplier_code: orig.supplier_code,
      season_id: orig.season_id, field_id: orig.field_id, crop_cycle_id: orig.crop_cycle_id,
      reversal_of_id: origId,
    })
  }

  return c.json({
    success: true,
    data: {
      reversal_id:  revId,
      original_id:  origId,
      reversal_type: reversalType,
      quantity:     orig.quantity,
      reversal_date: reversalDate,
    },
  }, 201)
})

// ── POST /movements/batch ─────────────────────────────────────
// Handles multiple movements in a single request.
// Used by the manual entry UI for bulk GRN/ISSUE.

movements.post('/movements/batch', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  
  // Accept BOTH structures: Flat array (movements[]) or Header-Lines (items[])
  const b = await c.req.json<{
    movements?: any[]
    items?: any[]
    // Header fields (for items structure)
    movement_date?: string; warehouse?: string; warehouse_id?: number; movement_type?: string
    supplier_code?: number; document_number?: string; notes?: string
    statement_text?: string; service_type_code?: string
    season_id?: number; field_id?: number; work_order_id?: number; crop_cycle_id?: number
    center_code?: number; payment_method?: 'cash' | 'credit'
  }>()

  const items = b.movements ?? b.items
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ success: false, error: 'أضف حركة واحدة على الأقل' }, 400)
  }

  const results: number[] = []
  const controls = await getInventoryPostingControls(c.env.DB, company_id)

  // ── Phase 1: validate all items before writing any ──────────────────────────
  // This prevents partial-write states where early items succeed and later items fail validation.
  const validatedItems: Array<{
    idx: number; item: any; mDate: string; mType: string; warehouseId: number
    isInbound: boolean; batchItemIsNonStock: boolean; unitPrice: number; movementValue: number
    localId: string; ym: { year: number; month: number }; transactionId: number
    qtyIn: number; qtyOut: number; valueIn: number; valueOut: number
    supplierCode: any; docNum: any; statementText: string | null; serviceTypeCode: string | null; notes: any
    seasonId: number | null; fieldId: number | null; woId: number | null; cropCycleId: number | null
    centerCode: any; periodId: number; prev: { balance_qty: number; balance_value: number; version: number }
  }> = []

  for (const [idx, item] of items.entries()) {
    // Resolve fields: use item-specific value OR fallback to header value
    const mDate = item.movement_date ?? b.movement_date
    const mType = item.movement_type ?? b.movement_type
    const whId  = item.warehouse_id  ?? b.warehouse_id
    const whName= item.warehouse     ?? b.warehouse

    if (!mDate || (!whId && !whName) || !mType || !item.item_code || !item.quantity) {
      throw new Error(`MISSING_FIELDS_FOR_ITEM:${item.item_code}`)
    }

    assertPackagingInvariant(item.quantity, item.pack_count, item.pack_capacity, item.item_code)

    const itemTypeCheck = await c.env.DB.prepare(
      'SELECT item_type, is_purchasable, is_sellable, expiry_tracking FROM items WHERE code = ? AND company_id = ?'
    ).bind(item.item_code, company_id).first<{ item_type: string | null; is_purchasable: number; is_sellable: number; expiry_tracking: number }>()
    if (!itemTypeCheck) throw new Error(`ITEM_NOT_FOUND:${item.item_code}`)
    if (itemTypeCheck.item_type === 'service') {
      throw new Error(`SERVICE_ITEM_NO_STOCK:${item.item_code}`)
    }
    if ((mType === 'GRN' || mType === 'RETURN_SUPPLIER') && !itemTypeCheck.is_purchasable) {
      throw new Error(`ITEM_NOT_PURCHASABLE:${item.item_code}`)
    }
    if ((mType === 'RETURN_CUSTOMER' || mType === 'SALE') && !itemTypeCheck.is_sellable) {
      throw new Error(`ITEM_NOT_SELLABLE:${item.item_code}`)
    }
    const batchItemIsNonStock = itemTypeCheck.item_type === 'non_stock'

    const movementDate = normalizeIsoDate(mDate)
    if (isFutureIsoDate(movementDate)) throw new Error(`FUTURE_DATE_NOT_ALLOWED:${item.item_code}`)

    const wh = await resolveWarehouse(c.env.DB, company_id, whId, whName)
    if (!wh) throw new Error(`UNKNOWN_WAREHOUSE:${item.item_code}`)
    const warehouseId = wh.id

    const isInbound = resolveMovementDirection(mType) === 'IN'

    if (isInbound && itemTypeCheck.expiry_tracking && !item.expiry_date) {
      throw new Error(`EXPIRY_DATE_REQUIRED:${item.item_code}`)
    }
    enforceInventoryLockDate(controls, movementDate)

    const periodId = await getOpenPeriod(c.env.DB, company_id, movementDate)
    if (!periodId) throw new Error(`PERIOD_CLOSED:${movementDate}`)

    // Merge dimensions — work_order_id auto-fills season/field/center if not explicitly provided
    const centerCode = item.center_code ?? b.center_code
    let seasonId = item.season_id ?? b.season_id ?? null
    let fieldId = item.field_id ?? b.field_id ?? null
    const woId = item.work_order_id ?? b.work_order_id ?? null
    const cropCycleId = item.crop_cycle_id ?? b.crop_cycle_id ?? null

    if (woId && (!seasonId || !fieldId || !centerCode)) {
      const wo = await c.env.DB.prepare(
        'SELECT field_id, season_id, center_code FROM work_orders WHERE id = ? AND company_id = ?'
      ).bind(woId, company_id).first<{ field_id: number | null; season_id: number | null; center_code: number | null }>()
      if (wo) {
        if (!fieldId && wo.field_id)    fieldId  = wo.field_id
        if (!seasonId && wo.season_id)  seasonId = wo.season_id
      }
    }

    if (mType === 'ISSUE' && seasonId == null) throw new Error(`ISSUE_REQUIRES_SEASON:${item.item_code}`)

    const prev = batchItemIsNonStock
      ? { balance_qty: 0, balance_value: 0, version: 0 }
      : await readInventoryBalance(c.env.DB, company_id, item.item_code, warehouseId)
    if (!batchItemIsNonStock && !isInbound && item.quantity > prev.balance_qty) {
      throw new Error(`INSUFFICIENT_STOCK:${item.item_code} (Available: ${prev.balance_qty})`)
    }

    const derivedBatchUnitPrice = item.total_value != null && item.quantity > 0
      ? item.total_value / item.quantity
      : (item.unit_price ?? (prev.balance_qty > 0 ? prev.balance_value / prev.balance_qty : 0))
    const unitPrice = Math.max(0, Math.round(derivedBatchUnitPrice * 10000) / 10000)
    const movementValue = Math.round(item.quantity * unitPrice * 100) / 100
    validateZeroValuePolicy(controls, role, movementValue, item.zero_value_reason ?? b.notes)

    const localId = `inv_batch_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 9)}`
    const ym = yearMonthParts(movementDate)
    const transactionId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)

    const qtyIn = isInbound ? item.quantity : 0
    const qtyOut = isInbound ? 0 : item.quantity
    const valueIn = Math.round((isInbound ? movementValue : 0) * 100) / 100
    const valueOut = Math.round((isInbound ? 0 : movementValue) * 100) / 100

    const supplierCode = item.supplier_code ?? b.supplier_code
    const docNum = item.document_number ?? b.document_number
    const sText = item.statement_text ?? b.statement_text
    const notes = item.notes ?? b.notes
    const sType = item.service_type_code ?? b.service_type_code

    const { statementText, serviceTypeCode } = await validateInventoryGovernance(c.env.DB, company_id, {
      movement_type: mType, supplier_code: supplierCode, document_number: docNum,
      center_code: centerCode, statement_text: sText, notes: notes, service_type_code: sType,
      work_order_id: woId,
    })

    validatedItems.push({
      idx, item, mDate: movementDate, mType, warehouseId, isInbound, batchItemIsNonStock,
      unitPrice, movementValue, localId, ym, transactionId,
      qtyIn, qtyOut, valueIn, valueOut,
      supplierCode, docNum, statementText, serviceTypeCode, notes,
      seasonId, fieldId, woId, cropCycleId, centerCode, periodId,
      prev,
    })
  }

  // ── Phase 2: execute all writes atomically via D1 batch ─────────────────────
  // All validation passed; submit inserts + propagation updates as one D1 batch.
  // D1 batch is transactional: either all succeed or all fail.
  type D1PreparedStatement = ReturnType<typeof c.env.DB.prepare>
  const writeStatements: D1PreparedStatement[] = []
  const outboxPayloads: Array<{ movIdx: number; payload: Record<string, unknown> }> = []

  for (const v of validatedItems) {
    const { item, mDate, mType, warehouseId, batchItemIsNonStock, unitPrice, movementValue,
            localId, ym, transactionId, qtyIn, qtyOut, valueIn, valueOut,
            supplierCode, docNum, statementText, serviceTypeCode, notes,
            seasonId, fieldId, woId, cropCycleId, centerCode, prev } = v

    writeStatements.push(
      c.env.DB.prepare(
        `INSERT INTO inventory_movements
         (company_id, season_id, field_id, work_order_id, crop_cycle_id, supplier_code, item_code, center_code,
          movement_date, warehouse_id, movement_type, document_number, batch_number, expiry_date,
          pack_capacity, pack_count, quantity, unit_price, total_value_entered, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
          notes, statement_text, service_type_code, year, month, created_by_user_id, local_id,
          zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        company_id, seasonId ?? null, fieldId ?? null, woId ?? null, cropCycleId,
        supplierCode ?? null, item.item_code, centerCode ?? null,
        mDate, warehouseId, mType, docNum ?? null,
        item.batch_number ?? null, item.expiry_date ?? null,
        item.pack_capacity ?? null, item.pack_count ?? null, item.quantity, unitPrice, item.total_value ?? null,
        qtyIn, qtyOut,
        batchItemIsNonStock ? 0 : prev.balance_qty + qtyIn - qtyOut,
        valueIn, valueOut,
        batchItemIsNonStock ? 0 : prev.balance_value + valueIn - valueOut,
        notes ?? null, statementText, serviceTypeCode, ym.year, ym.month, userId, localId,
        movementValue === 0 ? (item.zero_value_reason ?? b.notes) : null,
        movementValue === 0 ? role : null,
        controls.posting_mode,
        movementValue === 0 ? 'exempt_zero_value' : 'pending',
        transactionId,
      )
    )

    if (!batchItemIsNonStock) {
      // Propagation UPDATE uses last_insert_rowid() so the WHERE clause
      // excludes the row we just inserted (avoids updating the new row's own balance).
      writeStatements.push(
        c.env.DB.prepare(
          `UPDATE inventory_movements
           SET balance_qty = balance_qty + ?, balance_value = balance_value + ?
           WHERE company_id = ? AND item_code = ? AND warehouse_id = ?
             AND id != last_insert_rowid()
             AND (movement_date > ? OR (movement_date = ? AND id > last_insert_rowid()))`
        ).bind(qtyIn - qtyOut, valueIn - valueOut, company_id, item.item_code, warehouseId, mDate, mDate)
      )

      writeStatements.push(
        c.env.DB.prepare(
          `INSERT INTO inventory_balances
             (company_id, item_code, warehouse_id, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
           VALUES (?, ?, ?, ?, ?, 1, last_insert_rowid(), datetime('now'), 0)
           ON CONFLICT(company_id, item_code, warehouse_id) DO UPDATE SET
             balance_qty      = excluded.balance_qty,
             balance_value    = excluded.balance_value,
             version          = inventory_balances.version + 1,
             last_movement_id = excluded.last_movement_id,
             last_updated     = excluded.last_updated,
             is_stale         = 0`
        ).bind(
          company_id, item.item_code, warehouseId,
          prev.balance_qty + qtyIn - qtyOut,
          prev.balance_value + valueIn - valueOut,
        )
      )
    }

    if (movementValue > 0) {
      outboxPayloads.push({
        movIdx: v.idx,
        payload: {
          company_id, item_code: item.item_code, warehouse_id: warehouseId,
          movement_type: mType, value: movementValue, date: mDate,
          item_name: String(item.item_code), created_by: userId,
          center_code: centerCode, supplier_code: supplierCode, work_order_id: woId,
          season_id: seasonId, field_id: fieldId, crop_cycle_id: cropCycleId,
        },
      })
    }
  }

  // Execute all write statements atomically
  const batchResults = await c.env.DB.batch(writeStatements)

  // Extract inserted IDs: batchResults[0], batchResults[N] correspond to INSERT statements
  // Every non-stock item generates: [INSERT, UPDATE, UPSERT] = 3 statements
  // Every non-stock item without propagation (batchItemIsNonStock=true) generates: [INSERT] = 1 statement
  let stmtOffset = 0
  for (const v of validatedItems) {
    const insertResult = batchResults[stmtOffset]
    const movId = Number(insertResult.meta.last_row_id)
    results.push(movId)
    stmtOffset += v.batchItemIsNonStock ? 1 : 3
  }

  // Post outbox entries after successful batch (best-effort; not part of atomic batch due to size limits)
  for (const { movIdx, payload } of outboxPayloads) {
    const movId = results[movIdx]
    if (!movId) continue
    try {
      await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', movId, {
        ...payload, ref_id: movId,
      })
    } catch (outboxErr) {
      console.error(`[Batch] Outbox enqueue failed for movement ${movId}:`, (outboxErr as Error).message)
    }
  }

  return c.json({ success: true, count: results.length, ids: results })
})

export default movements
