/**
 * src/api/inventory/balances.ts
 * ─────────────────────────────
 * Phase 3: O(1) balance reads from the inventory_balances snapshot table,
 * plus exposure of the movement_types reference table to the frontend.
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'

const balances = new Hono<{ Bindings: Env }>()

// ── GET /balances ─────────────────────────────────────────────────────────────
// Returns current stock balances from the snapshot table (O(1) per row).
// Filters: ?warehouse=&item_code=&zero=1 (include zero balances)
// Route is /stock-balances (not /balances) to avoid conflict with the legacy
// GET /balances endpoint in items.ts which is consumed by WarehouseBalancesPage,
// ChartsPage, and ReportsPage.

balances.get('/stock-balances', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(Math.max(Number(c.req.query('size') ?? 50), 1), 200)
  const warehouse = c.req.query('warehouse') ?? ''
  const itemCode  = c.req.query('item_code')
  const search    = c.req.query('search') ?? ''
  const staleOnly = c.req.query('stale') === '1'
  const includeZero = c.req.query('zero') === '1'
  const offset    = (page - 1) * size

  const conditions: string[] = ['ib.company_id = ?']
  const binds: (string | number)[] = [company_id]

  if (warehouse)   { conditions.push('ib.warehouse = ?');                          binds.push(warehouse) }
  if (itemCode)    { conditions.push('ib.item_code = ?');                          binds.push(Number(itemCode)) }
  if (staleOnly)   { conditions.push('ib.is_stale = 1') }
  if (!includeZero){ conditions.push('ib.balance_qty != 0') }
  if (search)      {
    conditions.push('(i.name LIKE ? OR CAST(ib.item_code AS TEXT) LIKE ?)')
    binds.push(`%${search}%`, `%${search}%`)
  }

  const where = conditions.join(' AND ')

  const [totalRow, rows, warehouseList] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt
       FROM inventory_balances ib
       LEFT JOIN items i ON i.code = ib.item_code AND i.company_id = ib.company_id
       WHERE ${where}`
    ).bind(...binds).first<{ cnt: number }>(),

    c.env.DB.prepare(
      `SELECT
         ib.item_code,
         i.name        AS item_name,
         i.unit,
         i.category_id,
         i.prod_posting_group_code AS ppg,
         i.inv_posting_group_code  AS ipg,
         i.standard_cost,
         i.reorder_threshold,
         ib.warehouse,
         ib.balance_qty,
         ib.balance_value,
         CASE WHEN ib.balance_qty > 0 THEN ROUND(ib.balance_value / ib.balance_qty, 4) ELSE 0 END AS avg_cost,
         ib.is_stale,
         ib.last_updated           AS updated_at
       FROM inventory_balances ib
       LEFT JOIN items i ON i.code = ib.item_code AND i.company_id = ib.company_id
       WHERE ${where}
       ORDER BY ib.balance_value DESC, i.name ASC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all<{
      item_code: number; item_name: string | null; unit: string | null
      category_id: number | null; ppg: string | null; ipg: string | null
      standard_cost: number | null; reorder_threshold: number | null
      warehouse: string; balance_qty: number; balance_value: number
      avg_cost: number; is_stale: number; updated_at: string | null
    }>(),

    c.env.DB.prepare(
      `SELECT DISTINCT warehouse FROM inventory_balances WHERE company_id = ? ORDER BY warehouse`
    ).bind(company_id).all<{ warehouse: string }>(),
  ])

  return c.json({
    success:    true,
    data:       rows.results,
    warehouses: warehouseList.results.map(w => w.warehouse),
    pagination: {
      page,
      size,
      total:  totalRow?.cnt ?? 0,
      pages:  Math.ceil((totalRow?.cnt ?? 0) / size),
    },
    stale_count: rows.results.filter(r => r.is_stale).length,
  })
})

// ── GET /balances/:item_code ──────────────────────────────────────────────────
// Per-item balance across all warehouses + recent movement history.

balances.get('/balances/:item_code', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const itemCode = Number(c.req.param('item_code'))
  if (!itemCode) return c.json({ success: false, error: 'item_code required' }, 400)

  const [item, rows, recentMov] = await Promise.all([
    c.env.DB.prepare(
      `SELECT code, name, unit, category_id, prod_posting_group_code, inv_posting_group_code,
              standard_cost, reorder_threshold
       FROM items WHERE company_id = ? AND code = ?`
    ).bind(company_id, itemCode).first<{
      code: number; name: string; unit: string | null
      category_id: number | null; prod_posting_group_code: string | null
      inv_posting_group_code: string | null
      standard_cost: number | null; reorder_threshold: number | null
    }>(),

    c.env.DB.prepare(
      `SELECT warehouse, balance_qty, balance_value,
              CASE WHEN balance_qty > 0 THEN ROUND(balance_value / balance_qty, 4) ELSE 0 END AS avg_cost,
              is_stale, last_updated AS updated_at
       FROM inventory_balances
       WHERE company_id = ? AND item_code = ?
       ORDER BY balance_value DESC`
    ).bind(company_id, itemCode).all<{
      warehouse: string; balance_qty: number; balance_value: number
      avg_cost: number; is_stale: number; updated_at: string | null
    }>(),

    c.env.DB.prepare(
      `SELECT movement_date, movement_type, warehouse, quantity, unit_price, gl_posting_status
       FROM inventory_movements
       WHERE company_id = ? AND item_code = ?
       ORDER BY id DESC LIMIT 10`
    ).bind(company_id, itemCode).all<{
      movement_date: string; movement_type: string; warehouse: string
      quantity: number; unit_price: number; gl_posting_status: string
    }>(),
  ])

  if (!item) return c.json({ success: false, error: 'الصنف غير موجود' }, 404)

  const totalQty   = rows.results.reduce((s, r) => s + r.balance_qty,   0)
  const totalValue = rows.results.reduce((s, r) => s + r.balance_value, 0)

  return c.json({
    success: true,
    data: {
      item,
      by_warehouse: rows.results,
      totals: {
        total_qty:   totalQty,
        total_value: totalValue,
        avg_cost:    totalQty > 0 ? totalValue / totalQty : 0,
      },
      recent_movements: recentMov.results,
    },
  })
})

// ── GET /movement-types ───────────────────────────────────────────────────────
// Returns the movement_types reference table so the frontend can use typed codes
// and display localised labels without hard-coding them.

balances.get('/movement-types', permissionGuard('inventory', 'read'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT code, name_ar, direction, affects_inventory, affects_cogs,
            affects_wip, requires_reference, legacy_arabic_value, is_active
     FROM movement_types
     ORDER BY direction DESC, code ASC`
  ).all()

  return c.json({ success: true, data: results })
})

export default balances
