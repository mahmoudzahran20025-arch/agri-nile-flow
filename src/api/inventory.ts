import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, permissionGuard } from '../middleware/auth'
import { glInventoryMovement, getOpenPeriod } from '../lib/gl'
import { FinanceCore } from '../lib/finance_core'
import { logAudit } from '../lib/audit'

const inventory = new Hono<{ Bindings: Env }>()
inventory.use('*', authMiddleware)

// GET /api/inventory/balances?warehouse_id=
inventory.get('/balances', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const warehouseId = c.req.query('warehouse_id')
  const oldWarehouse = c.req.query('warehouse') // backward compat

  let query = `SELECT * FROM vw_stock_balances WHERE company_id = ?`
  const binds: unknown[] = [company_id]
  
  if (warehouseId) {
    query += ` AND warehouse_id = ?`
    binds.push(Number(warehouseId))
  } else if (oldWarehouse) {
     query += ` AND warehouse = ?`
     binds.push(oldWarehouse)
  }
  query += ` ORDER BY warehouse, item_name`

  const { results } = await c.env.DB.prepare(query).bind(...binds).all()

  return c.json({ success: true, data: results })
})

// GET /api/inventory/warehouses
inventory.get('/warehouses', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, type, location FROM warehouses WHERE company_id = ? AND is_active = 1 ORDER BY name`
  ).bind(company_id).all()

  // For backward compatibility until full frontend rewrite, we return strings in data, but also provide objects
  return c.json({ 
    success: true, 
    data: results.map(r => (r as { name: string }).name),
    entities: results 
  })
})

// POST /api/inventory/warehouses
inventory.post('/warehouses', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{ name: string; type?: string; location?: string }>()
  
  if (!b.name) return c.json({ success: false, error: 'اسم المخزن مطلوب' }, 400)
  
  try {
    await c.env.DB.prepare(
      `INSERT INTO warehouses (company_id, name, type, location, manager_id) VALUES (?, ?, ?, ?, ?)`
    ).bind(company_id, b.name, b.type || 'internal', b.location || null, userId).run()
    
    return c.json({ success: true })
  } catch (err: any) {
    if (err.message.includes('UNIQUE')) return c.json({ success: false, error: 'اسم المخزن موجود بالفعل' }, 409)
    throw err
  }
})

// GET /api/inventory/movements?page=&size=&warehouse=&item_code=&type=&start=&end=
inventory.get('/movements', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(200, Number(c.req.query('size') ?? 100))
  const warehouse = c.req.query('warehouse')
  const itemCode  = c.req.query('item_code')
  const type      = c.req.query('type')
  const start     = c.req.query('start')
  const end       = c.req.query('end')
  const offset    = (page - 1) * size

  let where   = 'WHERE im.company_id = ?'
  const binds: unknown[] = [company_id]

  const fieldId = c.req.query('field_id')
  const seasonId = c.req.query('season_id')

  if (warehouse) { where += ' AND im.warehouse = ?';       binds.push(warehouse) }
  if (itemCode)  { where += ' AND im.item_code = ?';       binds.push(Number(itemCode)) }
  if (type)      { where += ' AND im.movement_type = ?';   binds.push(type) }
  if (start)     { where += ' AND im.movement_date >= ?';  binds.push(start) }
  if (end)       { where += ' AND im.movement_date <= ?';  binds.push(end) }
  if (fieldId)   { where += ' AND im.field_id = ?';        binds.push(Number(fieldId)) }
  if (seasonId)  { where += ' AND im.season_id = ?';       binds.push(Number(seasonId)) }
  const workOrderId = c.req.query('work_order_id')
  if (workOrderId) { where += ' AND im.work_order_id = ?'; binds.push(Number(workOrderId)) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT im.id, im.movement_date, im.warehouse, im.movement_type,
              im.item_code, i.name AS item_name, i.unit,
              im.quantity, im.unit_price, im.qty_in, im.qty_out, im.balance_qty,
              im.value_in, im.value_out, im.balance_value,
              s.name AS supplier_name, im.document_number, im.notes,
              im.season_id, im.field_id, f.name AS field_name,
              im.work_order_id, wo.name AS work_order_name,
              im.center_code, cc.name AS center_name
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

// POST /api/inventory/movements
inventory.post('/movements', permissionGuard('inventory', 'create'), async (c) => {
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

  // Auto-resolve center_code from field_id if missing
  let centerCode = b.center_code
  if (!centerCode && b.field_id) {
    const field = await c.env.DB.prepare("SELECT center_code FROM fields WHERE id = ? AND company_id = ?")
      .bind(b.field_id, company_id).first<{ center_code: number }>()
    if (field?.center_code) centerCode = field.center_code
  }

  // Pre-validate GL mappings to ensure atomicity
  const invAcc = await c.env.DB.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'inventory'").bind(company_id).first()
  if (!invAcc) return c.json({ success: false, error: 'GL_MAPPING_MISSING: حساب المخزون غير مربوط في الإعدادات.' }, 400)
  if (b.movement_type === 'اضافة') {
    const method = b.payment_method ?? 'credit'
    if (method === 'credit') {
      const apAcc = await c.env.DB.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'accounts_payable'").bind(company_id).first()
      if (!apAcc) return c.json({ success: false, error: 'GL_MAPPING_MISSING: حساب الموردين غير مربوط.' }, 400)
    } else {
      const cashAcc = await c.env.DB.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'").bind(company_id).first()
      if (!cashAcc) return c.json({ success: false, error: 'GL_MAPPING_MISSING: حساب النقدية غير مربوط.' }, 400)
    }
  }

  // Calculate running balance — find the immediately preceding transaction for this item+warehouse
  const lastRow = await c.env.DB.prepare(
    `SELECT balance_qty, balance_value FROM inventory_movements
     WHERE company_id = ? AND item_code = ? AND warehouse = ? AND (movement_date < ? OR (movement_date = ? AND id < (SELECT MAX(id)+1 FROM inventory_movements)))
     ORDER BY movement_date DESC, id DESC LIMIT 1`
  ).bind(company_id, b.item_code, b.warehouse, b.movement_date, b.movement_date).first<{ balance_qty: number; balance_value: number }>()

  const prevQty = lastRow?.balance_qty ?? 0
  const prevVal = lastRow?.balance_value ?? 0

  if (b.movement_type === 'صرف') {
    if (b.quantity > prevQty) {
      return c.json({ success: false, error: `الكمية المتاحة بتاريخ ${b.movement_date} هي (${prevQty})، والمطلوب (${b.quantity})`, code: 'INSUFFICIENT_STOCK' }, 409)
    }
    // Deep Check: Does this withdrawal cause any FUTURE record to go negative?
    const minFutureBal = await c.env.DB.prepare(
      `SELECT MIN(balance_qty) as min_bal FROM inventory_movements
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > (SELECT MAX(id) FROM inventory_movements WHERE movement_date = ?)))`
    ).bind(company_id, b.item_code, b.warehouse, b.movement_date, b.movement_date, b.movement_date).first<{ min_bal: number | null }>()

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
    glEntryId = await glInventoryMovement(c.env.DB, company_id, movId,
      b.movement_type, glValue, b.movement_date, itemRow?.name ?? String(b.item_code),
      userId, centerCode, b.payment_method, b.work_order_id)
  } catch (err: any) {
    // Compensating transaction (Rollback)
    await c.env.DB.prepare('DELETE FROM inventory_movements WHERE id = ?').bind(movId).run()
    await c.env.DB.prepare(
      `UPDATE inventory_movements
       SET balance_qty = balance_qty - ?, balance_value = balance_value - ?
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
         AND (movement_date > ? OR (movement_date = ? AND id > ?))`
    ).bind(dQty, dVal, company_id, b.item_code, b.warehouse, b.movement_date, b.movement_date, movId).run()
    throw new Error(`فشل إنشاء القيد المحاسبي وتم إلغاء الحركة المخزنية: ${err.message}`)
  }

  // Sync with Treasury if Cash Purchase
  if (b.movement_type === 'اضافة' && b.payment_method === 'cash') {
    await FinanceCore.recordCashMovement(c.env.DB, {
      company_id, userId,
      transaction_date: b.movement_date,
      direction: 'م', // Out (Payment)
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
    new_value: {
      type: b.movement_type, item: b.item_code, warehouse: b.warehouse,
      qty: b.quantity, price: unitPrice, date: b.movement_date,
    },
  })

  return c.json({ success: true, data: { balance_qty: balQty, balance_value: balVal, gl_entry_id: glEntryId } }, 201)
})

// GET /api/inventory/item/:code/stock?warehouse=
inventory.get('/item/:code/stock', async (c) => {
  const { company_id } = getUser(c)
  const code      = Number(c.req.param('code'))
  const warehouse = c.req.query('warehouse')

  const where  = warehouse ? 'AND warehouse = ?' : ''
  const subWhere = warehouse ? 'AND warehouse = ?' : ''
  const binds: unknown[] = warehouse 
    ? [company_id, code, warehouse, company_id, code, warehouse] 
    : [company_id, code, company_id, code]

  const { results } = await c.env.DB.prepare(
    `SELECT warehouse, balance_qty, balance_value
     FROM inventory_movements im
     WHERE company_id = ? AND item_code = ? ${where.replace('warehouse', 'im.warehouse')}
       AND id IN (
         SELECT MAX(id) FROM inventory_movements
         WHERE company_id = ? AND item_code = ? ${subWhere}
         GROUP BY warehouse
       )`
  ).bind(...binds).all<{ warehouse: string; balance_qty: number; balance_value: number }>()

  const totalQty = results.reduce((s, r) => s + (r.balance_qty ?? 0), 0)
  const totalVal = results.reduce((s, r) => s + (r.balance_value ?? 0), 0)

  return c.json({
    success: true,
    data: {
      by_warehouse: results,
      total_qty:    totalQty,
      total_value:  totalVal,
      avg_cost:     totalQty > 0 ? totalVal / totalQty : 0,
    },
  })
})

// POST /api/inventory/movements/batch — create multiple movements in one transaction
inventory.post('/movements/batch', async (c) => {
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
    items: Array<{
      item_code:   number
      quantity:    number
      unit_price?: number
      notes?:      string
    }>
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
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.movement_date}` }, 400)
  }

  // Pre-validate GL mappings to ensure atomicity
  const invAcc = await c.env.DB.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'inventory'").bind(company_id).first()
  if (!invAcc) return c.json({ success: false, error: 'GL_MAPPING_MISSING: حساب المخزون غير مربوط في الإعدادات.' }, 400)
  if (b.movement_type === 'اضافة') {
    const method = b.payment_method ?? 'credit'
    if (method === 'credit') {
      const apAcc = await c.env.DB.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'accounts_payable'").bind(company_id).first()
      if (!apAcc) return c.json({ success: false, error: 'GL_MAPPING_MISSING: حساب الموردين غير مربوط.' }, 400)
    } else {
      const cashAcc = await c.env.DB.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'cash'").bind(company_id).first()
      if (!cashAcc) return c.json({ success: false, error: 'GL_MAPPING_MISSING: حساب النقدية غير مربوط.' }, 400)
    }
  }

  // Auto-resolve center_code from field_id if missing
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

  // Step 1: Validate all items and compute values (sequential reads)
  type LineResult = {
    item_code:  number
    quantity:   number
    unit_price: number
    qtyIn:      number
    qtyOut:     number
    valueIn:    number
    valueOut:   number
    balQty:     number
    balVal:     number
    localId:    string
    lineNotes?: string
  }

  const lineResults: LineResult[] = []

  for (let i = 0; i < b.items.length; i++) {
    const li = b.items[i]
    if (!li.item_code || !li.quantity || li.quantity <= 0) {
      return c.json({ success: false, error: `السطر ${i + 1}: كود الصنف والكمية مطلوبان` }, 400)
    }

    // Calculate running balance per item for this date
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
        success:    false,
        error:      `الصنف "${itemRow?.name ?? '#' + li.item_code}": الرصيد المتاح (${prevQty}) أقل من الكمية المطلوبة (${li.quantity})`,
        code:       'INSUFFICIENT_STOCK',
        item_code:  li.item_code,
        available:  prevQty,
      }, 409)
    }

    const unitPrice = li.unit_price ?? (prevQty > 0 ? prevVal / prevQty : 0)
    const qtyIn     = b.movement_type === 'اضافة' ? li.quantity : 0
    const qtyOut    = b.movement_type === 'صرف'   ? li.quantity : 0
    const valueIn   = b.movement_type === 'اضافة' ? li.quantity * unitPrice : 0
    const valueOut  = b.movement_type === 'صرف'   ? li.quantity * unitPrice : 0

    lineResults.push({
      item_code:  li.item_code,
      quantity:   li.quantity,
      unit_price: unitPrice,
      qtyIn, qtyOut, valueIn, valueOut,
      balQty:     prevQty + qtyIn - qtyOut,
      balVal:     prevVal + valueIn - valueOut,
      localId:    `${batchKey}_${i}`,
      lineNotes:  li.notes,
    })
  }

  // Step 2: Batch insert all movements
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

  // Step 3: Retrieve inserted IDs and apply delta updates for backdating
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

  // Step 4: Create GL entries & Sync Treasury
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
      await glInventoryMovement(
        c.env.DB, company_id, ins.id,
        b.movement_type, glValue, b.movement_date,
        itemRow?.name ?? String(lr.item_code), userId, centerCode,
        b.payment_method, b.work_order_id
      )
    } catch (err: any) {
      // Compensating transaction (Rollback batch)
      await c.env.DB.prepare('DELETE FROM inventory_movements WHERE company_id = ? AND local_id LIKE ?')
        .bind(company_id, `${batchKey}_%`).run()
      
      // Revert balances
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
      direction: 'م', // Out
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
        item_code:     lr.item_code,
        quantity:      lr.quantity,
        balance_qty:   lr.balQty,
        balance_value: lr.balVal,
      })),
    },
  }, 201)
})

// GET /api/inventory/item/:code/card?warehouse=
inventory.get('/item/:code/card', async (c) => {
  const { company_id } = getUser(c)
  const code      = Number(c.req.param('code'))
  const warehouse = c.req.query('warehouse')

  const where  = warehouse ? 'AND warehouse = ?' : ''
  const binds  = warehouse ? [company_id, code, warehouse] : [company_id, code]

  const { results } = await c.env.DB.prepare(
    `SELECT movement_date, warehouse, movement_type, quantity, unit_price,
            qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
            document_number, notes
     FROM inventory_movements WHERE company_id = ? AND item_code = ? ${where}
     ORDER BY movement_date ASC, id ASC`
  ).bind(...binds).all()

  return c.json({ success: true, data: results })
})

// GET /api/inventory/cost-by-field?season_id=
inventory.get('/cost-by-field', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id')

  const binds: unknown[] = [company_id, company_id]
  let seasonFilter = ''
  if (seasonId) {
    seasonFilter = 'AND f.season_id = ?'
    binds.push(Number(seasonId))
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
       f.id, f.code, f.name AS field_name, f.area_feddan, f.crop_type,
       f.season_id,
       s.name AS season_name,
       COALESCE(SUM(CASE WHEN im.movement_type = 'صرف' THEN im.value_out ELSE 0 END), 0) AS total_consumed,
       COALESCE(SUM(CASE WHEN im.movement_type = 'اضافة' THEN im.value_in  ELSE 0 END), 0) AS total_added,
       COUNT(DISTINCT CASE WHEN im.movement_type = 'صرف' THEN im.item_code END)           AS items_consumed,
       CASE WHEN f.area_feddan > 0
            THEN COALESCE(SUM(CASE WHEN im.movement_type = 'صرف' THEN im.value_out ELSE 0 END), 0) / f.area_feddan
            ELSE NULL END AS cost_per_feddan,
       fsb.id          AS budget_id,
       fsb.budget_per_feddan,
       CASE
         WHEN fsb.budget_per_feddan IS NULL OR fsb.budget_per_feddan = 0 OR f.area_feddan = 0 THEN NULL
         ELSE ROUND(
           (
             (COALESCE(SUM(CASE WHEN im.movement_type = 'صرف' THEN im.value_out ELSE 0 END), 0) / f.area_feddan)
             - fsb.budget_per_feddan
           ) * 100.0 / fsb.budget_per_feddan,
           1
         )
       END AS variance_pct
     FROM fields f
     LEFT JOIN seasons s ON s.id = f.season_id
     LEFT JOIN inventory_movements im
            ON im.field_id = f.id AND im.company_id = ?
     LEFT JOIN field_season_budgets fsb
            ON fsb.field_id = f.id AND fsb.company_id = f.company_id
               AND fsb.season_id = f.season_id
     WHERE f.company_id = ? ${seasonFilter}
     GROUP BY f.id
     ORDER BY
       CASE WHEN fsb.budget_per_feddan IS NOT NULL THEN 0 ELSE 1 END,
       variance_pct DESC,
       total_consumed DESC`
  ).bind(...binds).all()

  return c.json({ success: true, data: results })
})

// GET /api/inventory/reorder-alerts
// Items where consumption in active work orders >= current balance * 0.8
inventory.get('/reorder-alerts', async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(`
    WITH last_balance AS (
      -- Latest running balance per item (highest id = most recent movement)
      SELECT im.item_code, im.balance_qty
      FROM inventory_movements im
      WHERE im.company_id = ?
        AND im.id = (
          SELECT MAX(id) FROM inventory_movements
          WHERE item_code = im.item_code AND company_id = im.company_id
        )
    ),
    active_consumption AS (
      -- Total صرف qty per item linked to active work orders
      SELECT im.item_code, SUM(im.qty_out) AS consumed_qty
      FROM inventory_movements im
      JOIN work_orders wo ON wo.id = im.work_order_id AND wo.company_id = im.company_id
      WHERE im.company_id = ?
        AND im.movement_type = 'صرف'
        AND wo.status IN ('pending', 'in_progress', 'done')
      GROUP BY im.item_code
    )
    SELECT
      lb.item_code,
      i.name     AS item_name,
      i.unit,
      lb.balance_qty  AS current_balance,
      ac.consumed_qty AS consumed_active_orders,
      ROUND(ac.consumed_qty * 100.0 / lb.balance_qty, 1) AS consumption_pct,
      (SELECT COUNT(DISTINCT wo2.id)
       FROM inventory_movements im2
       JOIN work_orders wo2 ON wo2.id = im2.work_order_id AND wo2.company_id = im2.company_id
       WHERE im2.item_code = lb.item_code AND im2.company_id = ?
         AND im2.movement_type = 'صرف'
         AND wo2.status IN ('pending', 'in_progress', 'done')
      ) AS active_order_count
    FROM last_balance lb
    JOIN active_consumption ac ON ac.item_code = lb.item_code
    JOIN items i ON i.code = lb.item_code AND i.company_id = ?
    WHERE lb.balance_qty > 0
      AND ac.consumed_qty >= lb.balance_qty * 0.8
    ORDER BY consumption_pct DESC
  `).bind(company_id, company_id, company_id, company_id).all()

  return c.json({ success: true, data: results })
})

// POST /api/inventory/receive-po/:po_id — convert PO items into inventory movements automatically
inventory.post('/receive-po/:po_id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const poId = Number(c.req.param('po_id'))

  const b = await c.req.json<{
    received_date: string
    notes?: string
    items: Array<{
      po_item_id: number
      qty_received: number
      warehouse:   string      // multi-warehouse: each line can target a different store
      unit_price?: number      // override price if needed
    }>
  }>()

  if (!b.received_date || !Array.isArray(b.items) || b.items.length === 0) {
    return c.json({ success: false, error: 'التاريخ وبنود الاستلام مطلوبة' }, 400)
  }

  // 1. Validate PO exists and belongs to company
  const po = await c.env.DB.prepare(
    'SELECT id, status, supplier_code FROM purchase_orders WHERE id = ? AND company_id = ?'
  ).bind(poId, company_id)
    .first<{ id: number; status: string; supplier_code: number | null }>()

  if (!po) return c.json({ success: false, error: 'طلب الشراء غير موجود' }, 404)
  if (po.status === 'cancelled' || po.status === 'closed') {
    return c.json({ success: false, error: `لا يمكن استلام طلب بحالة: ${po.status}` }, 400)
  }

  // 2. Validate open financial period
  const periodId = await getOpenPeriod(c.env.DB, company_id, b.received_date)
  if (!periodId) {
    return c.json({ success: false, error: `لا توجد فترة مالية مفتوحة للتاريخ ${b.received_date}` }, 400)
  }

  // 3. Pre-validate GL mappings (inventory + AP required for accrual receipt)
  const invAccChk = await c.env.DB.prepare(
    "SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'inventory'"
  ).bind(company_id).first()
  if (!invAccChk) return c.json({ success: false, error: 'GL_MAPPING_MISSING: حساب المخزون غير مربوط.' }, 400)

  const apAccChk = await c.env.DB.prepare(
    "SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = 'accounts_payable'"
  ).bind(company_id).first()
  if (!apAccChk) return c.json({ success: false, error: 'GL_MAPPING_MISSING: حساب الموردين غير مربوط.' }, 400)

  // 4. Validate and enrich each receive line
  const enrichedLines: Array<{
    po_item_id:   number
    item_code:    number
    item_name:    string
    qty_received: number
    unit_price:   number
    warehouse:    string
  }> = []

  for (const item of b.items) {
    const poItem = await c.env.DB.prepare(
      `SELECT id, item_code, item_name, unit_price, qty_ordered, qty_received
       FROM purchase_order_items WHERE id = ? AND po_id = ? AND company_id = ?`
    ).bind(item.po_item_id, poId, company_id)
      .first<{ id: number; item_code: number; item_name: string; unit_price: number; qty_ordered: number; qty_received: number }>()

    if (!poItem) return c.json({ success: false, error: `البند ${item.po_item_id} غير موجود` }, 404)
    
    const remaining = poItem.qty_ordered - poItem.qty_received
    if (item.qty_received > remaining) {
      return c.json({ success: false, error: `الكمية المستلمة (${item.qty_received}) تتجاوز المتبقي (${remaining}) لبند ${poItem.item_name}` }, 409)
    }

    enrichedLines.push({
      po_item_id:   item.po_item_id,
      item_code:    poItem.item_code,
      item_name:    poItem.item_name,
      qty_received: item.qty_received,
      unit_price:   item.unit_price ?? poItem.unit_price,
      warehouse:    item.warehouse
    })
  }

  // 5. Process receipt via FinanceCore (handles inventory, GL, and PO status)
  const { movements, status: newStatus } = await FinanceCore.processPOReceipt(c.env.DB, {
    company_id, userId, po_id: poId,
    received_date: b.received_date,
    supplier_code: po.supplier_code ?? undefined,
    items: enrichedLines
  })

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'RECEIVE_PO',
    table_name: 'purchase_orders', record_id: poId,
    new_value: { po_id: poId, lines_count: enrichedLines.length, status: newStatus },
  })

  return c.json({
    success: true,
    data: { po_id: poId, status: newStatus, movements_created: movements },
  }, 201)
})

// POST /api/inventory/transfer — Move stock between warehouses atomically
inventory.post('/transfer', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    movement_date: string; item_code: number; quantity: number
    from_warehouse: string; to_warehouse: string; notes?: string
  }>()

  if (!b.movement_date || !b.item_code || !b.quantity || !b.from_warehouse || !b.to_warehouse) {
    return c.json({ success: false, error: 'كل البيانات (التاريخ، الصنف، الكمية، من، إلى) مطلوبة' }, 400)
  }

  const periodId = await getOpenPeriod(c.env.DB, company_id, b.movement_date)
  if (!periodId) return c.json({ success: false, error: 'الفترة المالية مغلقة' }, 400)

  // 1. Get Source Balance & Price
  const srcBal = await c.env.DB.prepare(
    `SELECT balance_qty, balance_value FROM inventory_movements
     WHERE company_id = ? AND item_code = ? AND warehouse = ?
     ORDER BY movement_date DESC, id DESC LIMIT 1`
  ).bind(company_id, b.item_code, b.from_warehouse).first<{ balance_qty: number; balance_value: number }>()

  if (!srcBal || srcBal.balance_qty < b.quantity) {
    return c.json({ success: false, error: 'الرصيد في مخزن المصدر غير كافٍ' }, 409)
  }

  const avgPrice = srcBal.balance_value / srcBal.balance_qty
  const totalValue = b.quantity * avgPrice

  // 2. Get Destination Balance
  const dstBal = await c.env.DB.prepare(
    `SELECT balance_qty, balance_value FROM inventory_movements
     WHERE company_id = ? AND item_code = ? AND warehouse = ?
     ORDER BY movement_date DESC, id DESC LIMIT 1`
  ).bind(company_id, b.item_code, b.to_warehouse).first<{ balance_qty: number; balance_value: number }>()

  const dstPrevQty = dstBal?.balance_qty ?? 0
  const dstPrevVal = dstBal?.balance_value ?? 0

  const batchKey = `trf_${Date.now()}`
  const yr = new Date(b.movement_date).getFullYear()
  const mo = new Date(b.movement_date).getMonth() + 1

  // 3. Atomic Batch: Out from Src, In to Dst
  await c.env.DB.batch([
    // OUT
    c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_out, balance_qty, value_out, balance_value, notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, b.item_code, b.movement_date, b.from_warehouse, 'صرف',
      b.quantity, avgPrice, b.quantity, srcBal.balance_qty - b.quantity, totalValue, srcBal.balance_value - totalValue,
      `تحويل إلى ${b.to_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, `${batchKey}_out`),

    // IN
    c.env.DB.prepare(
      `INSERT INTO inventory_movements (company_id, item_code, movement_date, warehouse, movement_type,
       quantity, unit_price, qty_in, balance_qty, value_in, balance_value, notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, b.item_code, b.movement_date, b.to_warehouse, 'اضافة',
      b.quantity, avgPrice, b.quantity, dstPrevQty + b.quantity, totalValue, dstPrevVal + totalValue,
      `تحويل من ${b.from_warehouse}: ${b.notes ?? ''}`, yr, mo, userId, `${batchKey}_in`)
  ])

  return c.json({ success: true, data: { transferred: b.quantity, price: avgPrice } })
})

// GET /api/inventory/categories
inventory.get('/categories', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM item_categories WHERE company_id = ? ORDER BY name'
  ).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/inventory/categories
inventory.post('/categories', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ name: string; parent_id?: number; expense_account_code?: string; inventory_account_code?: string }>()
  if (!b.name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)

  await c.env.DB.prepare(
    `INSERT INTO item_categories (company_id, name, parent_id, expense_account_code, inventory_account_code)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(company_id, b.name, b.parent_id ?? null, b.expense_account_code ?? null, b.inventory_account_code ?? null).run()

  return c.json({ success: true })
})

// GET /api/inventory/adjustments
inventory.get('/adjustments', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, w.name as warehouse_name
     FROM inventory_adjustments a
     JOIN warehouses w ON w.id = a.warehouse_id
     WHERE a.company_id = ? ORDER BY a.adjustment_date DESC, a.id DESC`
  ).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/inventory/adjustments
inventory.post('/adjustments', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{ warehouse_id: number; adjustment_date: string; notes?: string; lines: any[] }>()

  if (!b.warehouse_id || !b.adjustment_date || !b.lines || b.lines.length === 0) {
    return c.json({ success: false, error: 'البيانات غير مكتملة' }, 400)
  }

  const { lastRowId } = await c.env.DB.prepare(
    `INSERT INTO inventory_adjustments (company_id, warehouse_id, adjustment_date, notes, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(company_id, b.warehouse_id, b.adjustment_date, b.notes ?? null, userId).run()

  const adjId = lastRowId

  const lineStmts = b.lines.map(l =>
    c.env.DB.prepare(
      `INSERT INTO inventory_adjustment_lines (adjustment_id, item_code, theoretical_qty, counted_qty, difference, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(adjId, l.item_code, l.theoretical_qty, l.counted_qty, l.counted_qty - l.theoretical_qty, l.notes ?? null)
  )

  if (lineStmts.length > 0) await c.env.DB.batch(lineStmts)

  return c.json({ success: true, id: adjId })
})

// GET /api/inventory/adjustments/:id
inventory.get('/adjustments/:id', async (c) => {
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

// POST /api/inventory/adjustments/:id/post
inventory.post('/adjustments/:id/post', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  // 1. Get Adjustment & Lines
  const adj = await c.env.DB.prepare(
    'SELECT * FROM inventory_adjustments WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ id: number; status: string; warehouse_id: number; adjustment_date: string; warehouse_name?: string }>()

  if (!adj) return c.json({ success: false, error: 'التسوية غير موجودة' }, 404)
  if (adj.status !== 'draft') return c.json({ success: false, error: 'التسوية تم ترحيلها بالفعل' }, 400)

  // Get warehouse name for the notes
  const wh = await c.env.DB.prepare('SELECT name FROM warehouses WHERE id = ?').bind(adj.warehouse_id).first<{ name: string }>()
  const warehouseName = wh?.name || 'مخزن'

  const { results: lines } = await c.env.DB.prepare(
    'SELECT * FROM inventory_adjustment_lines WHERE adjustment_id = ?'
  ).bind(id).all<{ item_code: number; difference: number; theoretical_qty: number; counted_qty: number }>()

  // 2. Validate Period
  const periodId = await getOpenPeriod(c.env.DB, company_id, adj.adjustment_date)
  if (!periodId) return c.json({ success: false, error: 'الفترة المالية مغلقة' }, 400)

  // 3. Process Each Line as an Inventory Movement
  // Note: We'll use a transaction/batch for the movements and balance updates
  // For simplicity here, we'll loop and use FinanceCore or direct inserts
  // Actually, we should use the same logic as batch movements to update running balances correctly

  const yr = new Date(adj.adjustment_date).getFullYear()
  const mo = new Date(adj.adjustment_date).getMonth() + 1
  const batchKey = `adj_${id}_${Date.now()}`

  for (const l of lines) {
    if (l.difference === 0) continue

    const movementType = l.difference > 0 ? 'اضافة' : 'صرف'
    const absQty = Math.abs(l.difference)

    // Get current balance/value for pricing (weighted average)
    const lastRow = await c.env.DB.prepare(
      `SELECT balance_qty, balance_value FROM inventory_movements
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
       ORDER BY movement_date DESC, id DESC LIMIT 1`
    ).bind(company_id, l.item_code, warehouseName).first<{ balance_qty: number; balance_value: number }>()

    const prevQty = lastRow?.balance_qty ?? 0
    const prevVal = lastRow?.balance_value ?? 0
    const unitPrice = prevQty > 0 ? prevVal / prevQty : 0
    const totalValue = absQty * unitPrice

    const qtyIn = movementType === 'اضافة' ? absQty : 0
    const qtyOut = movementType === 'صرف' ? absQty : 0
    const valIn = movementType === 'اضافة' ? totalValue : 0
    const valOut = movementType === 'صرف' ? totalValue : 0

    // Insert movement
    await c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, item_code, movement_date, warehouse, movement_type,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, l.item_code, adj.adjustment_date, warehouseName, movementType,
      absQty, unitPrice, qtyIn, qtyOut, prevQty + qtyIn - qtyOut, valIn, valOut, prevVal + valIn - valOut,
      `تسوية جردية رقم #${id}`, yr, mo, userId, `${batchKey}_${l.item_code}`
    ).run()

    // Create GL Entry for the adjustment
    // DB: Inventory (Asset) / CR: Inventory Adjustment Expense (P&L) if shortage
    // DR: Inventory (Asset) / CR: Inventory Gain (P&L) if surplus
    // We'll use a generic "Inventory Adjustment" GL mapping if available, or fallback to expense_default
    try {
      await glInventoryMovement(
        c.env.DB, company_id, id, // using adj ID as ref
        movementType, totalValue, adj.adjustment_date,
        `تسوية جردية - ${l.item_code}`, userId
      )
    } catch (e) {
       console.error("GL Integration failed for adjustment line", e)
    }
  }

  // 4. Update Adjustment Status
  await c.env.DB.prepare(
    'UPDATE inventory_adjustments SET status = "posted" WHERE id = ?'
  ).bind(id).run()

  return c.json({ success: true })
})

export default inventory
