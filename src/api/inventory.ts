import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { glInventoryMovement, getOpenPeriod } from '../lib/gl'
import { logAudit } from '../lib/audit'

const inventory = new Hono<{ Bindings: Env }>()
inventory.use('*', authMiddleware)

// GET /api/inventory/balances?warehouse=
inventory.get('/balances', async (c) => {
  const { company_id } = getUser(c)
  const warehouse = c.req.query('warehouse')

  const whereWarehouse = warehouse ? 'AND im.warehouse = ?' : ''
  const binds = warehouse ? [company_id, warehouse] : [company_id]

  const { results } = await c.env.DB.prepare(
    `SELECT im.warehouse, im.item_code,
            i.name AS item_name, i.unit,
            SUM(im.qty_in)    AS total_in,
            SUM(im.qty_out)   AS total_out,
            SUM(im.qty_in) - SUM(im.qty_out)     AS balance_qty,
            SUM(im.value_in) - SUM(im.value_out)  AS balance_value
     FROM inventory_movements im
     LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
     WHERE im.company_id = ? ${whereWarehouse}
     GROUP BY im.warehouse, im.item_code
     HAVING balance_qty != 0
     ORDER BY im.warehouse, i.name`
  ).bind(...binds).all()

  return c.json({ success: true, data: results })
})

// GET /api/inventory/warehouses
inventory.get('/warehouses', async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT warehouse FROM inventory_movements WHERE company_id = ? ORDER BY warehouse`
  ).bind(company_id).all()

  return c.json({ success: true, data: results.map(r => (r as { warehouse: string }).warehouse) })
})

// GET /api/inventory/movements?page=&size=&warehouse=&item_code=&type=&start=&end=
inventory.get('/movements', async (c) => {
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

  if (warehouse) { where += ' AND im.warehouse = ?';       binds.push(warehouse) }
  if (itemCode)  { where += ' AND im.item_code = ?';       binds.push(Number(itemCode)) }
  if (type)      { where += ' AND im.movement_type = ?';   binds.push(type) }
  if (start)     { where += ' AND im.movement_date >= ?';  binds.push(start) }
  if (end)       { where += ' AND im.movement_date <= ?';  binds.push(end) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT im.id, im.movement_date, im.warehouse, im.movement_type,
              im.item_code, i.name AS item_name, i.unit,
              im.quantity, im.unit_price, im.qty_in, im.qty_out, im.balance_qty,
              im.value_in, im.value_out, im.balance_value,
              s.name AS supplier_name, im.document_number, im.notes
       FROM inventory_movements im
       LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
       LEFT JOIN suppliers s ON s.code = im.supplier_code AND s.company_id = im.company_id
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
inventory.post('/movements', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    movement_date: string; warehouse: string; movement_type: string
    item_code: number; quantity: number; unit_price?: number
    supplier_code?: number; document_number?: number; notes?: string
    season_id?: number; pack_capacity?: number; pack_count?: number
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

  // Get current balance for this item in this warehouse
  const balRow = await c.env.DB.prepare(
    `SELECT SUM(qty_in) - SUM(qty_out) AS bal_qty,
            SUM(value_in) - SUM(value_out) AS bal_val
     FROM inventory_movements WHERE company_id = ? AND item_code = ? AND warehouse = ?`
  ).bind(company_id, b.item_code, b.warehouse).first<{ bal_qty: number; bal_val: number }>()

  const prevQty = balRow?.bal_qty ?? 0
  const prevVal = balRow?.bal_val ?? 0

  if (b.movement_type === 'صرف' && b.quantity > prevQty) {
    return c.json({ success: false, error: `الكمية المتاحة (${prevQty}) أقل من المطلوب (${b.quantity})`, code: 'INSUFFICIENT_STOCK' }, 409)
  }

  const unitPrice = b.unit_price ?? (prevQty > 0 ? prevVal / prevQty : 0)
  const qtyIn     = b.movement_type === 'اضافة' ? b.quantity : 0
  const qtyOut    = b.movement_type === 'صرف'   ? b.quantity : 0
  const valueIn   = b.movement_type === 'اضافة' ? b.quantity * unitPrice : 0
  const valueOut  = b.movement_type === 'صرف'   ? b.quantity * unitPrice : 0
  const balQty    = prevQty + qtyIn - qtyOut
  const balVal    = prevVal + valueIn - valueOut

  const date = new Date(b.movement_date)
  await c.env.DB.prepare(
    `INSERT INTO inventory_movements
     (company_id, season_id, supplier_code, item_code, movement_date, warehouse,
      movement_type, document_number, pack_capacity, pack_count, quantity, unit_price,
      qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
      notes, year, month, created_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.season_id ?? null, b.supplier_code ?? null, b.item_code,
    b.movement_date, b.warehouse, b.movement_type, b.document_number ?? null,
    b.pack_capacity ?? null, b.pack_count ?? null, b.quantity, unitPrice,
    qtyIn, qtyOut, balQty, valueIn, valueOut, balVal,
    b.notes ?? null, date.getFullYear(), date.getMonth() + 1, userId
  ).run()

  const lastMov = await c.env.DB
    .prepare('SELECT id FROM inventory_movements WHERE company_id = ? ORDER BY id DESC LIMIT 1')
    .bind(company_id).first<{id:number}>()
  const movId = lastMov?.id ?? 0

  const itemRow = await c.env.DB
    .prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
    .bind(b.item_code, company_id).first<{name:string}>()

  const glValue = b.movement_type === 'اضافة' ? valueIn : valueOut
  await glInventoryMovement(c.env.DB, company_id, movId,
    b.movement_type, glValue, b.movement_date, itemRow?.name ?? String(b.item_code), userId)

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'inventory_movements', record_id: movId,
    new_value: {
      type: b.movement_type, item: b.item_code, warehouse: b.warehouse,
      qty: b.quantity, price: unitPrice, date: b.movement_date,
    },
  })

  return c.json({ success: true, data: { balance_qty: balQty, balance_value: balVal } }, 201)
})

// GET /api/inventory/item/:code/stock?warehouse=
inventory.get('/item/:code/stock', async (c) => {
  const { company_id } = getUser(c)
  const code      = Number(c.req.param('code'))
  const warehouse = c.req.query('warehouse')

  const where  = warehouse ? 'AND warehouse = ?' : ''
  const binds: unknown[] = warehouse ? [company_id, code, warehouse] : [company_id, code]

  const { results } = await c.env.DB.prepare(
    `SELECT warehouse,
            SUM(qty_in)  - SUM(qty_out)   AS balance_qty,
            SUM(value_in) - SUM(value_out) AS balance_value
     FROM inventory_movements
     WHERE company_id = ? AND item_code = ? ${where}
     GROUP BY warehouse`
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
    movement_date:   string
    warehouse:       string
    movement_type:   string
    supplier_code?:  number
    document_number?: number
    season_id?:      number
    notes?:          string
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

    const balRow = await c.env.DB.prepare(
      `SELECT SUM(qty_in) - SUM(qty_out)   AS bal_qty,
              SUM(value_in) - SUM(value_out) AS bal_val
       FROM inventory_movements WHERE company_id = ? AND item_code = ? AND warehouse = ?`
    ).bind(company_id, li.item_code, b.warehouse)
      .first<{ bal_qty: number; bal_val: number }>()

    const prevQty = balRow?.bal_qty ?? 0
    const prevVal = balRow?.bal_val ?? 0

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
  const stmts = lineResults.map(lr =>
    c.env.DB.prepare(
      `INSERT INTO inventory_movements
       (company_id, season_id, supplier_code, item_code, movement_date, warehouse,
        movement_type, document_number, quantity, unit_price,
        qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        notes, year, month, created_by_user_id, local_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      company_id, b.season_id ?? null, b.supplier_code ?? null, lr.item_code,
      b.movement_date, b.warehouse, b.movement_type, b.document_number ?? null,
      lr.quantity, lr.unit_price,
      lr.qtyIn, lr.qtyOut, lr.balQty, lr.valueIn, lr.valueOut, lr.balVal,
      lr.lineNotes ?? b.notes ?? null, year, month, userId, lr.localId
    )
  )
  await c.env.DB.batch(stmts)

  // Step 3: Retrieve IDs & create GL entries
  const { results: inserted } = await c.env.DB.prepare(
    `SELECT id, item_code, local_id FROM inventory_movements
     WHERE company_id = ? AND local_id LIKE ? ORDER BY id ASC`
  ).bind(company_id, `${batchKey}_%`)
    .all<{ id: number; item_code: number; local_id: string }>()

  for (const ins of inserted) {
    const lr = lineResults.find(r => r.localId === ins.local_id)
    if (!lr) continue
    const glValue = b.movement_type === 'اضافة' ? lr.valueIn : lr.valueOut
    const itemRow = await c.env.DB
      .prepare('SELECT name FROM items WHERE code = ? AND company_id = ?')
      .bind(lr.item_code, company_id).first<{ name: string }>()
    await glInventoryMovement(
      c.env.DB, company_id, ins.id,
      b.movement_type, glValue, b.movement_date,
      itemRow?.name ?? String(lr.item_code), userId
    )
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

export default inventory
