import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { logAudit } from '../lib/audit'
import { getOpenPeriod } from '../lib/gl'
import { FinanceCore } from '../lib/finance_core'

const staging = new Hono<{ Bindings: Env }>()
staging.use('*', authMiddleware)

// ─── Types ────────────────────────────────────────────────────
interface StagingRow {
  id:              number
  company_id:      number
  batch_id:        string
  status:          string
  rejection_reason: string | null
  movement_date:   string
  warehouse:       string
  movement_type:   string
  item_code:       number | null
  item_name_raw:   string | null
  quantity:        number
  unit_price:      number | null
  supplier_code:   number | null
  supplier_name_raw: string | null
  document_number: number | null
  season_id:       number | null
  notes:           string | null
  validation_errors: string | null
  is_valid:        number
  created_by:      number | null
  reviewed_by:     number | null
  reviewed_at:     string | null
  promoted_id:     number | null
  promoted_at:     string | null
  created_at:      string
}

// ─── Validation helper ────────────────────────────────────────
async function validateRow(
  db: Env['DB'],
  company_id: number,
  row: Partial<StagingRow>,
): Promise<string[]> {
  const errors: string[] = []

  if (!row.movement_date) errors.push('ERR_MISSING_DATE')
  if (!row.warehouse)     errors.push('ERR_MISSING_WAREHOUSE')
  if (!row.movement_type || !['اضافة', 'صرف'].includes(row.movement_type))
    errors.push('ERR_INVALID_MOVEMENT_TYPE')
  if (!row.quantity || row.quantity <= 0) errors.push('ERR_INVALID_QUANTITY')

  if (row.item_code) {
    const item = await db
      .prepare('SELECT code FROM items WHERE code = ? AND company_id = ?')
      .bind(row.item_code, company_id).first()
    if (!item) errors.push('ERR_ITEM_NOT_FOUND')
  } else {
    errors.push('ERR_MISSING_ITEM_CODE')
  }

  if (row.movement_type === 'صرف' && row.item_code && row.warehouse) {
    const balRow = await db
      .prepare(
        `SELECT SUM(qty_in) - SUM(qty_out) AS bal
         FROM inventory_movements
         WHERE company_id = ? AND item_code = ? AND warehouse = ?`,
      )
      .bind(company_id, row.item_code, row.warehouse)
      .first<{ bal: number }>()
    const available = balRow?.bal ?? 0
    if ((row.quantity ?? 0) > available) {
      errors.push(`ERR_INSUFFICIENT_STOCK:${available}`)
    }
  }

  return errors
}

// ─── GET /api/staging/movements?status=&batch_id= ─────────────
staging.get('/movements', async (c) => {
  const { company_id, role } = getUser(c)

  if (!['super_admin', 'company_admin', 'accountant', 'warehouse_mgr'].includes(role)) {
    return c.json({ success: false, error: 'غير مصرح' }, 403)
  }

  const status   = c.req.query('status') ?? 'pending'
  const batchId  = c.req.query('batch_id')
  const page     = Math.max(1, Number(c.req.query('page') ?? 1))
  const size     = Math.min(200, Number(c.req.query('size') ?? 100))
  const offset   = (page - 1) * size

  let where   = 'WHERE sm.company_id = ?'
  const binds: unknown[] = [company_id]

  if (status !== 'all') { where += ' AND sm.status = ?'; binds.push(status) }
  if (batchId)          { where += ' AND sm.batch_id = ?'; binds.push(batchId) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT sm.*,
              i.name  AS item_name,
              s.name  AS supplier_name,
              u.full_name AS created_by_name,
              r.full_name AS reviewed_by_name
       FROM staging_movements sm
       LEFT JOIN items i     ON i.code = sm.item_code AND i.company_id = sm.company_id
       LEFT JOIN suppliers s ON s.code = sm.supplier_code AND s.company_id = sm.company_id
       LEFT JOIN users u     ON u.id = sm.created_by
       LEFT JOIN users r     ON r.id = sm.reviewed_by
       ${where}
       ORDER BY sm.created_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(...binds, size, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM staging_movements sm ${where}`)
      .bind(...binds).first<{ n: number }>(),
  ])

  return c.json({
    success:   true,
    data:      rows.results,
    total:     cnt?.n ?? 0,
    page,
    page_size: size,
    has_more:  offset + size < (cnt?.n ?? 0),
  })
})

// ─── POST /api/staging/movements — submit a batch for review ──
staging.post('/movements', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{
    batch_id?:       string
    movement_date:   string
    warehouse:       string
    movement_type:   string
    rows: Array<{
      item_code:       number
      item_name_raw?:  string
      quantity:        number
      unit_price?:     number
      supplier_code?:  number
      document_number?: number
      season_id?:      number
      notes?:          string
    }>
  }>()

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ success: false, error: 'يجب إرسال صف واحد على الأقل' }, 400)
  }

  const batchId = body.batch_id ?? `stg_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const inserts: number[] = []
  let allValid = true

  for (const row of body.rows) {
    const errors = await validateRow(c.env.DB, company_id, {
      movement_date: body.movement_date,
      warehouse:     body.warehouse,
      movement_type: body.movement_type,
      item_code:     row.item_code,
      quantity:      row.quantity,
    })

    const isValid = errors.length === 0
    if (!isValid) allValid = false

    const res = await c.env.DB.prepare(
      `INSERT INTO staging_movements
       (company_id, batch_id, status, movement_date, warehouse, movement_type,
        item_code, item_name_raw, quantity, unit_price, supplier_code,
        document_number, season_id, notes, validation_errors, is_valid, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      company_id, batchId,
      isValid ? 'pending' : 'invalid',
      body.movement_date, body.warehouse, body.movement_type,
      row.item_code, row.item_name_raw ?? null,
      row.quantity, row.unit_price ?? null,
      row.supplier_code ?? null, row.document_number ?? null,
      row.season_id ?? null, row.notes ?? null,
      errors.length ? JSON.stringify(errors) : null,
      isValid ? 1 : 0,
      userId,
    ).run()

    inserts.push(res.meta.last_row_id)
  }

  return c.json({
    success: true,
    data: {
      batch_id:    batchId,
      total:       body.rows.length,
      all_valid:   allValid,
      row_ids:     inserts,
    },
  }, 201)
})

// ─── POST /api/staging/movements/:id/approve ─────────────────
staging.post('/movements/:id/approve', async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const id = Number(c.req.param('id'))

  if (!['super_admin', 'company_admin', 'accountant'].includes(role)) {
    return c.json({ success: false, error: 'غير مصرح — يحتاج محاسب أو مدير' }, 403)
  }

  const row = await c.env.DB
    .prepare('SELECT * FROM staging_movements WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<StagingRow>()

  if (!row)                         return c.json({ success: false, error: 'السجل غير موجود' }, 404)
  if (row.status !== 'pending')     return c.json({ success: false, error: `الحالة الحالية: ${row.status}` }, 409)
  if (!row.is_valid)                return c.json({ success: false, error: 'السجل يحتوي على أخطاء تحقق، قم بتصحيحها أولاً' }, 422)
  if (row.created_by === userId)    return c.json({ success: false, error: 'لا يمكنك اعتماد سجل أنت أدخلته (فصل المهام)' }, 403)

  await c.env.DB.prepare(
    'UPDATE staging_movements SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
  ).bind('approved', userId, new Date().toISOString(), id).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'staging_movements', record_id: id,
    old_value: { status: 'pending' }, new_value: { status: 'approved' },
  })

  return c.json({ success: true, data: { id, status: 'approved' } })
})

// ─── POST /api/staging/movements/:id/reject ──────────────────
staging.post('/movements/:id/reject', async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const id = Number(c.req.param('id'))
  const { reason } = await c.req.json<{ reason?: string }>()

  if (!['super_admin', 'company_admin', 'accountant', 'warehouse_mgr'].includes(role)) {
    return c.json({ success: false, error: 'غير مصرح' }, 403)
  }

  const row = await c.env.DB
    .prepare('SELECT status FROM staging_movements WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string }>()

  if (!row) return c.json({ success: false, error: 'السجل غير موجود' }, 404)
  if (!['pending', 'invalid'].includes(row.status))
    return c.json({ success: false, error: `الحالة الحالية: ${row.status}` }, 409)

  await c.env.DB.prepare(
    'UPDATE staging_movements SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
  ).bind('rejected', reason ?? null, userId, new Date().toISOString(), id).run()

  return c.json({ success: true, data: { id, status: 'rejected' } })
})

// ─── POST /api/staging/movements/promote/:batchId ─────────────
// Promote all approved rows in a batch → inventory_movements
staging.post('/movements/promote/:batchId', async (c) => {
  const { company_id, sub: userId, role } = getUser(c)
  const batchId = c.req.param('batchId')

  if (!['super_admin', 'company_admin', 'accountant'].includes(role)) {
    return c.json({ success: false, error: 'غير مصرح — يحتاج محاسب أو مدير' }, 403)
  }

  const { results: approvedRows } = await c.env.DB.prepare(
    `SELECT * FROM staging_movements
     WHERE company_id = ? AND batch_id = ? AND status = 'approved' AND promoted_id IS NULL`,
  ).bind(company_id, batchId).all<StagingRow>()

  if (approvedRows.length === 0) {
    return c.json({ success: false, error: 'لا توجد سجلات معتمدة في هذه الدُفعة' }, 404)
  }

  // Validate open period for each row's date
  const promoted: number[] = []
  const failed:   Array<{ id: number; reason: string }> = []

  for (const row of approvedRows) {
    const periodId = await getOpenPeriod(c.env.DB, company_id, row.movement_date)
    if (!periodId) {
      failed.push({ id: row.id, reason: `لا توجد فترة مالية مفتوحة للتاريخ ${row.movement_date}` })
      continue
    }

    const balRow = await c.env.DB.prepare(
      `SELECT SUM(qty_in) - SUM(qty_out)   AS bal_qty,
              SUM(value_in) - SUM(value_out) AS bal_val
       FROM inventory_movements WHERE company_id = ? AND item_code = ? AND warehouse = ?`,
    ).bind(company_id, row.item_code, row.warehouse)
      .first<{ bal_qty: number; bal_val: number }>()

    const prevQty   = balRow?.bal_qty ?? 0
    const prevVal   = balRow?.bal_val ?? 0
    const unitPrice = row.unit_price ?? (prevQty > 0 ? prevVal / prevQty : 0)
    const qtyIn     = row.movement_type === 'اضافة' ? row.quantity : 0
    const qtyOut    = row.movement_type === 'صرف'   ? row.quantity : 0
    const valueIn   = qtyIn  * unitPrice
    const valueOut  = qtyOut * unitPrice
    const balQty    = prevQty + qtyIn - qtyOut
    const balVal    = prevVal + valueIn - valueOut

    if (row.movement_type === 'صرف' && row.quantity > prevQty) {
      failed.push({ id: row.id, reason: `رصيد غير كافٍ: متاح ${prevQty}` })
      continue
    }

    const date = new Date(row.movement_date)
    const insertRes = await c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, supplier_code, item_code, movement_date, warehouse,
        movement_type, document_number, quantity, unit_price,
        qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      company_id, row.season_id ?? null, row.supplier_code ?? null, row.item_code,
      row.movement_date, row.warehouse, row.movement_type, row.document_number ?? null,
      row.quantity, unitPrice,
      qtyIn, qtyOut, balQty, valueIn, valueOut, balVal,
      row.notes ?? null, date.getFullYear(), date.getMonth() + 1,
      userId, `staging_${row.id}`,
    ).run()

    const newMovId = insertRes.meta.last_row_id

    // GL entry
    const itemRow = await c.env.DB
      .prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
      .bind(row.item_code, company_id).first<{ name: string }>()

    const glValue = row.movement_type === 'اضافة' ? valueIn : valueOut
    await FinanceCore.resolveInventoryMovement(c.env.DB, {
      company_id,
      ref_id: newMovId,
      item_code: row.item_code!,
      warehouse: row.warehouse,
      movement_type: row.movement_type,
      value: glValue,
      date: row.movement_date,
      item_name: itemRow?.name ?? String(row.item_code),
      created_by: userId,
      supplier_code: row.supplier_code ?? undefined,
    })

    // Mark staging row as promoted
    await c.env.DB.prepare(
      'UPDATE staging_movements SET status = ?, promoted_id = ?, promoted_at = ? WHERE id = ?',
    ).bind('promoted', newMovId, new Date().toISOString(), row.id).run()

    promoted.push(row.id)
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'staging_movements',
    new_value: { batch_id: batchId, promoted: promoted.length, failed: failed.length },
  })

  return c.json({
    success: failed.length === 0,
    data: {
      batch_id:   batchId,
      promoted:   promoted.length,
      failed:     failed.length,
      details:    failed,
    },
  }, failed.length === 0 ? 200 : 207)  // 207 Multi-Status for partial success
})

// ─── GET /api/staging/movements/summary — batch stats ────────
staging.get('/movements/summary', async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(
    `SELECT
       batch_id,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN status = 'invalid'  THEN 1 ELSE 0 END) AS invalid,
       SUM(CASE WHEN status = 'promoted' THEN 1 ELSE 0 END) AS promoted,
       MIN(created_at) AS created_at
     FROM staging_movements
     WHERE company_id = ?
     GROUP BY batch_id
     ORDER BY created_at DESC
     LIMIT 50`,
  ).bind(company_id).all()

  return c.json({ success: true, data: results })
})

// ─── POST /api/staging/offline-sync — sync offline queue ─────
staging.post('/offline-sync', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{
    device_id: string
    operations: Array<{
      local_id:  string
      operation: string
      payload:   unknown
    }>
  }>()

  if (!body.device_id || !Array.isArray(body.operations)) {
    return c.json({ success: false, error: 'device_id والعمليات مطلوبة' }, 400)
  }

  const results: Array<{ local_id: string; status: string; error?: string }> = []

  for (const op of body.operations) {
    // Check idempotency: already processed?
    const existing = await c.env.DB
      .prepare('SELECT status FROM offline_queue WHERE device_id = ? AND local_id = ?')
      .bind(body.device_id, op.local_id).first<{ status: string }>()

    if (existing) {
      results.push({ local_id: op.local_id, status: existing.status })
      continue
    }

    // Store in queue
    await c.env.DB.prepare(
      `INSERT INTO offline_queue (company_id, device_id, local_id, operation, payload, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
    ).bind(
      company_id, body.device_id, op.local_id,
      op.operation, JSON.stringify(op.payload),
    ).run()

    results.push({ local_id: op.local_id, status: 'queued' })
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'offline_queue',
    new_value: { device: body.device_id, ops: body.operations.length },
    source: 'offline',
  })

  return c.json({ success: true, data: { results, device_id: body.device_id } })
})

export default staging
