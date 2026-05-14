/**
 * inventory/issues.ts
 * ====================
 * Dedicated ISSUE (تصريف مخزون) endpoint with full dimension enforcement.
 *
 *   POST /issues        — single-item issue
 *   POST /issues/batch  — multi-item issue (primary path for field operations)
 *
 * Dimension rules (stricter than the generic /movements endpoint):
 *   season_id          MANDATORY  — must be provided explicitly; no WO inheritance
 *   center_code        MANDATORY  — must be provided explicitly; no field inheritance
 *   field_id           ENCOURAGED — warn if absent; never block
 *   item_code          MANDATORY
 *   qty_out            MANDATORY  > 0
 *   unit_price         OPTIONAL   — defaults to current WAC if omitted
 *   warehouse          MANDATORY
 *   service_type_code  MANDATORY  (inherited from validateInventoryGovernance)
 *   statement_text     MANDATORY  ≥ 3 chars (inherited from validateInventoryGovernance)
 *   work_order_id      OPTIONAL   — encouraged for traceability
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { logAudit } from '../../lib/audit'
import { normalizeIsoDate, isFutureIsoDate, yearMonthParts } from '../../lib/utils/date'
import {
  enforceInventoryLockDate,
  enqueueInventoryPostingOutbox,
  getInventoryPostingControls,
  readInventoryBalance,
  upsertInventoryBalance,
  validateZeroValuePolicy,
} from '../../lib/inventory_posting'

const issues = new Hono<{ Bindings: Env }>()

// ── Shared helpers ────────────────────────────────────────────────────────────

async function validateActiveCenterCode(
  db: Env['DB'],
  companyId: number,
  centerCode: number,
): Promise<boolean> {
  const row = await db.prepare(
    'SELECT 1 AS ok FROM cost_centers WHERE company_id = ? AND CAST(code AS INTEGER) = ? AND is_active = 1 LIMIT 1'
  ).bind(companyId, centerCode).first<{ ok: number }>()
  return !!row
}

async function validateActiveSeasonId(
  db: Env['DB'],
  companyId: number,
  seasonId: number,
): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 AS ok FROM seasons WHERE id = ? AND company_id = ? AND status NOT IN ('closed','cancelled') LIMIT 1"
  ).bind(seasonId, companyId).first<{ ok: number }>()
  return !!row?.ok
}

async function isKnownServiceTypeCode(db: Env['DB'], companyId: number, code: string): Promise<boolean> {
  const normalized = code.trim()
  if (!normalized) return false

  const byService = await db.prepare(
    'SELECT 1 AS ok FROM service_types WHERE company_id = ? AND code = ? AND is_active = 1 LIMIT 1'
  ).bind(companyId, normalized).first<{ ok: number }>()
  if (byService?.ok) return true

  const byExpense = await db.prepare(
    'SELECT 1 AS ok FROM expense_types WHERE company_id = ? AND CAST(code AS TEXT) = ? LIMIT 1'
  ).bind(companyId, normalized).first<{ ok: number }>()
  return !!byExpense?.ok
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

// ── Dimension guard: validates mandatory ISSUE-specific fields ────────────────
// Returns enriched dimensions or throws a { status, error, code } object.
async function enforceIssueDimensions(
  db: Env['DB'],
  companyId: number,
  input: {
    season_id?: number
    center_code?: number
    field_id?: number
    service_type_code?: string
    statement_text?: string
    notes?: string
    work_order_id?: number
  },
): Promise<{
  seasonId: number
  centerCode: number
  fieldId: number | null
  serviceTypeCode: string
  statementText: string
  fieldWarning: string | null
}> {
  if (!input.season_id) {
    throw { status: 422, error: 'season_id مطلوب لصرف المخزون', code: 'ISSUE_REQUIRES_SEASON' }
  }
  if (!input.center_code) {
    throw { status: 422, error: 'center_code مطلوب لصرف المخزون', code: 'ISSUE_REQUIRES_CENTER' }
  }
  if (!input.service_type_code?.trim()) {
    throw { status: 422, error: 'service_type_code مطلوب لصرف المخزون', code: 'ISSUE_REQUIRES_SERVICE_TYPE' }
  }
  const statementText = (input.statement_text ?? input.notes ?? '').trim()
  if (statementText.length < 3) {
    throw { status: 422, error: 'البيان مطلوب ويجب ألا يقل عن 3 أحرف', code: 'ISSUE_REQUIRES_STATEMENT' }
  }

  const seasonValid = await validateActiveSeasonId(db, companyId, input.season_id)
  if (!seasonValid) {
    throw { status: 422, error: `الموسم ${input.season_id} غير موجود أو مغلق`, code: 'INVALID_SEASON' }
  }

  const centerValid = await validateActiveCenterCode(db, companyId, input.center_code)
  if (!centerValid) {
    throw { status: 422, error: 'مركز التكلفة غير موجود أو غير نشط', code: 'INVALID_CENTER' }
  }

  const serviceKnown = await isKnownServiceTypeCode(db, companyId, input.service_type_code.trim())
  if (!serviceKnown) {
    throw { status: 422, error: 'service_type_code غير معروف أو غير نشط', code: 'UNKNOWN_SERVICE_TYPE_CODE' }
  }

  const fieldWarning = !input.field_id
    ? 'field_id غير محدد — إمكانية التتبع على مستوى القطعة محدودة'
    : null

  return {
    seasonId:        input.season_id,
    centerCode:      input.center_code,
    fieldId:         input.field_id ?? null,
    serviceTypeCode: input.service_type_code.trim(),
    statementText,
    fieldWarning,
  }
}

// ── POST /issues ──────────────────────────────────────────────────────────────
issues.post('/issues', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const b = await c.req.json<{
    issue_date:       string
    warehouse:        string
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
  }>()

  if (!b.issue_date || !b.warehouse || !b.item_code || !b.qty_out) {
    return c.json({ success: false, error: 'التاريخ والمخزن وكود الصنف والكمية مطلوبة' }, 400)
  }
  if (b.qty_out <= 0) {
    return c.json({ success: false, error: 'الكمية يجب أن تكون أكبر من صفر' }, 422)
  }

  let issueDate: string
  try {
    issueDate = normalizeIsoDate(b.issue_date)
  } catch (err: any) {
    return c.json({ success: false, error: err?.message ?? 'صيغة التاريخ غير صحيحة' }, 422)
  }
  if (isFutureIsoDate(issueDate)) {
    return c.json({ success: false, error: 'غير مسموح بترحيل صرف بتاريخ مستقبلي' }, 422)
  }

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try {
    enforceInventoryLockDate(controls, issueDate)
  } catch {
    return c.json({ success: false, error: `الفترة المخزنية مغلقة حتى ${controls.locked_through_date}`, code: 'INVENTORY_PERIOD_LOCKED' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, issueDate)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${issueDate}` }, 400)
  }

  let dims: Awaited<ReturnType<typeof enforceIssueDimensions>>
  try {
    dims = await enforceIssueDimensions(c.env.DB, company_id, {
      season_id:         b.season_id,
      center_code:       b.center_code,
      field_id:          b.field_id,
      service_type_code: b.service_type_code,
      statement_text:    b.statement_text,
      notes:             b.notes,
    })
  } catch (e: any) {
    if (e?.status) return c.json({ success: false, error: e.error, code: e.code }, e.status)
    throw e
  }

  const prev    = await readInventoryBalance(c.env.DB, company_id, b.item_code, b.warehouse)
  const prevQty = prev.balance_qty
  const prevVal = prev.balance_value

  if (b.qty_out > prevQty) {
    return c.json({
      success: false,
      error: `الكمية المتاحة (${prevQty}) أقل من المطلوب صرفه (${b.qty_out})`,
      code: 'INSUFFICIENT_STOCK',
      available: prevQty,
    }, 409)
  }

  // Future-negative check
  const minFuture = await c.env.DB.prepare(
    `SELECT MIN(balance_qty) AS min_bal FROM inventory_movements
     WHERE company_id = ? AND item_code = ? AND warehouse = ?
       AND (movement_date > ? OR (movement_date = ? AND id > (
         SELECT COALESCE(MAX(id), 0) FROM inventory_movements
         WHERE company_id = ? AND item_code = ? AND warehouse = ? AND movement_date = ?
       )))`
  ).bind(
    company_id, b.item_code, b.warehouse,
    issueDate, issueDate,
    company_id, b.item_code, b.warehouse, issueDate,
  ).first<{ min_bal: number | null }>()

  if (minFuture?.min_bal !== null && minFuture?.min_bal !== undefined && minFuture.min_bal < b.qty_out) {
    return c.json({
      success: false,
      error: `هذا الصرف سيؤدي لرصيد سالب في حركات مستقبلية (أدنى رصيد مستقبلي: ${minFuture.min_bal})`,
      code: 'FUTURE_NEGATIVE_STOCK',
    }, 409)
  }

  const unitPrice  = b.unit_price ?? (prevQty > 0 ? prevVal / prevQty : 0)
  const valueOut   = b.qty_out * unitPrice
  const newBalQty  = prevQty - b.qty_out
  const newBalVal  = prevVal - valueOut

  try {
    validateZeroValuePolicy(controls, role, valueOut, b.zero_value_reason?.trim())
  } catch (e: any) {
    if (e.message === 'ZERO_VALUE_REASON_REQUIRED') {
      return c.json({ success: false, error: 'الصرف الصفري يتطلب سببًا واضحًا', code: 'ZERO_VALUE_REASON_REQUIRED' }, 422)
    }
    if (e.message === 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED') {
      return c.json({ success: false, error: 'ليس لديك صلاحية اعتماد صرف صفري القيمة', code: 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED' }, 403)
    }
    throw e
  }

  const localId = `issue_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const ym = yearMonthParts(issueDate)

  const txRes = await c.env.DB.prepare(
    `INSERT INTO inventory_transactions
     (company_id, transaction_type, movement_date, warehouse, notes, statement_text, service_type_code,
      line_count, total_qty, total_value, status, created_by_user_id)
     VALUES (?, 'ISSUE', ?, ?, ?, ?, ?, 1, ?, ?, 'confirmed', ?)`
  ).bind(
    company_id, issueDate, b.warehouse, b.notes ?? null,
    dims.statementText, dims.serviceTypeCode,
    b.qty_out, valueOut, userId,
  ).run()
  const transactionId = txRes.meta.last_row_id as number

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, center_code, work_order_id, item_code,
        movement_date, warehouse, movement_type,
        quantity, unit_price, qty_out, balance_qty, value_out, balance_value,
        notes, statement_text, service_type_code,
        year, month, created_by_user_id, local_id,
        zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,'ISSUE',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, dims.seasonId, dims.fieldId, dims.centerCode, b.work_order_id ?? null, b.item_code,
      issueDate, b.warehouse,
      b.qty_out, unitPrice, b.qty_out, newBalQty, valueOut, newBalVal,
      b.notes ?? null, dims.statementText, dims.serviceTypeCode,
      ym.year, ym.month, userId, localId,
      valueOut === 0 ? (b.zero_value_reason?.trim() ?? null) : null,
      valueOut === 0 ? role : null,
      controls.posting_mode,
      valueOut === 0 ? 'exempt_zero_value' : 'pending',
      transactionId,
    ),
    c.env.DB.prepare(
      `UPDATE inventory_movements
       SET balance_qty = balance_qty - ?, balance_value = balance_value - ?
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > (
           SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?
         )))`
    ).bind(b.qty_out, valueOut, company_id, b.item_code, b.warehouse, issueDate, issueDate, localId, company_id),
  ])

  const movRow = await c.env.DB.prepare(
    'SELECT id FROM inventory_movements WHERE local_id = ? AND company_id = ?'
  ).bind(localId, company_id).first<{ id: number }>()
  const movId = movRow!.id

  await upsertInventoryBalance(c.env.DB, company_id, b.item_code, b.warehouse, newBalQty, newBalVal, movId)

  if (valueOut > 0) {
    const itemRow = await c.env.DB.prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
      .bind(b.item_code, company_id).first<{ name: string }>()

    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', movId, {
      company_id, ref_id: movId,
      item_code: b.item_code, warehouse: b.warehouse,
      movement_type: 'ISSUE', value: valueOut, date: issueDate,
      item_name: itemRow?.name ?? String(b.item_code), created_by: userId,
      center_code: dims.centerCode, payment_method: null,
      supplier_code: null, work_order_id: b.work_order_id ?? null,
    })
    await ensureOutboxQueued(c.env.DB, company_id, movId)
    await c.env.DB.prepare(
      'UPDATE inventory_movements SET gl_posting_status = ? WHERE id = ? AND company_id = ?'
    ).bind('pending', movId, company_id).run()
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'inventory_movements', record_id: movId,
    new_value: {
      type: 'ISSUE', item: b.item_code, warehouse: b.warehouse, qty: b.qty_out,
      price: unitPrice, date: issueDate,
      season_id: dims.seasonId, center_code: dims.centerCode, field_id: dims.fieldId,
      service_type: dims.serviceTypeCode,
    },
  })

  return c.json({
    success: true,
    data: {
      movement_id:   movId,
      item_code:     b.item_code,
      qty_out:       b.qty_out,
      unit_price:    unitPrice,
      value_out:     valueOut,
      balance_qty:   newBalQty,
      balance_value: newBalVal,
      season_id:     dims.seasonId,
      center_code:   dims.centerCode,
      field_id:      dims.fieldId,
    },
    warning: dims.fieldWarning ?? undefined,
  }, 201)
})

// ── POST /issues/batch ────────────────────────────────────────────────────────
issues.post('/issues/batch', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const b = await c.req.json<{
    issue_date:        string
    warehouse:         string
    season_id:         number
    center_code:       number
    field_id?:         number
    work_order_id?:    number
    service_type_code: string
    statement_text:    string
    notes?:            string
    zero_value_reason?: string
    items: Array<{
      item_code:    number
      qty_out:      number
      unit_price?:  number
      notes?:       string
    }>
  }>()

  if (!b.issue_date || !b.warehouse) {
    return c.json({ success: false, error: 'التاريخ والمخزن مطلوبان' }, 400)
  }
  if (!Array.isArray(b.items) || b.items.length === 0) {
    return c.json({ success: false, error: 'يجب إضافة صنف واحد على الأقل' }, 400)
  }

  let issueDate: string
  try {
    issueDate = normalizeIsoDate(b.issue_date)
  } catch (err: any) {
    return c.json({ success: false, error: err?.message ?? 'صيغة التاريخ غير صحيحة' }, 422)
  }
  if (isFutureIsoDate(issueDate)) {
    return c.json({ success: false, error: 'غير مسموح بترحيل صرف بتاريخ مستقبلي' }, 422)
  }

  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  try {
    enforceInventoryLockDate(controls, issueDate)
  } catch {
    return c.json({ success: false, error: `الفترة المخزنية مغلقة حتى ${controls.locked_through_date}`, code: 'INVENTORY_PERIOD_LOCKED' }, 422)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, issueDate)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${issueDate}` }, 400)
  }

  let dims: Awaited<ReturnType<typeof enforceIssueDimensions>>
  try {
    dims = await enforceIssueDimensions(c.env.DB, company_id, {
      season_id:         b.season_id,
      center_code:       b.center_code,
      field_id:          b.field_id,
      service_type_code: b.service_type_code,
      statement_text:    b.statement_text,
      notes:             b.notes,
    })
  } catch (e: any) {
    if (e?.status) return c.json({ success: false, error: e.error, code: e.code }, e.status)
    throw e
  }

  const batchKey = `issue_batch_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const ym = yearMonthParts(issueDate)

  type LineResult = {
    item_code: number; qty_out: number; unit_price: number
    valueOut: number; newBalQty: number; newBalVal: number
    localId: string; lineNotes?: string
  }
  const lineResults: LineResult[] = []

  // Pre-validate all lines before any writes
  for (let i = 0; i < b.items.length; i++) {
    const li = b.items[i]
    if (!li.item_code || !li.qty_out || li.qty_out <= 0) {
      return c.json({ success: false, error: `السطر ${i + 1}: كود الصنف والكمية (> 0) مطلوبان` }, 400)
    }

    const bal  = await readInventoryBalance(c.env.DB, company_id, li.item_code, b.warehouse)
    const prevQty = bal.balance_qty
    const prevVal = bal.balance_value

    if (li.qty_out > prevQty) {
      const itemRow = await c.env.DB.prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
        .bind(li.item_code, company_id).first<{ name: string }>()
      return c.json({
        success: false,
        error: `الصنف "${itemRow?.name ?? '#' + li.item_code}": الرصيد المتاح (${prevQty}) أقل من المطلوب (${li.qty_out})`,
        code: 'INSUFFICIENT_STOCK', item_code: li.item_code, available: prevQty,
      }, 409)
    }

    const unitPrice = li.unit_price ?? (prevQty > 0 ? prevVal / prevQty : 0)
    const valueOut  = li.qty_out * unitPrice

    try {
      validateZeroValuePolicy(controls, role, valueOut, b.zero_value_reason?.trim())
    } catch (e: any) {
      if (e.message === 'ZERO_VALUE_REASON_REQUIRED') {
        return c.json({ success: false, error: `السطر ${i + 1}: الصرف الصفري يتطلب سببًا واضحًا`, code: 'ZERO_VALUE_REASON_REQUIRED' }, 422)
      }
      if (e.message === 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED') {
        return c.json({ success: false, error: `السطر ${i + 1}: ليس لديك صلاحية اعتماد صرف صفري القيمة`, code: 'ZERO_VALUE_APPROVAL_ROLE_REQUIRED' }, 403)
      }
      throw e
    }

    lineResults.push({
      item_code: li.item_code, qty_out: li.qty_out, unit_price: unitPrice,
      valueOut, newBalQty: prevQty - li.qty_out, newBalVal: prevVal - valueOut,
      localId: `${batchKey}_${i}`, lineNotes: li.notes,
    })
  }

  // Create ONE transaction header for the batch
  const totalQty = lineResults.reduce((s, lr) => s + lr.qty_out, 0)
  const totalVal = lineResults.reduce((s, lr) => s + lr.valueOut, 0)

  const txRes = await c.env.DB.prepare(
    `INSERT INTO inventory_transactions
     (company_id, transaction_type, movement_date, warehouse, notes, statement_text, service_type_code,
      line_count, total_qty, total_value, status, created_by_user_id)
     VALUES (?, 'ISSUE', ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`
  ).bind(
    company_id, issueDate, b.warehouse, b.notes ?? null,
    dims.statementText, dims.serviceTypeCode,
    lineResults.length, totalQty, totalVal, userId,
  ).run()
  const transactionId = txRes.meta.last_row_id as number

  const insertStmts = lineResults.map(lr =>
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, center_code, work_order_id, item_code,
        movement_date, warehouse, movement_type,
        quantity, unit_price, qty_out, balance_qty, value_out, balance_value,
        notes, statement_text, service_type_code,
        year, month, created_by_user_id, local_id,
        zero_value_reason, zero_value_approved_by_role, posting_mode, gl_posting_status, transaction_id)
       VALUES (?,?,?,?,?,?,?,?,'ISSUE',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, dims.seasonId, dims.fieldId, dims.centerCode, b.work_order_id ?? null, lr.item_code,
      issueDate, b.warehouse,
      lr.qty_out, lr.unit_price, lr.qty_out, lr.newBalQty, lr.valueOut, lr.newBalVal,
      lr.lineNotes ?? b.notes ?? null, dims.statementText, dims.serviceTypeCode,
      ym.year, ym.month, userId, lr.localId,
      lr.valueOut === 0 ? (b.zero_value_reason?.trim() ?? null) : null,
      lr.valueOut === 0 ? role : null,
      controls.posting_mode,
      lr.valueOut === 0 ? 'exempt_zero_value' : 'pending',
      transactionId,
    )
  )
  await c.env.DB.batch(insertStmts)

  const { results: inserted } = await c.env.DB.prepare(
    `SELECT id, item_code, local_id FROM inventory_movements
     WHERE company_id = ? AND local_id LIKE ? ORDER BY id ASC`
  ).bind(company_id, `${batchKey}_%`)
    .all<{ id: number; item_code: number; local_id: string }>()

  // Propagate running-balance deltas to later movements for each item
  const deltaStmts = inserted.map(ins => {
    const lr = lineResults.find(r => r.localId === ins.local_id)
    if (!lr) return null
    return c.env.DB.prepare(
      `UPDATE inventory_movements
       SET balance_qty = balance_qty - ?, balance_value = balance_value - ?
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > ?))`
    ).bind(lr.qty_out, lr.valueOut, company_id, lr.item_code, b.warehouse, issueDate, issueDate, ins.id)
  }).filter(Boolean) as ReturnType<typeof c.env.DB.prepare>[]

  if (deltaStmts.length) await c.env.DB.batch(deltaStmts)

  // Sync inventory_balances snapshots and enqueue GL outbox per line
  for (const ins of inserted) {
    const lr = lineResults.find(r => r.localId === ins.local_id)
    if (!lr) continue

    await upsertInventoryBalance(c.env.DB, company_id, lr.item_code, b.warehouse, lr.newBalQty, lr.newBalVal, ins.id)

    if (lr.valueOut <= 0) continue

    const itemRow = await c.env.DB.prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
      .bind(lr.item_code, company_id).first<{ name: string }>()

    await enqueueInventoryPostingOutbox(c.env.DB, company_id, 'inventory_movement', ins.id, {
      company_id, ref_id: ins.id,
      item_code: lr.item_code, warehouse: b.warehouse,
      movement_type: 'ISSUE', value: lr.valueOut, date: issueDate,
      item_name: itemRow?.name ?? String(lr.item_code), created_by: userId,
      center_code: dims.centerCode, payment_method: null,
      supplier_code: null, work_order_id: b.work_order_id ?? null,
    })
    await ensureOutboxQueued(c.env.DB, company_id, ins.id)
    await c.env.DB.prepare(
      'UPDATE inventory_movements SET gl_posting_status = ? WHERE id = ? AND company_id = ?'
    ).bind('pending', ins.id, company_id).run()
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'inventory_movements', record_id: transactionId,
    new_value: {
      type: 'ISSUE_BATCH', warehouse: b.warehouse, lines: lineResults.length,
      total_qty: totalQty, total_value: totalVal,
      season_id: dims.seasonId, center_code: dims.centerCode, field_id: dims.fieldId,
      service_type: dims.serviceTypeCode,
    },
  })

  return c.json({
    success: true,
    data: {
      transaction_id: transactionId,
      count:          lineResults.length,
      total_qty:      totalQty,
      total_value:    totalVal,
      season_id:      dims.seasonId,
      center_code:    dims.centerCode,
      field_id:       dims.fieldId,
      items: lineResults.map((lr, i) => ({
        item_code:     lr.item_code,
        qty_out:       lr.qty_out,
        unit_price:    lr.unit_price,
        value_out:     lr.valueOut,
        balance_qty:   lr.newBalQty,
        balance_value: lr.newBalVal,
        movement_id:   inserted[i]?.id ?? null,
      })),
    },
    warning: dims.fieldWarning ?? undefined,
  }, 201)
})

export default issues
