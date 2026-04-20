import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'

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

// GET /api/inventory/movements?page=&size=&warehouse=&item_code=&type=
inventory.get('/movements', async (c) => {
  const { company_id } = getUser(c)
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(200, Number(c.req.query('size') ?? 100))
  const warehouse = c.req.query('warehouse')
  const itemCode  = c.req.query('item_code')
  const type      = c.req.query('type')
  const offset    = (page - 1) * size

  let where   = 'WHERE im.company_id = ?'
  const binds: unknown[] = [company_id]

  if (warehouse) { where += ' AND im.warehouse = ?';       binds.push(warehouse) }
  if (itemCode)  { where += ' AND im.item_code = ?';       binds.push(Number(itemCode)) }
  if (type)      { where += ' AND im.movement_type = ?';   binds.push(type) }

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

  return c.json({ success: true, data: { balance_qty: balQty, balance_value: balVal } }, 201)
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
