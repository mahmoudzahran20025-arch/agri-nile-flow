import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { FinanceCore } from '../../lib/finance_core'
import { logAudit } from '../../lib/audit'

const movements = new Hono<{ Bindings: Env }>()

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
              im.center_code, cc.name AS center_name,
              im.related_movement_id
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
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    movement_date: string; warehouse: string; movement_type: string
    item_code: number; quantity: number; unit_price?: number
    supplier_code?: number; document_number?: number; notes?: string
    season_id?: number; field_id?: number; work_order_id?: number
    center_code?: number; pack_capacity?: number; pack_count?: number
    payment_method?: 'cash' | 'credit'
  }>()

  if (!b.movement_date || !b.warehouse || !b.movement_type || !b.item_code || !b.quantity) {
    return c.json({ success: false, error: 'بيانات الحركة ناقصة' }, 400)
  }
  if (b.movement_type !== 'اضافة' && b.movement_type !== 'صرف') {
    return c.json({ success: false, error: "النوع يجب أن يكون 'اضافة' أو 'صرف'" }, 400)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, b.movement_date)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.movement_date}` }, 400)
  }

  let centerCode = b.center_code
  if (!centerCode && b.field_id) {
    const field = await c.env.DB.prepare("SELECT center_code FROM fields WHERE id = ? AND company_id = ?")
      .bind(b.field_id, company_id).first<{ center_code: number }>()
    if (field?.center_code) centerCode = field.center_code
  }

  const lastRow = await c.env.DB.prepare(
    `SELECT balance_qty, balance_value FROM inventory_movements
     WHERE company_id = ? AND item_code = ? AND warehouse = ? AND (movement_date < ? OR (movement_date = ? AND id < (SELECT MAX(id)+1 FROM inventory_movements)))
     ORDER BY movement_date DESC, id DESC LIMIT 1`
  ).bind(company_id, b.item_code, b.warehouse, b.movement_date, b.movement_date)
    .first<{ balance_qty: number; balance_value: number }>()

  const prevQty = lastRow?.balance_qty ?? 0
  const prevVal = lastRow?.balance_value ?? 0

  if (b.movement_type === 'صرف') {
    if (b.quantity > prevQty) {
      return c.json({ success: false, error: `الكمية المتاحة بتاريخ ${b.movement_date} هي (${prevQty})، والمطلوب (${b.quantity})`, code: 'INSUFFICIENT_STOCK' }, 409)
    }
    const minFutureBal = await c.env.DB.prepare(
      `SELECT MIN(balance_qty) as min_bal FROM inventory_movements
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > (SELECT MAX(id) FROM inventory_movements WHERE movement_date = ?)))`
    ).bind(company_id, b.item_code, b.warehouse, b.movement_date, b.movement_date, b.movement_date)
      .first<{ min_bal: number | null }>()

    if (minFutureBal && minFutureBal.min_bal !== null && minFutureBal.min_bal < b.quantity) {
      return c.json({ success: false, error: `هذه الحركة ستؤدي لرصيد سالب في حركات مستقبلية (أدنى رصيد مستقبلي سيكون ${minFutureBal.min_bal})`, code: 'FUTURE_NEGATIVE_STOCK' }, 409)
    }
  }

  const unitPrice = b.unit_price ?? (prevQty > 0 ? prevVal / prevQty : 0)
  const qtyIn     = b.movement_type === 'اضافة' ? b.quantity : 0
  const qtyOut    = b.movement_type === 'صرف'   ? b.quantity : 0
  const valueIn   = b.movement_type === 'اضافة' ? b.quantity * unitPrice : 0
  const valueOut  = b.movement_type === 'صرف'   ? b.quantity * unitPrice : 0
  const balQty    = prevQty + qtyIn - qtyOut
  const balVal    = prevVal + valueIn - valueOut

  const localId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const dQty = qtyIn - qtyOut
  const dVal = valueIn - valueOut
  const date = new Date(b.movement_date)

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, supplier_code, item_code, center_code,
        movement_date, warehouse, movement_type, document_number, pack_capacity, pack_count,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, b.season_id ?? null, b.field_id ?? null, b.work_order_id ?? null,
      b.supplier_code ?? null, b.item_code, centerCode ?? null,
      b.movement_date, b.warehouse, b.movement_type, b.document_number ?? null,
      b.pack_capacity ?? null, b.pack_count ?? null, b.quantity, unitPrice,
      qtyIn, qtyOut, balQty, valueIn, valueOut, balVal,
      b.notes ?? null, date.getFullYear(), date.getMonth() + 1, userId, localId
    ),
    c.env.DB.prepare(
      `UPDATE inventory_movements
       SET balance_qty = balance_qty + ?, balance_value = balance_value + ?
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > (SELECT id FROM inventory_movements WHERE local_id = ?)))`
    ).bind(dQty, dVal, company_id, b.item_code, b.warehouse, b.movement_date, b.movement_date, localId)
  ])

  const movRow = await c.env.DB.prepare('SELECT id FROM inventory_movements WHERE local_id = ?').bind(localId).first<{id:number}>()
  const movId = movRow!.id

  const itemRow = await c.env.DB
    .prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
    .bind(b.item_code, company_id).first<{name:string}>()

  const glValue = b.movement_type === 'اضافة' ? valueIn : valueOut
  let glEntryId: number | null = null
  try {
    glEntryId = await FinanceCore.resolveInventoryMovement(c.env.DB, {
      company_id,
      ref_id: movId,
      item_code: b.item_code,
      warehouse: b.warehouse,
      movement_type: b.movement_type,
      value: glValue,
      date: b.movement_date,
      item_name: itemRow?.name ?? String(b.item_code),
      created_by: userId,
      center_code: centerCode ?? undefined,
      payment_method: b.payment_method,
      supplier_code: b.supplier_code,
      work_order_id: b.work_order_id,
    })
  } catch (err: any) {
    await c.env.DB.prepare('DELETE FROM inventory_movements WHERE id = ?').bind(movId).run()
    await c.env.DB.prepare(
      `UPDATE inventory_movements
       SET balance_qty = balance_qty - ?, balance_value = balance_value - ?
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > ?))`
    ).bind(dQty, dVal, company_id, b.item_code, b.warehouse, b.movement_date, b.movement_date, movId).run()
    throw new Error(`فشل إنشاء القيد المحاسبي وتم إلغاء الحركة المخزنية: ${err.message}`)
  }

  if (b.movement_type === 'اضافة' && b.payment_method === 'cash') {
    await FinanceCore.recordCashMovement(c.env.DB, {
      company_id, userId,
      transaction_date: b.movement_date,
      direction: 'م',
      amount: valueIn,
      narration: `شراء نقدي: ${itemRow?.name ?? b.item_code} (مخزن: ${b.warehouse})`,
      document_number: b.document_number,
      supplier_code: b.supplier_code,
      center_code: centerCode,
      notes: b.notes
    })
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'inventory_movements', record_id: movId,
    new_value: { type: b.movement_type, item: b.item_code, warehouse: b.warehouse, qty: b.quantity, price: unitPrice, date: b.movement_date },
  })

  return c.json({ success: true, data: { balance_qty: balQty, balance_value: balVal, gl_entry_id: glEntryId } }, 201)
})

// ── POST /movements/batch ─────────────────────────────────────

movements.post('/movements/batch', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    movement_date:    string
    warehouse:        string
    movement_type:    string
    supplier_code?:   number
    document_number?: number
    season_id?:       number
    field_id?:        number
    work_order_id?:   number
    notes?:           string
    center_code?:     number
    payment_method?:  'cash' | 'credit'
    items: Array<{ item_code: number; quantity: number; unit_price?: number; notes?: string }>
  }>()

  if (!b.movement_date || !b.warehouse || !b.movement_type) {
    return c.json({ success: false, error: 'التاريخ والمخزن ونوع الحركة مطلوبة' }, 400)
  }
  if (!Array.isArray(b.items) || b.items.length === 0) {
    return c.json({ success: false, error: 'يجب إضافة صنف واحد على الأقل' }, 400)
  }
  if (b.movement_type !== 'اضافة' && b.movement_type !== 'صرف') {
    return c.json({ success: false, error: "النوع يجب أن يكون 'اضافة' أو 'صرف'" }, 400)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, b.movement_date)
  if (!periodId) return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.movement_date}` }, 400)

  let centerCode = b.center_code
  if (!centerCode && b.field_id) {
    const field = await c.env.DB.prepare("SELECT center_code FROM fields WHERE id = ? AND company_id = ?")
      .bind(b.field_id, company_id).first<{ center_code: number }>()
    if (field?.center_code) centerCode = field.center_code
  }

  const date     = new Date(b.movement_date)
  const year     = date.getFullYear()
  const month    = date.getMonth() + 1
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

    const lastRow = await c.env.DB.prepare(
      `SELECT balance_qty, balance_value FROM inventory_movements
       WHERE company_id = ? AND item_code = ? AND warehouse = ? AND (movement_date < ? OR (movement_date = ? AND id < (SELECT MAX(id)+1 FROM inventory_movements)))
       ORDER BY movement_date DESC, id DESC LIMIT 1`
    ).bind(company_id, li.item_code, b.warehouse, b.movement_date, b.movement_date)
      .first<{ balance_qty: number; balance_value: number }>()

    const prevQty = lastRow?.balance_qty ?? 0
    const prevVal = lastRow?.balance_value ?? 0

    if (b.movement_type === 'صرف' && li.quantity > prevQty) {
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
    const qtyIn     = b.movement_type === 'اضافة' ? li.quantity : 0
    const qtyOut    = b.movement_type === 'صرف'   ? li.quantity : 0
    const valueIn   = b.movement_type === 'اضافة' ? li.quantity * unitPrice : 0
    const valueOut  = b.movement_type === 'صرف'   ? li.quantity * unitPrice : 0

    lineResults.push({
      item_code: li.item_code, quantity: li.quantity, unit_price: unitPrice,
      qtyIn, qtyOut, valueIn, valueOut,
      balQty: prevQty + qtyIn - qtyOut,
      balVal: prevVal + valueIn - valueOut,
      localId: `${batchKey}_${i}`,
      lineNotes: li.notes,
    })
  }

  const insertStmts = lineResults.map(lr =>
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, field_id, work_order_id, supplier_code, item_code, movement_date, warehouse,
        movement_type, document_number, quantity, unit_price,
        qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, year, month, created_by_user_id, local_id, center_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, b.season_id ?? null, b.field_id ?? null, b.work_order_id ?? null,
      b.supplier_code ?? null, lr.item_code,
      b.movement_date, b.warehouse, b.movement_type, b.document_number ?? null,
      lr.quantity, lr.unit_price,
      lr.qtyIn, lr.qtyOut, lr.balQty, lr.valueIn, lr.valueOut, lr.balVal,
      lr.lineNotes ?? b.notes ?? null, year, month, userId, lr.localId, centerCode ?? null
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
    ).bind(dQty, dVal, company_id, lr.item_code, b.warehouse, b.movement_date, b.movement_date, ins.id)
  }).filter(Boolean) as any[]

  if (deltaStmts.length > 0) await c.env.DB.batch(deltaStmts)

  let totalValue = 0
  for (const ins of inserted) {
    const lr = lineResults.find(r => r.localId === ins.local_id)
    if (!lr) continue
    const glValue = b.movement_type === 'اضافة' ? lr.valueIn : lr.valueOut
    totalValue += glValue

    const itemRow = await c.env.DB
      .prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
      .bind(lr.item_code, company_id).first<{ name: string }>()

    try {
      await FinanceCore.resolveInventoryMovement(c.env.DB, {
        company_id,
        ref_id: ins.id,
        item_code: lr.item_code,
        warehouse: b.warehouse,
        movement_type: b.movement_type,
        value: glValue,
        date: b.movement_date,
        item_name: itemRow?.name ?? String(lr.item_code),
        created_by: userId,
        center_code: centerCode ?? undefined,
        payment_method: b.payment_method,
        supplier_code: b.supplier_code,
        work_order_id: b.work_order_id,
      })
    } catch (err: any) {
      await c.env.DB.prepare('DELETE FROM inventory_movements WHERE company_id = ? AND local_id LIKE ?')
        .bind(company_id, `${batchKey}_%`).run()

      const rollbackStmts = inserted.map(i => {
        const line = lineResults.find(r => r.localId === i.local_id)
        if (!line) return null
        return c.env.DB.prepare(
          `UPDATE inventory_movements
           SET balance_qty = balance_qty - ?, balance_value = balance_value - ?
           WHERE company_id = ? AND item_code = ? AND warehouse = ?
             AND (movement_date > ? OR (movement_date = ? AND id > ?))`
        ).bind(line.qtyIn - line.qtyOut, line.valueIn - line.valueOut, company_id, line.item_code, b.warehouse, b.movement_date, b.movement_date, i.id)
      }).filter(Boolean) as any[]
      if (rollbackStmts.length > 0) await c.env.DB.batch(rollbackStmts)

      throw new Error(`فشل إنشاء القيد المحاسبي وتم إلغاء حركة المخزن: ${err.message}`)
    }
  }

  if (b.movement_type === 'اضافة' && b.payment_method === 'cash' && totalValue > 0) {
    await FinanceCore.recordCashMovement(c.env.DB, {
      company_id, userId,
      transaction_date: b.movement_date,
      direction: 'م',
      amount: totalValue,
      narration: `شراء نقدي Batch (مخزن: ${b.warehouse}) - ${lineResults.length} صنف`,
      document_number: b.document_number,
      supplier_code: b.supplier_code,
      center_code: centerCode,
      notes: b.notes
    })
  }

  return c.json({
    success: true,
    data: {
      count: lineResults.length,
      items: lineResults.map(lr => ({
        item_code: lr.item_code, quantity: lr.quantity,
        balance_qty: lr.balQty, balance_value: lr.balVal,
      })),
    },
  }, 201)
})

// ── POST /movements/transfer ─────────────────────────────────────

movements.post('/movements/transfer', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
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

  const periodId = await getOpenPeriod(c.env.DB, company_id, b.movement_date)
  if (!periodId) return c.json({ success: false, error: 'الفترة المالية مغلقة' }, 400)

  // Atomic check and move
  const srcBal = await c.env.DB.prepare(
    `SELECT balance_qty, balance_value FROM inventory_movements
     WHERE company_id = ? AND item_code = ? AND warehouse = ?
     ORDER BY movement_date DESC, id DESC LIMIT 1`
  ).bind(company_id, b.item_code, b.from_warehouse)
    .first<{ balance_qty: number; balance_value: number }>()

  if (!srcBal || srcBal.balance_qty < b.quantity) {
    return c.json({ success: false, error: 'الرصيد في مخزن المصدر غير كافٍ' }, 409)
  }

  const avgPrice   = srcBal.balance_value / srcBal.balance_qty
  const totalValue = b.quantity * avgPrice

  const dstBal = await c.env.DB.prepare(
    `SELECT balance_qty, balance_value FROM inventory_movements
     WHERE company_id = ? AND item_code = ? AND warehouse = ?
     ORDER BY movement_date DESC, id DESC LIMIT 1`
  ).bind(company_id, b.item_code, b.to_warehouse)
    .first<{ balance_qty: number; balance_value: number }>()

  const dstPrevQty = dstBal?.balance_qty ?? 0
  const dstPrevVal = dstBal?.balance_value ?? 0
  
  // Use a more robust batch key
  const batchKey = `trf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const yr = new Date(b.movement_date).getFullYear()
  const mo = new Date(b.movement_date).getMonth() + 1

  const outLocalId = `${batchKey}_out`
  const inLocalId  = `${batchKey}_in`

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_out, balance_qty, value_out, balance_value, notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, b.item_code, b.movement_date, b.from_warehouse, 'صرف',
      b.quantity, avgPrice, b.quantity, srcBal.balance_qty - b.quantity, totalValue, srcBal.balance_value - totalValue,
      `تحويل إلى ${b.to_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, outLocalId),

    c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_in, balance_qty, value_in, balance_value, notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, b.item_code, b.movement_date, b.to_warehouse, 'اضافة',
      b.quantity, avgPrice, b.quantity, dstPrevQty + b.quantity, totalValue, dstPrevVal + totalValue,
      `تحويل من ${b.from_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, inLocalId)
  ])

  // Get the created IDs for reference
  const rows = await c.env.DB.prepare(
    `SELECT id, movement_type FROM inventory_movements WHERE local_id IN (?, ?)`
  ).bind(outLocalId, inLocalId).all<{ id: number; movement_type: string }>()

  const outId = rows.results.find(r => r.movement_type === 'صرف')?.id
  const inId  = rows.results.find(r => r.movement_type === 'اضافة')?.id

  // 3. GL Posting
  const itemRow = await c.env.DB.prepare("SELECT name FROM items WHERE code = ? AND company_id = ?")
    .bind(b.item_code, company_id).first<{ name: string }>()

  try {
    await FinanceCore.resolveInventoryTransfer(c.env.DB, {
      company_id,
      ref_id: outId!,
      item_code: b.item_code,
      from_warehouse: b.from_warehouse,
      to_warehouse: b.to_warehouse,
      value: totalValue,
      date: b.movement_date,
      item_name: itemRow?.name ?? String(b.item_code),
      created_by: userId,
    })
  } catch (err: any) {
    // If GL fails, we keep the movement but log it as a sync issue for reconciliation.
    // In a stricter system, we might rollback, but inventory takes physical precedence here.
    console.error(`GL_TRANSFER_POSTING_FAILED: ${err.message}`)
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
  const { company_id, sub: userId } = getUser(c)
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

  const periodId = await getOpenPeriod(c.env.DB, company_id, b.movement_date)
  if (!periodId) return c.json({ success: false, error: 'الفترة المالية مغلقة' }, 400)

  const batchKey = `trf_batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const yr = new Date(b.movement_date).getFullYear()
  const mo = new Date(b.movement_date).getMonth() + 1
  const stmts: any[] = []

  for (let i = 0; i < b.items.length; i++) {
    const it = b.items[i]
    const srcBal = await c.env.DB.prepare(
      `SELECT balance_qty, balance_value FROM inventory_movements
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
       ORDER BY movement_date DESC, id DESC LIMIT 1`
    ).bind(company_id, it.item_code, b.from_warehouse).first<{ balance_qty: number; balance_value: number }>()

    if (!srcBal || srcBal.balance_qty < it.quantity) {
      return c.json({ success: false, error: `الرصيد غير كافٍ للصنف #${it.item_code} في مخزن المصدر` }, 409)
    }

    const avgPrice  = srcBal.balance_value / srcBal.balance_qty
    const totVal    = it.quantity * avgPrice
    const dstBal = await c.env.DB.prepare(
      `SELECT balance_qty, balance_value FROM inventory_movements
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
       ORDER BY movement_date DESC, id DESC LIMIT 1`
    ).bind(company_id, it.item_code, b.to_warehouse).first<{ balance_qty: number; balance_value: number }>()

    const dPQ = dstBal?.balance_qty ?? 0
    const dPV = dstBal?.balance_value ?? 0
    const outLoc = `${batchKey}_${i}_out`
    const inLoc  = `${batchKey}_${i}_in`

    stmts.push(c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_out, balance_qty, value_out, balance_value, notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, it.item_code, b.movement_date, b.from_warehouse, 'صرف',
      it.quantity, avgPrice, it.quantity, srcBal.balance_qty - it.quantity, totVal, srcBal.balance_value - totVal,
      `تحويل Batch إلى ${b.to_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, outLoc))

    stmts.push(c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_in, balance_qty, value_in, balance_value, notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, it.item_code, b.movement_date, b.to_warehouse, 'اضافة',
      it.quantity, avgPrice, it.quantity, dPQ + it.quantity, totVal, dPV + totVal,
      `تحويل Batch من ${b.from_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, inLoc))
  }

  await c.env.DB.batch(stmts)

  // 3. GL Posting for Batch
  const { results: inserted } = await c.env.DB.prepare(
    `SELECT id, item_code, movement_type, local_id FROM inventory_movements
     WHERE company_id = ? AND local_id LIKE ? AND movement_type = 'صرف'`
  ).bind(company_id, `${batchKey}_%_out`).all<{ id: number; item_code: number; local_id: string }>()

  for (const ins of inserted) {
    const idx = Number(ins.local_id.split('_')[2])
    const item = b.items[idx]
    
    // We need the value. We recalculate it or fetch it.
    // Re-fetching price for accuracy.
    const srcBal = await c.env.DB.prepare(
      `SELECT balance_qty, balance_value FROM inventory_movements
       WHERE company_id = ? AND item_code = ? AND warehouse = ? AND id < ?
       ORDER BY id DESC LIMIT 1`
    ).bind(company_id, ins.item_code, b.from_warehouse, ins.id).first<{ balance_qty: number; balance_value: number }>()
    
    const avgPrice  = (srcBal?.balance_value ?? 0) / (srcBal?.balance_qty ?? 1)
    const totVal    = item.quantity * avgPrice

    const itemRow = await c.env.DB.prepare("SELECT name FROM items WHERE code = ? AND company_id = ?")
      .bind(ins.item_code, company_id).first<{ name: string }>()

    try {
      await FinanceCore.resolveInventoryTransfer(c.env.DB, {
        company_id,
        ref_id: ins.id,
        item_code: ins.item_code,
        from_warehouse: b.from_warehouse,
        to_warehouse: b.to_warehouse,
        value: totVal,
        date: b.movement_date,
        item_name: itemRow?.name ?? String(ins.item_code),
        created_by: userId,
      })
    } catch (err: any) {
      console.error(`GL_BATCH_TRANSFER_POSTING_FAILED: Item ${ins.item_code}, Error: ${err.message}`)
    }
  }

  return c.json({ success: true, data: { count: b.items.length, batch_key: batchKey } })
})

export default movements
