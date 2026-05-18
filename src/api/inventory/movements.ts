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

  try {
    assertPackagingInvariant(b.quantity, b.pack_count, b.pack_capacity, b.item_code)
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: 'PACKAGING_MISMATCH' }, 422)
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
  await upsertInventoryBalance(c.env.DB, company_id, b.item_code, warehouseId, prev.balance_qty + qtyIn - qtyOut, prev.balance_value + valueIn - valueOut, movId, prev.version)

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
    season_id: number | null; field_id: number | null; work_order_id: number | null
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
       (company_id, season_id, field_id, work_order_id, supplier_code, item_code, center_code,
        movement_date, warehouse_id, movement_type, document_number,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, statement_text, service_type_code, year, month, created_by_user_id, local_id,
        posting_mode, gl_posting_status, transaction_id, reversal_of_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, orig.season_id, orig.field_id, orig.work_order_id, orig.supplier_code,
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
    season_id?: number; field_id?: number; work_order_id?: number
    center_code?: number; payment_method?: 'cash' | 'credit'
  }>()

  const items = b.movements ?? b.items
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ success: false, error: 'أضف حركة واحدة على الأقل' }, 400)
  }

  const results: number[] = []
  const controls = await getInventoryPostingControls(c.env.DB, company_id)

  for (const item of items) {
    // Resolve fields: use item-specific value OR fallback to header value
    const mDate = item.movement_date ?? b.movement_date
    const mType = item.movement_type ?? b.movement_type
    const whId  = item.warehouse_id  ?? b.warehouse_id
    const whName= item.warehouse     ?? b.warehouse

    if (!mDate || (!whId && !whName) || !mType || !item.item_code || !item.quantity) {
      throw new Error(`MISSING_FIELDS_FOR_ITEM:${item.item_code}`)
    }

    assertPackagingInvariant(item.quantity, item.pack_count, item.pack_capacity, item.item_code)

    const movementDate = normalizeIsoDate(mDate)
    if (isFutureIsoDate(movementDate)) throw new Error(`FUTURE_DATE_NOT_ALLOWED:${item.item_code}`)

    const wh = await resolveWarehouse(c.env.DB, company_id, whId, whName)
    if (!wh) throw new Error(`UNKNOWN_WAREHOUSE:${item.item_code}`)
    const warehouseId = wh.id

    const isInbound = resolveMovementDirection(mType) === 'IN'
    enforceInventoryLockDate(controls, movementDate)

    const periodId = await getOpenPeriod(c.env.DB, company_id, movementDate)
    if (!periodId) throw new Error(`PERIOD_CLOSED:${movementDate}`)

    const prev = await readInventoryBalance(c.env.DB, company_id, item.item_code, warehouseId)
    if (!isInbound && item.quantity > prev.balance_qty) {
      throw new Error(`INSUFFICIENT_STOCK:${item.item_code} (Available: ${prev.balance_qty})`)
    }

    const unitPrice = item.unit_price ?? (prev.balance_qty > 0 ? prev.balance_value / prev.balance_qty : 0)
    const movementValue = item.quantity * unitPrice
    validateZeroValuePolicy(controls, role, movementValue, item.zero_value_reason ?? b.notes)

    const localId = `inv_batch_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
    const ym = yearMonthParts(movementDate)
    const transactionId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)

    const qtyIn = isInbound ? item.quantity : 0
    const qtyOut = isInbound ? 0 : item.quantity
    const valueIn = isInbound ? movementValue : 0
    const valueOut = isInbound ? 0 : movementValue

    // Merge dimensions
    const centerCode = item.center_code ?? b.center_code
    const supplierCode = item.supplier_code ?? b.supplier_code
    const docNum = item.document_number ?? b.document_number
    const seasonId = item.season_id ?? b.season_id
    const fieldId = item.field_id ?? b.field_id
    const woId = item.work_order_id ?? b.work_order_id
    const sText = item.statement_text ?? b.statement_text
    const notes = item.notes ?? b.notes
    const sType = item.service_type_code ?? b.service_type_code

    const { statementText, serviceTypeCode } = await validateInventoryGovernance(c.env.DB, company_id, {
      movement_type: mType, supplier_code: supplierCode, document_number: docNum,
      center_code: centerCode, statement_text: sText, notes: notes, service_type_code: sType,
    })

    const insertRes = await c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, supplier_code, item_code, center_code,
        movement_date, warehouse_id, movement_type, document_number, batch_number, expiry_date,
        pack_capacity, pack_count, quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, statement_text, service_type_code, year, month, created_by_user_id, local_id,
        zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, seasonId ?? null, fieldId ?? null, woId ?? null,
      supplierCode ?? null, item.item_code, centerCode ?? null,
      movementDate, warehouseId, mType, docNum ?? null,
      item.batch_number ?? null, item.expiry_date ?? null,
      item.pack_capacity ?? null, item.pack_count ?? null, item.quantity, unitPrice,
      qtyIn, qtyOut, prev.balance_qty + qtyIn - qtyOut, valueIn, valueOut, prev.balance_value + valueIn - valueOut,
      notes ?? null, statementText, serviceTypeCode, ym.year, ym.month, userId, localId,
      movementValue === 0 ? (item.zero_value_reason ?? b.notes) : null,
      movementValue === 0 ? role : null,
      controls.posting_mode,
      movementValue === 0 ? 'exempt_zero_value' : 'pending',
      transactionId,
    ).run()

    const movId = Number(insertRes.meta.last_row_id)
    results.push(movId)

    await upsertInventoryBalance(c.env.DB, company_id, item.item_code, warehouseId, prev.balance_qty + qtyIn - qtyOut, prev.balance_value + valueIn - valueOut, movId, prev.version)

    if (movementValue > 0) {
      const itemRow = await c.env.DB.prepare('SELECT name FROM items WHERE code = ? AND company_id = ?').bind(item.item_code, company_id).first<{name:string}>()
      await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', movId, {
        company_id, ref_id: movId, item_code: item.item_code, warehouse_id: warehouseId,
        movement_type: mType, value: movementValue, date: movementDate,
        item_name: itemRow?.name ?? String(item.item_code), created_by: userId,
        center_code: centerCode, supplier_code: supplierCode, work_order_id: woId,
      })
    }
  }

  return c.json({ success: true, count: results.length, ids: results })
})

export default movements
