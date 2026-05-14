import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { resolveMovementDirection } from '../../lib/posting_engine'
import { FinanceCore } from '../../lib/finance_core'
import { logAudit } from '../../lib/audit'
import { logFinancialWorkflowFailure } from '../../lib/finance/workflow_policy'
import { enforceDataQualityPolicy } from '../../lib/data_quality'
import { normalizeIsoDate, isFutureIsoDate, yearMonthParts } from '../../lib/utils/date'
import { isActiveCenterCode } from '../../lib/dimension_validator'
import {
  enforceInventoryLockDate,
  enqueueInventoryPostingOutbox,
  getInventoryPostingControls,
  readInventoryBalance,
  upsertInventoryBalance,
  validateZeroValuePolicy,
} from '../../lib/inventory_posting'

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
// ── Helper: map legacy Arabic / typed movement_type to transaction_type ───────
function mapToTransactionType(movementType: string): string {
  const MAP: Record<string, string> = {
    'GRN':               'GRN',
    'ISSUE':             'ISSUE',
    'TRANSFER_IN':       'TRANSFER_IN',
    'TRANSFER_OUT':      'TRANSFER_OUT',
    'RETURN_SUPPLIER':   'RETURN_SUPPLIER',
    'RETURN_CUSTOMER':   'RETURN_CUSTOMER',
    'ADJUSTMENT_PROFIT': 'ADJUSTMENT_PROFIT',
    'ADJUSTMENT_LOSS':   'ADJUSTMENT_LOSS',
    'PRODUCTION_INPUT':  'PRODUCTION_INPUT',
    'PRODUCTION_OUTPUT': 'PRODUCTION_OUTPUT',
  }
  return MAP[movementType] ?? movementType
}


async function tableExists(db: Env['DB'], tableName: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
  ).bind(tableName).first<{ ok: number }>()
  return !!row?.ok
}

async function isKnownServiceTypeCode(db: Env['DB'], company_id: number, code: string): Promise<boolean> {
  const normalized = code.trim()
  if (!normalized) return false

  const row = await db.prepare(
    'SELECT 1 AS ok FROM service_types WHERE company_id = ? AND code = ? AND is_active = 1 LIMIT 1'
  ).bind(company_id, normalized).first<{ ok: number }>()
  return !!row?.ok
}

async function isSupplierAuthorizedForService(
  db: Env['DB'],
  company_id: number,
  supplier_code: number,
  service_type_code: string,
): Promise<boolean> {
  if (!(await tableExists(db, 'supplier_service_map'))) {
    return true
  }

  const row = await db.prepare(
    `SELECT 1 AS ok
     FROM supplier_service_map
     WHERE company_id = ? AND supplier_code = ? AND service_type_code = ? AND is_active = 1
     LIMIT 1`
  ).bind(company_id, supplier_code, service_type_code).first<{ ok: number }>()

  return !!row?.ok
}

async function validateInventoryGovernance(
  db: Env['DB'],
  company_id: number,
  input: {
    movement_type: string
    supplier_code?: number | null
    document_number?: number | null
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
    if (!input.work_order_id) {
      console.warn(`[inventory] ISSUE movement created without work_order_id (center=${input.center_code}). Traceability reduced.`);
    }
  }

  if (serviceTypeCode) {
    const known = await isKnownServiceTypeCode(db, company_id, serviceTypeCode)
    if (!known) {
      throw new Error('UNKNOWN_SERVICE_TYPE_CODE')
    }
    if (input.supplier_code != null) {
      const authorized = await isSupplierAuthorizedForService(db, company_id, input.supplier_code, serviceTypeCode)
      if (!authorized) {
        throw new Error('SUPPLIER_NOT_AUTHORIZED_FOR_SERVICE')
      }
    }
  }

  return { statementText, serviceTypeCode }
}

async function ensureOutboxQueued(
  db: Env['DB'],
  companyId: number,
  eventType: 'inventory_movement' | 'inventory_transfer',
  movementId: number,
): Promise<void> {
  const row = await db.prepare(
    `SELECT id
     FROM inventory_posting_outbox
     WHERE company_id = ? AND event_type = ? AND movement_id = ?
     ORDER BY id DESC
     LIMIT 1`
  ).bind(companyId, eventType, movementId)
    .first<{ id: number }>()

  if (!row?.id) {
    throw new Error(`OUTBOX_ENQUEUE_FAILED:${eventType}:${movementId}`)
  }
}

async function markMovementFinancialFailure(
  db: Env['DB'],
  companyId: number,
  userId: number,
  movementId: number,
  reason: string,
): Promise<void> {
  await db.prepare(
    `UPDATE inventory_movements
     SET gl_posting_status = 'failed',
         gl_posting_error = ?,
         gl_posted_at = datetime('now')
     WHERE id = ? AND company_id = ?`
  ).bind(reason, movementId, companyId).run()

  await logFinancialWorkflowFailure(db, {
    company_id: companyId,
    user_id: userId,
    module: 'inventory',
    stage: 'mark_inventory_financial_failure',
    table_name: 'inventory_movements',
    record_id: movementId,
    error: reason,
    context: { movement_id: movementId },
  })
}

// ── GET /movements ────────────────────────────────────────────

movements.get('/movements', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(200, Number(c.req.query('size') ?? 100))
  const warehouse = c.req.query('warehouse')
  const itemCode  = c.req.query('item_code')
  const type      = c.req.query('type')
  const start     = c.req.query('start')
  const end       = c.req.query('end')
  const fieldId   = c.req.query('field_id')
  const seasonId  = c.req.query('season_id')
  const workOrderId = c.req.query('work_order_id')
  const offset    = (page - 1) * size

  let where   = 'WHERE im.company_id = ?'
  const binds: unknown[] = [company_id]

  if (warehouse)   { where += ' AND im.warehouse = ?';       binds.push(warehouse) }
  if (itemCode)    { where += ' AND im.item_code = ?';       binds.push(Number(itemCode)) }
  if (type)        { where += ' AND im.movement_type = ?';   binds.push(type) }
  if (start)       { where += ' AND im.movement_date >= ?';  binds.push(start) }
  if (end)         { where += ' AND im.movement_date <= ?';  binds.push(end) }
  if (fieldId)     { where += ' AND im.field_id = ?';        binds.push(Number(fieldId)) }
  if (seasonId)    { where += ' AND im.season_id = ?';       binds.push(Number(seasonId)) }
  if (workOrderId) { where += ' AND im.work_order_id = ?';   binds.push(Number(workOrderId)) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT im.id, im.movement_date, im.warehouse, im.movement_type,
              im.item_code, i.name AS item_name, i.unit,
              im.quantity, im.unit_price, im.qty_in, im.qty_out, im.balance_qty,
              im.value_in, im.value_out, im.balance_value,
              s.name AS supplier_name, im.document_number, im.notes,
              im.season_id, im.field_id, f.name AS field_name,
              im.work_order_id, wo.name AS work_order_name,
              im.center_code, cc.name_ar AS center_name,
              im.related_movement_id,
              im.journal_entry_id,
              im.zero_value_reason,
              im.zero_value_approved_by_role,
              im.posting_mode,
              im.gl_posting_status,
              im.gl_posting_error,
              im.gl_posted_at
       FROM inventory_movements im
       LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
       LEFT JOIN suppliers s ON s.code = im.supplier_code AND s.company_id = im.company_id
       LEFT JOIN cost_centers cc ON cc.code = im.center_code AND cc.company_id = im.company_id
       LEFT JOIN fields f ON f.id = im.field_id AND f.company_id = im.company_id
       LEFT JOIN work_orders wo ON wo.id = im.work_order_id AND wo.company_id = im.company_id
       ${where}
       ORDER BY im.movement_date DESC, im.id DESC LIMIT ? OFFSET ?`
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
    movement_date: string; warehouse: string; movement_type: string
    item_code: number; quantity: number; unit_price?: number
    supplier_code?: number; document_number?: number; notes?: string
    statement_text?: string; service_type_code?: string
    season_id?: number; field_id?: number; work_order_id?: number
    center_code?: number; pack_capacity?: number; pack_count?: number
    payment_method?: 'cash' | 'credit'
    zero_value_reason?: string
  }>()

  if (!b.movement_date || !b.warehouse || !b.movement_type || !b.item_code || !b.quantity) {
    return c.json({ success: false, error: 'بيانات الحركة ناقصة' }, 400)
  }
  if (!isSupportedMovementType(b.movement_type)) {
    return c.json({ success: false, error: 'نوع حركة غير مدعوم' }, 400)
  }

  let movementDate: string
  try {
    movementDate = normalizeIsoDate(b.movement_date)
  } catch (err: any) {
    return c.json({ success: false, error: err?.message ?? 'صيغة تاريخ الحركة غير صحيحة' }, 422)
  }

  if (isFutureIsoDate(movementDate)) {
    return c.json({ success: false, error: 'غير مسموح بترحيل حركة مخزنية بتاريخ مستقبلي' }, 422)
  }

  const direction = resolveMovementDirection(b.movement_type)
  const isInbound = direction === 'IN'

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try {
    enforceInventoryLockDate(controls, movementDate)
  } catch (e: any) {
    return c.json({ success: false, error: `الفترة المخزنية مغلقة حتى ${controls.locked_through_date}`, code: 'INVENTORY_PERIOD_LOCKED' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, movementDate)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${movementDate}` }, 400)
  }

  let centerCode = b.center_code
  if (!centerCode && b.field_id) {
    const field = await c.env.DB.prepare("SELECT center_code FROM fields WHERE id = ? AND company_id = ?")
      .bind(b.field_id, company_id).first<{ center_code: number }>()
    if (field?.center_code) centerCode = field.center_code
  }

  // Operational context inheritance: when linked to a Work Order,
  // inherit dimensions (field, season, center) from the WO if not explicitly set.
  // This ensures inventory consumption always carries full operational attribution
  // without requiring the operator to re-enter context that exists on the WO.
  let resolvedFieldId = b.field_id ?? null
  let resolvedSeasonId = b.season_id ?? null
  if (b.work_order_id) {
    const wo = await c.env.DB.prepare(
      'SELECT field_id, season_id, center_code FROM work_orders WHERE id = ? AND company_id = ?'
    ).bind(b.work_order_id, company_id).first<{ field_id: number | null; season_id: number | null; center_code: number | null }>()
    if (!wo) {
      return c.json({ success: false, error: 'أمر العمل المحدد غير موجود' }, 422)
    }
    if (!resolvedFieldId && wo.field_id) resolvedFieldId = wo.field_id
    if (!resolvedSeasonId && wo.season_id) resolvedSeasonId = wo.season_id
    if (!centerCode && wo.center_code) centerCode = wo.center_code
  }

  if (b.movement_type === 'GRN' && resolvedSeasonId == null) {
    return c.json({ success: false, error: 'الموسم مطلوب في استلام المخزون GRN' }, 422)
  }

  if (centerCode != null) {
    const isValidCenter = await isActiveCenterCode(c.env.DB, company_id, centerCode)
    if (!isValidCenter) {
      return c.json({ success: false, error: 'مركز التكلفة غير موجود أو غير نشط' }, 422)
    }
  }

  let statementText: string | null
  let serviceTypeCode: string | null
  try {
    ({ statementText, serviceTypeCode } = await validateInventoryGovernance(c.env.DB, company_id, {
      movement_type: b.movement_type,
      supplier_code: b.supplier_code ?? null,
      document_number: b.document_number ?? null,
      center_code: centerCode ?? null,
      statement_text: b.statement_text ?? null,
      notes: b.notes ?? null,
      service_type_code: b.service_type_code ?? null,
    }))
  } catch (e: any) {
    if (e.message === 'GRN_REQUIRES_SUPPLIER') {
      return c.json({ success: false, error: 'كود المورد مطلوب في استلام المخزون GRN' }, 422)
    }
    if (e.message === 'GRN_REQUIRES_DOCUMENT') {
      return c.json({ success: false, error: 'رقم المستند مطلوب في استلام المخزون GRN' }, 422)
    }
    if (e.message === 'ISSUE_REQUIRES_CENTER') {
      return c.json({ success: false, error: 'مركز التكلفة مطلوب في صرف المخزون ISSUE' }, 422)
    }
    if (e.message === 'ISSUE_REQUIRES_STATEMENT') {
      return c.json({ success: false, error: 'البيان مطلوب في صرف المخزون ISSUE ويجب ألا يقل عن 3 أحرف' }, 422)
    }
    if (e.message === 'ISSUE_REQUIRES_SERVICE_TYPE') {
      return c.json({ success: false, error: 'service_type_code مطلوب في صرف المخزون ISSUE' }, 422)
    }
    if (e.message === 'UNKNOWN_SERVICE_TYPE_CODE') {
      return c.json({ success: false, error: 'service_type_code غير معروف أو غير نشط' }, 422)
    }
    if (e.message === 'SUPPLIER_NOT_AUTHORIZED_FOR_SERVICE') {
      return c.json({ success: false, error: 'المورد غير مخول لهذا service_type_code' }, 422)
    }
    throw e
  }

  // Use readInventoryBalance — heals stale snapshots automatically before returning.
  const prev    = await readInventoryBalance(c.env.DB, company_id, b.item_code, b.warehouse)
  const prevQty = prev.balance_qty
  const prevVal = prev.balance_value

  if (!isInbound) {
    if (b.quantity > prevQty) {
      return c.json({ success: false, error: `الكمية المتاحة بتاريخ ${movementDate} هي (${prevQty})، والمطلوب (${b.quantity})`, code: 'INSUFFICIENT_STOCK' }, 409)
    }
    const minFutureBal = await c.env.DB.prepare(
      `SELECT MIN(balance_qty) as min_bal FROM inventory_movements
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > (
           SELECT MAX(id) FROM inventory_movements
           WHERE company_id = ? AND item_code = ? AND warehouse = ? AND movement_date = ?
         )))`
        ).bind(company_id, b.item_code, b.warehouse, movementDate, movementDate,
          company_id, b.item_code, b.warehouse, movementDate)
      .first<{ min_bal: number | null }>()

    if (minFutureBal && minFutureBal.min_bal !== null && minFutureBal.min_bal < b.quantity) {
      return c.json({ success: false, error: `هذه الحركة ستؤدي لرصيد سالب في حركات مستقبلية (أدنى رصيد مستقبلي سيكون ${minFutureBal.min_bal})`, code: 'FUTURE_NEGATIVE_STOCK' }, 409)
    }
  }

  const unitPrice = b.unit_price ?? (prevQty > 0 ? prevVal / prevQty : 0)
  const qtyIn     = isInbound ? b.quantity : 0
  const qtyOut    = isInbound ? 0 : b.quantity
  const valueIn   = isInbound ? b.quantity * unitPrice : 0
  const valueOut  = isInbound ? 0 : b.quantity * unitPrice
  const balQty    = prevQty + qtyIn - qtyOut
  const balVal    = prevVal + valueIn - valueOut
  const movementValue = isInbound ? valueIn : valueOut
  const zeroValueReason = b.zero_value_reason?.trim()

  try {
    validateZeroValuePolicy(controls, role, movementValue, zeroValueReason)
  } catch (e: any) {
    if (e.message === 'ZERO_VALUE_REASON_REQUIRED') {
      return c.json({ success: false, error: 'الحركة الصفرية تتطلب سببًا واضحًا', code: 'ZERO_VALUE_REASON_REQUIRED' }, 422)
    }
    if (e.message === 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED') {
      return c.json({ success: false, error: 'ليس لديك صلاحية اعتماد حركة صفرية القيمة', code: 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED' }, 403)
    }
    throw e
  }

  const localId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const dQty = qtyIn - qtyOut
  const dVal = valueIn - valueOut
  const ym = yearMonthParts(movementDate)

  // Create the transaction header (groups this movement under a logical document).
  const txRes = await c.env.DB.prepare(
    `INSERT INTO inventory_transactions
     (company_id, transaction_type, document_number, movement_date, warehouse, notes,
      statement_text, service_type_code, line_count, total_qty, total_value, status, created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,1,?,?,'confirmed',?)`
  ).bind(
    company_id, mapToTransactionType(b.movement_type),
    b.document_number ?? null, movementDate, b.warehouse, b.notes ?? null,
    statementText, serviceTypeCode,
    b.quantity, movementValue, userId,
  ).run()
  const transactionId = txRes.meta.last_row_id as number

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, supplier_code, item_code, center_code,
        movement_date, warehouse, movement_type, document_number, pack_capacity, pack_count,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, statement_text, service_type_code, year, month, created_by_user_id, local_id,
        zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, resolvedSeasonId, resolvedFieldId, b.work_order_id ?? null,
      b.supplier_code ?? null, b.item_code, centerCode ?? null,
      movementDate, b.warehouse, b.movement_type, b.document_number ?? null,
      b.pack_capacity ?? null, b.pack_count ?? null, b.quantity, unitPrice,
      qtyIn, qtyOut, balQty, valueIn, valueOut, balVal,
      b.notes ?? null, statementText, serviceTypeCode, ym.year, ym.month, userId, localId,
      movementValue === 0 ? (zeroValueReason ?? null) : null,
      movementValue === 0 ? role : null,
      controls.posting_mode,
      movementValue === 0 ? 'exempt_zero_value' : 'pending',
      transactionId,
    ),
    c.env.DB.prepare(
      `UPDATE inventory_movements
       SET balance_qty = balance_qty + ?, balance_value = balance_value + ?
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > (SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?)))`
    ).bind(dQty, dVal, company_id, b.item_code, b.warehouse, movementDate, movementDate, localId, company_id)
  ])

  const movRow = await c.env.DB.prepare('SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?').bind(localId, company_id).first<{id:number}>()
  const movId = movRow!.id

  // Keep inventory_balances snapshot in sync with the movement just inserted.
  await upsertInventoryBalance(c.env.DB, company_id, b.item_code, b.warehouse, balQty, balVal, movId)

  const itemRow = await c.env.DB
    .prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
    .bind(b.item_code, company_id).first<{name:string}>()

  // All GL posting goes through the outbox — uniform async_reliable path.
  // The cron sweeps every 15 min; manual trigger available in BatchPostingCenter.
  // Movement ledger is committed and immutable; GL failure is always recoverable.
  const glValue = movementValue
  let glEntryId: number | null = null
  let cashMirrorWarning: string | null = null
  if (glValue > 0) {
    const outboxPayload = {
      company_id, ref_id: movId,
      item_code: b.item_code, warehouse: b.warehouse,
      movement_type: b.movement_type, value: glValue, date: movementDate,
      item_name: itemRow?.name ?? String(b.item_code), created_by: userId,
      center_code: centerCode ?? null, payment_method: b.payment_method ?? null,
      supplier_code: b.supplier_code ?? null, work_order_id: b.work_order_id ?? null,
    }
    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', movId, outboxPayload)
    await ensureOutboxQueued(c.env.DB, company_id, 'inventory_movement', movId)
    await c.env.DB.prepare(
      'UPDATE inventory_movements SET gl_posting_status = ? WHERE id = ? AND company_id = ?'
    ).bind('pending', movId, company_id).run()
  }

  if (b.movement_type === 'GRN' && b.payment_method === 'cash' && valueIn > 0) {
    try {
      await FinanceCore.prepareCashMovement(c.env.DB, {
        company_id, userId,
        transaction_date: movementDate,
        direction: 'م',
        amount: valueIn,
        narration: `شراء نقدي: ${itemRow?.name ?? b.item_code} (مخزن: ${b.warehouse})`,
        document_number: b.document_number,
        supplier_code: b.supplier_code,
        center_code: centerCode,
        notes: b.notes,
        skipGlPosting: true, // GL already enqueued via inventory outbox; cash entry only
      })
    } catch (cashErr: any) {
      // Treat as financially failed until retried/reconciled; never return silent success.
      console.error(`[movements] cash mirror failed for movId=${movId}: ${cashErr?.message}`)
      cashMirrorWarning = cashErr?.message ?? 'cash_mirror_failed'
      await markMovementFinancialFailure(
        c.env.DB,
        company_id,
        userId,
        movId,
        `CASH_MIRROR_FAILED:${cashMirrorWarning}`,
      )
      void logAudit(c.env.DB, {
        user_id: userId, company_id, action: 'CREATE',
        table_name: 'cash_transactions', record_id: movId,
        new_value: { error: cashErr?.message, context: 'cash_mirror_on_grn' },
      })
      return c.json({
        success: false,
        error: 'تم تسجيل الحركة المخزنية لكن فشل القيد/المرآة النقدية وتم تعليم الحركة كفشل مالي للمراجعة',
        code: 'CASH_MIRROR_FAILED',
        data: { movement_id: movId },
      }, 409)
    }
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'inventory_movements', record_id: movId,
    new_value: { type: b.movement_type, item: b.item_code, warehouse: b.warehouse, qty: b.quantity, price: unitPrice, date: movementDate },
  })

  return c.json({
    success: true,
    data: {
      balance_qty: balQty,
      balance_value: balVal,
      gl_entry_id: glEntryId,
      cash_mirror_warning: cashMirrorWarning,
    },
    warning: cashMirrorWarning ? 'تمت الحركة المخزنية لكن فشل تسجيل مرآة الخزينة' : undefined,
  }, 201)
})

// ── POST /movements/batch ─────────────────────────────────────

movements.post('/movements/batch', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const b = await c.req.json<{
    movement_date:    string
    warehouse:        string
    movement_type:    string
    supplier_code?:   number
    document_number?: number
    statement_text?:  string
    service_type_code?: string
    season_id?:       number
    field_id?:        number
    work_order_id?:   number
    notes?:           string
    center_code?:     number
    payment_method?:  'cash' | 'credit'
    zero_value_reason?: string
    items: Array<{ item_code: number; quantity: number; unit_price?: number; notes?: string }>
  }>()

  if (!b.movement_date || !b.warehouse || !b.movement_type) {
    return c.json({ success: false, error: 'التاريخ والمخزن ونوع الحركة مطلوبة' }, 400)
  }
  if (!Array.isArray(b.items) || b.items.length === 0) {
    return c.json({ success: false, error: 'يجب إضافة صنف واحد على الأقل' }, 400)
  }
  if (!isSupportedMovementType(b.movement_type)) {
    return c.json({ success: false, error: 'نوع حركة غير مدعوم' }, 400)
  }

  let movementDate: string
  try {
    movementDate = normalizeIsoDate(b.movement_date)
  } catch (err: any) {
    return c.json({ success: false, error: err?.message ?? 'صيغة تاريخ الحركة غير صحيحة' }, 422)
  }

  const gate = await enforceDataQualityPolicy(c.env.DB, company_id, { mode: 'bulk', module: 'inventory_batch' })
  if (!gate.ok) {
    return c.json({ success: false, error: gate.error, code: gate.code, details: gate.details }, gate.status ?? 409)
  }

  const batchDirection = resolveMovementDirection(b.movement_type)
  const batchIsInbound = batchDirection === 'IN'

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try {
    enforceInventoryLockDate(controls, movementDate)
  } catch {
    return c.json({ success: false, error: `الفترة المخزنية مغلقة حتى ${controls.locked_through_date}`, code: 'INVENTORY_PERIOD_LOCKED' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, movementDate)
  if (!periodId) return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${movementDate}` }, 400)

  let centerCode = b.center_code
  if (!centerCode && b.field_id) {
    const field = await c.env.DB.prepare("SELECT center_code FROM fields WHERE id = ? AND company_id = ?")
      .bind(b.field_id, company_id).first<{ center_code: number }>()
    if (field?.center_code) centerCode = field.center_code
  }

  // Operational context inheritance from Work Order (same pattern as single handler)
  let resolvedFieldId = b.field_id ?? null
  let resolvedSeasonId = b.season_id ?? null
  if (b.work_order_id) {
    const wo = await c.env.DB.prepare(
      'SELECT field_id, season_id, center_code FROM work_orders WHERE id = ? AND company_id = ?'
    ).bind(b.work_order_id, company_id).first<{ field_id: number | null; season_id: number | null; center_code: number | null }>()
    if (!wo) {
      return c.json({ success: false, error: 'أمر العمل المحدد غير موجود' }, 422)
    }
    if (!resolvedFieldId && wo.field_id) resolvedFieldId = wo.field_id
    if (!resolvedSeasonId && wo.season_id) resolvedSeasonId = wo.season_id
    if (!centerCode && wo.center_code) centerCode = wo.center_code
  }

  if (b.movement_type === 'GRN' && resolvedSeasonId == null) {
    return c.json({ success: false, error: 'الموسم مطلوب في استلام المخزون GRN' }, 422)
  }

  if (centerCode != null) {
    const isValidCenter = await isActiveCenterCode(c.env.DB, company_id, centerCode)
    if (!isValidCenter) {
      return c.json({ success: false, error: 'مركز التكلفة غير موجود أو غير نشط' }, 422)
    }
  }

  let statementText: string | null
  let serviceTypeCode: string | null
  try {
    ({ statementText, serviceTypeCode } = await validateInventoryGovernance(c.env.DB, company_id, {
      movement_type: b.movement_type,
      supplier_code: b.supplier_code ?? null,
      document_number: b.document_number ?? null,
      center_code: centerCode ?? null,
      statement_text: b.statement_text ?? null,
      notes: b.notes ?? null,
      service_type_code: b.service_type_code ?? null,
    }))
  } catch (e: any) {
    if (e.message === 'GRN_REQUIRES_SUPPLIER') {
      return c.json({ success: false, error: 'كود المورد مطلوب في استلام المخزون GRN' }, 422)
    }
    if (e.message === 'GRN_REQUIRES_DOCUMENT') {
      return c.json({ success: false, error: 'رقم المستند مطلوب في استلام المخزون GRN' }, 422)
    }
    if (e.message === 'ISSUE_REQUIRES_CENTER') {
      return c.json({ success: false, error: 'مركز التكلفة مطلوب في صرف المخزون ISSUE' }, 422)
    }
    if (e.message === 'ISSUE_REQUIRES_STATEMENT') {
      return c.json({ success: false, error: 'البيان مطلوب في صرف المخزون ISSUE ويجب ألا يقل عن 3 أحرف' }, 422)
    }
    if (e.message === 'ISSUE_REQUIRES_SERVICE_TYPE') {
      return c.json({ success: false, error: 'service_type_code مطلوب في صرف المخزون ISSUE' }, 422)
    }
    if (e.message === 'UNKNOWN_SERVICE_TYPE_CODE') {
      return c.json({ success: false, error: 'service_type_code غير معروف أو غير نشط' }, 422)
    }
    throw e
  }

  // Idempotency guard: reject before any inserts if document already exists.
  if (b.document_number) {
    const existingDoc = await c.env.DB
      .prepare(
        `SELECT id FROM inventory_movements
         WHERE company_id = ? AND document_number = ? AND warehouse = ? AND movement_type = ?
         LIMIT 1`
      )
      .bind(company_id, b.document_number, b.warehouse, b.movement_type)
      .first<{ id: number }>()
    if (existingDoc) {
      return c.json(
        { success: false, error: `المستند رقم ${b.document_number} مسجّل مسبقاً لهذا المخزن ونوع الحركة`, code: 'DUPLICATE_DOCUMENT' },
        409
      )
    }
  }

  const ym = yearMonthParts(movementDate)
  const year = ym.year
  const month = ym.month
  const batchKey = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`

  type LineResult = {
    item_code: number; quantity: number; unit_price: number
    qtyIn: number; qtyOut: number; valueIn: number; valueOut: number
    balQty: number; balVal: number; localId: string; lineNotes?: string
  }

  const lineResults: LineResult[] = []

  for (let i = 0; i < b.items.length; i++) {
    const li = b.items[i]
    if (!li.item_code || !li.quantity || li.quantity <= 0) {
      return c.json({ success: false, error: `السطر ${i + 1}: كود الصنف والكمية مطلوبان` }, 400)
    }

    // Heal stale snapshots before reading — mirrors single-POST behaviour.
    const lastRow = await readInventoryBalance(c.env.DB, company_id, li.item_code, b.warehouse)
    const prevQty = lastRow?.balance_qty ?? 0
    const prevVal = lastRow?.balance_value ?? 0

    if (!batchIsInbound && li.quantity > prevQty) {
      const itemRow = await c.env.DB
        .prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
        .bind(li.item_code, company_id).first<{ name: string }>()
      return c.json({
        success: false,
        error: `الصنف "${itemRow?.name ?? '#' + li.item_code}": الرصيد المتاح (${prevQty}) أقل من الكمية المطلوبة (${li.quantity})`,
        code: 'INSUFFICIENT_STOCK', item_code: li.item_code, available: prevQty,
      }, 409)
    }

    const unitPrice = li.unit_price ?? (prevQty > 0 ? prevVal / prevQty : 0)
    const qtyIn     = batchIsInbound ? li.quantity : 0
    const qtyOut    = batchIsInbound ? 0 : li.quantity
    const valueIn   = batchIsInbound ? li.quantity * unitPrice : 0
    const valueOut  = batchIsInbound ? 0 : li.quantity * unitPrice
    const movementValue = batchIsInbound ? valueIn : valueOut

    try {
      validateZeroValuePolicy(controls, role, movementValue, b.zero_value_reason?.trim())
    } catch (e: any) {
      if (e.message === 'ZERO_VALUE_REASON_REQUIRED') {
        return c.json({ success: false, error: `السطر ${i + 1}: الحركة الصفرية تتطلب سببًا واضحًا`, code: 'ZERO_VALUE_REASON_REQUIRED' }, 422)
      }
      if (e.message === 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED') {
        return c.json({ success: false, error: `السطر ${i + 1}: ليس لديك صلاحية اعتماد حركة صفرية القيمة`, code: 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED' }, 403)
      }
      throw e
    }

    lineResults.push({
      item_code: li.item_code, quantity: li.quantity, unit_price: unitPrice,
      qtyIn, qtyOut, valueIn, valueOut,
      balQty: prevQty + qtyIn - qtyOut,
      balVal: prevVal + valueIn - valueOut,
      localId: `${batchKey}_${i}`,
      lineNotes: li.notes,
    })
  }

  // Create ONE transaction header for the entire batch.
  const totalBatchQty = lineResults.reduce((s, lr) => s + lr.quantity, 0)
  const totalBatchVal = lineResults.reduce((s, lr) => s + lr.valueIn + lr.valueOut, 0)
  const batchTxRes = await c.env.DB.prepare(
    `INSERT INTO inventory_transactions
     (company_id, transaction_type, document_number, movement_date, warehouse, notes,
      statement_text, service_type_code, line_count, total_qty, total_value, status, created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'confirmed',?)`
  ).bind(
    company_id, mapToTransactionType(b.movement_type),
    b.document_number ?? null, movementDate, b.warehouse, b.notes ?? null,
    statementText, serviceTypeCode,
    lineResults.length, totalBatchQty, totalBatchVal, userId,
  ).run()
  const batchTransactionId = batchTxRes.meta.last_row_id as number

  const insertStmts = lineResults.map(lr =>
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, supplier_code, item_code, movement_date, warehouse,
        movement_type, document_number, quantity, unit_price,
        qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, statement_text, service_type_code, year, month, created_by_user_id, local_id, center_code,
        zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, resolvedSeasonId, resolvedFieldId, b.work_order_id ?? null,
      b.supplier_code ?? null, lr.item_code,
      movementDate, b.warehouse, b.movement_type, b.document_number ?? null,
      lr.quantity, lr.unit_price,
      lr.qtyIn, lr.qtyOut, lr.balQty, lr.valueIn, lr.valueOut, lr.balVal,
      lr.lineNotes ?? b.notes ?? null, statementText, serviceTypeCode, year, month, userId, lr.localId, centerCode ?? null,
      (lr.valueIn + lr.valueOut) === 0 ? (b.zero_value_reason?.trim() ?? null) : null,
      (lr.valueIn + lr.valueOut) === 0 ? role : null,
      controls.posting_mode,
      (lr.valueIn + lr.valueOut) === 0 ? 'exempt_zero_value' : 'pending',
      batchTransactionId,
    )
  )
  await c.env.DB.batch(insertStmts)

  const { results: inserted } = await c.env.DB.prepare(
    `SELECT id, item_code, local_id FROM inventory_movements
     WHERE company_id = ? AND local_id LIKE ? ORDER BY id ASC`
  ).bind(company_id, `${batchKey}_%`)
    .all<{ id: number; item_code: number; local_id: string }>()

  const deltaStmts = inserted.map(ins => {
    const lr = lineResults.find(r => r.localId === ins.local_id)
    if (!lr) return null
    const dQty = lr.qtyIn - lr.qtyOut
    const dVal = lr.valueIn - lr.valueOut
    return c.env.DB.prepare(
      `UPDATE inventory_movements
       SET balance_qty = balance_qty + ?, balance_value = balance_value + ?
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > ?))`
    ).bind(dQty, dVal, company_id, lr.item_code, b.warehouse, movementDate, movementDate, ins.id)
  }).filter(Boolean) as any[]

  if (deltaStmts.length > 0) await c.env.DB.batch(deltaStmts)

  let totalValue = 0
  let cashMirrorWarning: string | null = null
  for (const ins of inserted) {
    const lr = lineResults.find(r => r.localId === ins.local_id)
    if (!lr) continue

    // Keep inventory_balances snapshot in sync.
    await upsertInventoryBalance(c.env.DB, company_id, lr.item_code, b.warehouse, lr.balQty, lr.balVal, ins.id)

    const glValue = batchIsInbound ? lr.valueIn : lr.valueOut
    totalValue += glValue

    const itemRow = await c.env.DB
      .prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
      .bind(lr.item_code, company_id).first<{ name: string }>()

    if (glValue <= 0) continue

    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', ins.id, {
      company_id, ref_id: ins.id,
      item_code: lr.item_code, warehouse: b.warehouse,
      movement_type: b.movement_type, value: glValue, date: movementDate,
      item_name: itemRow?.name ?? String(lr.item_code), created_by: userId,
      center_code: centerCode ?? null, payment_method: b.payment_method ?? null,
      supplier_code: b.supplier_code ?? null, work_order_id: b.work_order_id ?? null,
    })
    await ensureOutboxQueued(c.env.DB, company_id, 'inventory_movement', ins.id)
    await c.env.DB.prepare('UPDATE inventory_movements SET gl_posting_status = ? WHERE id = ? AND company_id = ?')
      .bind('pending', ins.id, company_id).run()
  }

  if (b.movement_type === 'GRN' && b.payment_method === 'cash' && totalValue > 0) {
    try {
      await FinanceCore.prepareCashMovement(c.env.DB, {
        company_id, userId,
        transaction_date: movementDate,
        direction: 'م',
        amount: totalValue,
        narration: `شراء نقدي Batch (مخزن: ${b.warehouse}) - ${lineResults.length} صنف`,
        document_number: b.document_number,
        supplier_code: b.supplier_code,
        center_code: centerCode,
        notes: b.notes,
        skipGlPosting: true, // GL already enqueued via inventory outbox; cash entry only
      })
    } catch (cashErr: any) {
      console.error(`[movements/batch] cash mirror failed: ${cashErr?.message}`)
      cashMirrorWarning = cashErr?.message ?? 'cash_mirror_failed'
      for (const ins of inserted) {
        await markMovementFinancialFailure(
          c.env.DB,
          company_id,
          userId,
          ins.id,
          `CASH_MIRROR_FAILED:${cashMirrorWarning}`,
        )
      }
      void logAudit(c.env.DB, {
        user_id: userId, company_id, action: 'CREATE',
        table_name: 'cash_transactions', record_id: 0,
        new_value: { error: cashErr?.message, context: 'cash_mirror_on_batch_grn', warehouse: b.warehouse },
      })
      return c.json({
        success: false,
        error: 'تم تسجيل دفعة المخزون لكن فشل القيد/المرآة النقدية وتم تعليم الحركات كفشل مالي للمراجعة',
        code: 'CASH_MIRROR_FAILED',
        data: { movement_ids: inserted.map(r => r.id) },
      }, 409)
    }
  }

  return c.json({
    success: true,
    data: {
      count: lineResults.length,
      items: lineResults.map(lr => ({
        item_code: lr.item_code, quantity: lr.quantity,
        balance_qty: lr.balQty, balance_value: lr.balVal,
      })),
      cash_mirror_warning: cashMirrorWarning,
    },
    warning: cashMirrorWarning ? 'تمت حركة الدفعة المخزنية لكن فشل تسجيل مرآة الخزينة' : undefined,
  }, 201)
})

// ── POST /movements/transfer ─────────────────────────────────────

movements.post('/movements/transfer', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const b = await c.req.json<{
    movement_date: string; item_code: number; quantity: number
    from_warehouse: string; to_warehouse: string; notes?: string
  }>()

  if (!b.movement_date || !b.item_code || !b.quantity || !b.from_warehouse || !b.to_warehouse) {
    return c.json({ success: false, error: 'كل البيانات (التاريخ، الصنف، الكمية، من، إلى) مطلوبة' }, 400)
  }

  if (b.from_warehouse === b.to_warehouse) {
    return c.json({ success: false, error: 'لا يمكن التحويل لنفس المخزن' }, 400)
  }

  let movementDate: string
  try {
    movementDate = normalizeIsoDate(b.movement_date)
  } catch (err: any) {
    return c.json({ success: false, error: err?.message ?? 'صيغة تاريخ الحركة غير صحيحة' }, 422)
  }

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try {
    enforceInventoryLockDate(controls, movementDate)
  } catch {
    return c.json({ success: false, error: `الفترة المخزنية مغلقة حتى ${controls.locked_through_date}`, code: 'INVENTORY_PERIOD_LOCKED' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, movementDate)
  if (!periodId) return c.json({ success: false, error: 'الفترة المالية مغلقة' }, 400)

  // Staleness-aware balance read for source warehouse — heals stale snapshots automatically.
  const srcBal = await readInventoryBalance(c.env.DB, company_id, b.item_code, b.from_warehouse)

  if (srcBal.balance_qty < b.quantity) {
    return c.json({ success: false, error: 'الرصيد في مخزن المصدر غير كافٍ' }, 409)
  }

  const avgPrice   = srcBal.balance_qty > 0 ? srcBal.balance_value / srcBal.balance_qty : 0
  const totalValue = b.quantity * avgPrice

  try {
    validateZeroValuePolicy(controls, role, totalValue, b.notes?.trim())
  } catch (e: any) {
    if (e.message === 'ZERO_VALUE_REASON_REQUIRED') {
      return c.json({ success: false, error: 'التحويل الصفري يتطلب سببًا في الملاحظات', code: 'ZERO_VALUE_REASON_REQUIRED' }, 422)
    }
    if (e.message === 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED') {
      return c.json({ success: false, error: 'ليس لديك صلاحية اعتماد تحويل صفري القيمة', code: 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED' }, 403)
    }
    throw e
  }

  // Staleness-aware balance read for destination warehouse.
  const dstBal = await readInventoryBalance(c.env.DB, company_id, b.item_code, b.to_warehouse)

  const dstPrevQty = dstBal.balance_qty
  const dstPrevVal = dstBal.balance_value
  
  // Use a more robust batch key
  const batchKey = `trf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const ym = yearMonthParts(movementDate)
  const yr = ym.year
  const mo = ym.month

  const outLocalId = `${batchKey}_out`
  const inLocalId  = `${batchKey}_in`

  // Create ONE transaction header for the transfer (both OUT + IN rows share it).
  const trfTxRes = await c.env.DB.prepare(
    `INSERT INTO inventory_transactions
     (company_id, transaction_type, document_number, movement_date, warehouse, to_warehouse, notes,
      line_count, total_qty, total_value, status, created_by_user_id)
     VALUES (?,?,?,?,?,?,?,2,?,?,'confirmed',?)`
  ).bind(
    company_id, 'TRANSFER', null, movementDate, b.from_warehouse, b.to_warehouse, b.notes ?? null,
    b.quantity, totalValue, userId,
  ).run()
  const trfTransactionId = trfTxRes.meta.last_row_id as number

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_out, balance_qty, value_out, balance_value, notes, year, month, created_by_user_id, local_id,
       zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, b.item_code, movementDate, b.from_warehouse, 'TRANSFER_OUT',
      b.quantity, avgPrice, b.quantity, srcBal.balance_qty - b.quantity, totalValue, srcBal.balance_value - totalValue,
      `تحويل إلى ${b.to_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, outLocalId,
      totalValue === 0 ? (b.notes?.trim() ?? null) : null,
      totalValue === 0 ? role : null,
      controls.posting_mode,
      totalValue === 0 ? 'exempt_zero_value' : 'pending',
      trfTransactionId),

    c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_in, balance_qty, value_in, balance_value, notes, year, month, created_by_user_id, local_id,
       zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, b.item_code, movementDate, b.to_warehouse, 'TRANSFER_IN',
      b.quantity, avgPrice, b.quantity, dstPrevQty + b.quantity, totalValue, dstPrevVal + totalValue,
      `تحويل من ${b.from_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, inLocalId,
      totalValue === 0 ? (b.notes?.trim() ?? null) : null,
      totalValue === 0 ? role : null,
      controls.posting_mode,
      totalValue === 0 ? 'exempt_zero_value' : 'pending',
      trfTransactionId)
  ])

  // Get the created IDs for reference
  const rows = await c.env.DB.prepare(
    `SELECT id, movement_type FROM inventory_movements WHERE local_id IN (?, ?)`
  ).bind(outLocalId, inLocalId).all<{ id: number; movement_type: string }>()

  const outId = rows.results.find(r => r.movement_type === 'TRANSFER_OUT')?.id
  const inId  = rows.results.find(r => r.movement_type === 'TRANSFER_IN')?.id

  // Keep inventory_balances snapshot in sync for both warehouses.
  if (outId) {
    await upsertInventoryBalance(c.env.DB, company_id, b.item_code, b.from_warehouse,
      srcBal.balance_qty - b.quantity, srcBal.balance_value - totalValue, outId)
  }
  if (inId) {
    await upsertInventoryBalance(c.env.DB, company_id, b.item_code, b.to_warehouse,
      dstPrevQty + b.quantity, dstPrevVal + totalValue, inId)
  }

  // 3. GL Posting
  const itemRow = await c.env.DB.prepare("SELECT name FROM items WHERE code = ? AND company_id = ?")
    .bind(b.item_code, company_id).first<{ name: string }>()

  if (totalValue > 0 && outId && inId) {
    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_transfer', outId, {
      company_id, ref_id: outId, item_code: b.item_code,
      from_warehouse: b.from_warehouse, to_warehouse: b.to_warehouse,
      value: totalValue, date: movementDate,
      item_name: itemRow?.name ?? String(b.item_code), created_by: userId,
      target_movement_id: inId,
    })
    await ensureOutboxQueued(c.env.DB, company_id, 'inventory_transfer', outId)
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE inventory_movements SET gl_posting_status = ? WHERE id = ? AND company_id = ?').bind('pending', outId, company_id),
      c.env.DB.prepare('UPDATE inventory_movements SET gl_posting_status = ? WHERE id = ? AND company_id = ?').bind('pending', inId, company_id),
    ])
  }

  return c.json({ 
    success: true, 
    data: { 
      transferred: b.quantity, 
      price: avgPrice,
      out_id: outId,
      in_id: inId,
      batch_key: batchKey
    } 
  })
})

// ── POST /movements/transfer-batch ───────────────────────────────

movements.post('/movements/transfer-batch', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const b = await c.req.json<{
    movement_date: string; from_warehouse: string; to_warehouse: string; notes?: string
    items: Array<{ item_code: number; quantity: number }>
  }>()

  if (!b.movement_date || !b.from_warehouse || !b.to_warehouse || !Array.isArray(b.items) || b.items.length === 0) {
    return c.json({ success: false, error: 'بيانات التحويل غير مكتملة' }, 400)
  }

  if (b.from_warehouse === b.to_warehouse) {
    return c.json({ success: false, error: 'لا يمكن التحويل لنفس المخزن' }, 400)
  }

  let movementDate: string
  try {
    movementDate = normalizeIsoDate(b.movement_date)
  } catch (err: any) {
    return c.json({ success: false, error: err?.message ?? 'صيغة تاريخ الحركة غير صحيحة' }, 422)
  }

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try {
    enforceInventoryLockDate(controls, movementDate)
  } catch {
    return c.json({ success: false, error: `الفترة المخزنية مغلقة حتى ${controls.locked_through_date}`, code: 'INVENTORY_PERIOD_LOCKED' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, movementDate)
  if (!periodId) return c.json({ success: false, error: 'الفترة المالية مغلقة' }, 400)

  const batchKey = `trf_batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const ym = yearMonthParts(movementDate)
  const yr = ym.year
  const mo = ym.month
  const stmts: any[] = []

  // Create ONE transaction header for the entire transfer-batch.
  const trfBatchTxRes = await c.env.DB.prepare(
    `INSERT INTO inventory_transactions
     (company_id, transaction_type, movement_date, warehouse, to_warehouse, notes,
      line_count, total_qty, total_value, status, created_by_user_id)
     VALUES (?,'TRANSFER',?,?,?,?,?,0,0,'confirmed',?)`
  ).bind(
    company_id, movementDate, b.from_warehouse, b.to_warehouse,
    b.notes ?? null, b.items.length * 2, userId,
  ).run()
  const trfBatchTransactionId = trfBatchTxRes.meta.last_row_id as number

  for (let i = 0; i < b.items.length; i++) {
    const it = b.items[i]
    // Staleness-aware balance read for source warehouse.
    const srcBal = await readInventoryBalance(c.env.DB, company_id, it.item_code, b.from_warehouse)

    if (srcBal.balance_qty < it.quantity) {
      return c.json({ success: false, error: `الرصيد غير كافٍ للصنف #${it.item_code} في مخزن المصدر` }, 409)
    }

    const avgPrice  = srcBal.balance_value / srcBal.balance_qty
    const totVal    = it.quantity * avgPrice

    try {
      validateZeroValuePolicy(controls, role, totVal, b.notes?.trim())
    } catch (e: any) {
      if (e.message === 'ZERO_VALUE_REASON_REQUIRED') {
        return c.json({ success: false, error: `الصنف #${it.item_code}: التحويل الصفري يتطلب سببًا في الملاحظات`, code: 'ZERO_VALUE_REASON_REQUIRED' }, 422)
      }
      if (e.message === 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED') {
        return c.json({ success: false, error: `الصنف #${it.item_code}: ليس لديك صلاحية اعتماد تحويل صفري القيمة`, code: 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED' }, 403)
      }
      throw e
    }

    // Staleness-aware balance read for destination warehouse.
    const dstBal = await readInventoryBalance(c.env.DB, company_id, it.item_code, b.to_warehouse)

    const dPQ = dstBal.balance_qty
    const dPV = dstBal.balance_value
    const outLoc = `${batchKey}_${i}_out`
    const inLoc  = `${batchKey}_${i}_in`

    stmts.push(c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_out, balance_qty, value_out, balance_value, notes, year, month, created_by_user_id, local_id,
       zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, it.item_code, movementDate, b.from_warehouse, 'TRANSFER_OUT',
      it.quantity, avgPrice, it.quantity, srcBal.balance_qty - it.quantity, totVal, srcBal.balance_value - totVal,
      `تحويل Batch إلى ${b.to_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, outLoc,
      totVal === 0 ? (b.notes?.trim() ?? null) : null,
      totVal === 0 ? role : null,
      controls.posting_mode,
      totVal === 0 ? 'exempt_zero_value' : 'pending',
      trfBatchTransactionId))

    stmts.push(c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_in, balance_qty, value_in, balance_value, notes, year, month, created_by_user_id, local_id,
       zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, it.item_code, movementDate, b.to_warehouse, 'TRANSFER_IN',
      it.quantity, avgPrice, it.quantity, dPQ + it.quantity, totVal, dPV + totVal,
      `تحويل Batch من ${b.from_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, inLoc,
      totVal === 0 ? (b.notes?.trim() ?? null) : null,
      totVal === 0 ? role : null,
      controls.posting_mode,
      totVal === 0 ? 'exempt_zero_value' : 'pending',
      trfBatchTransactionId))
  }

  await c.env.DB.batch(stmts)

  // 3. GL Posting for Batch
  const { results: inserted } = await c.env.DB.prepare(
    `SELECT id, item_code, movement_type, local_id, value_out FROM inventory_movements
     WHERE company_id = ? AND local_id LIKE ? AND movement_type = 'TRANSFER_OUT'`
  ).bind(company_id, `${batchKey}_%_out`).all<{ id: number; item_code: number; local_id: string; value_out: number }>()

  for (const ins of inserted) {
    // local_id format: trf_batch_{timestamp}_{rand}_{i}_out — index is second-to-last segment
    const parts = ins.local_id.split('_')
    const idx = Number(parts[parts.length - 2])
    const item = b.items[idx]
    if (!item) continue
    const totVal = ins.value_out ?? 0

    const inLocalId = ins.local_id.replace('_out', '_in')
    const inRow = await c.env.DB.prepare(
      `SELECT id FROM inventory_movements WHERE company_id = ? AND local_id = ? LIMIT 1`
    ).bind(company_id, inLocalId).first<{ id: number }>()
    const inId = inRow?.id

    const itemRow = await c.env.DB.prepare("SELECT name FROM items WHERE code = ? AND company_id = ?")
      .bind(ins.item_code, company_id).first<{ name: string }>()

    if (totVal <= 0 || !inId) continue

    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_transfer', ins.id, {
      company_id, ref_id: ins.id, item_code: ins.item_code,
      from_warehouse: b.from_warehouse, to_warehouse: b.to_warehouse,
      value: totVal, date: movementDate,
      item_name: itemRow?.name ?? String(ins.item_code), created_by: userId,
      target_movement_id: inId,
    })
    await ensureOutboxQueued(c.env.DB, company_id, 'inventory_transfer', ins.id)
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE inventory_movements SET gl_posting_status = ? WHERE id = ? AND company_id = ?').bind('pending', ins.id, company_id),
      c.env.DB.prepare('UPDATE inventory_movements SET gl_posting_status = ? WHERE id = ? AND company_id = ?').bind('pending', inId, company_id),
    ])
  }

  return c.json({ success: true, data: { count: b.items.length, batch_key: batchKey } })
})

export default movements
