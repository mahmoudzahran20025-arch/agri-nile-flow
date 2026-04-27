import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'

const items = new Hono<{ Bindings: Env }>()

// ── Stock Balances ────────────────────────────────────────────

items.get('/balances', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const warehouseId = c.req.query('warehouse_id')
  const oldWarehouse = c.req.query('warehouse')

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

// ── Warehouses ────────────────────────────────────────────────

items.get('/warehouses', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, type, location FROM warehouses WHERE company_id = ? AND is_active = 1 ORDER BY name`
  ).bind(company_id).all()
  return c.json({
    success: true,
    data: results.map(r => (r as { name: string }).name),
    entities: results,
  })
})

items.post('/warehouses', permissionGuard('inventory', 'create'), async (c) => {
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

// ── Item Stock & Card ─────────────────────────────────────────

items.get('/item/:code/stock', async (c) => {
  const { company_id } = getUser(c)
  const code      = Number(c.req.param('code'))
  const warehouse = c.req.query('warehouse')

  const where    = warehouse ? 'AND warehouse = ?' : ''
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

items.get('/item/:code/card', async (c) => {
  const { company_id } = getUser(c)
  const code      = Number(c.req.param('code'))
  const warehouse = c.req.query('warehouse')

  const where = warehouse ? 'AND warehouse = ?' : ''
  const binds = warehouse ? [company_id, code, warehouse] : [company_id, code]

  const { results } = await c.env.DB.prepare(
    `SELECT movement_date, warehouse, movement_type, quantity, unit_price,
            qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
            document_number, notes
     FROM inventory_movements WHERE company_id = ? AND item_code = ? ${where}
     ORDER BY movement_date ASC, id ASC`
  ).bind(...binds).all()

  return c.json({ success: true, data: results })
})

// ── Categories ────────────────────────────────────────────────

items.get('/categories', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM item_categories WHERE company_id = ? ORDER BY name'
  ).bind(company_id).all()
  return c.json({ success: true, data: results })
})

items.post('/categories', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ name: string; parent_id?: number; expense_account_code?: string; inventory_account_code?: string }>()
  if (!b.name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)
  await c.env.DB.prepare(
    `INSERT INTO item_categories (company_id, name, parent_id, expense_account_code, inventory_account_code)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(company_id, b.name, b.parent_id ?? null, b.expense_account_code ?? null, b.inventory_account_code ?? null).run()
  return c.json({ success: true })
})

export default items
