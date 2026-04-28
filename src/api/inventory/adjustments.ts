import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { getOpenPeriod } from '../../lib/gl'
import { FinanceCore } from '../../lib/finance_core'

const adjustments = new Hono<{ Bindings: Env }>()

adjustments.get('/adjustments', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, w.name as warehouse_name
     FROM inventory_adjustments a
     JOIN warehouses w ON w.id = a.warehouse_id
     WHERE a.company_id = ? ORDER BY a.adjustment_date DESC, a.id DESC`
  ).bind(company_id).all()
  return c.json({ success: true, data: results })
})

adjustments.post('/adjustments', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{ warehouse_id: number; adjustment_date: string; notes?: string; lines: any[] }>()

  if (!b.warehouse_id || !b.adjustment_date || !b.lines || b.lines.length === 0) {
    return c.json({ success: false, error: 'البيانات غير مكتملة' }, 400)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO inventory_adjustments (company_id, warehouse_id, adjustment_date, notes, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(company_id, b.warehouse_id, b.adjustment_date, b.notes ?? null, userId).run()

  const adjId = result.meta.last_row_id

  const lineStmts = b.lines.map((l: any) =>
    c.env.DB.prepare(
      `INSERT INTO inventory_adjustment_lines (adjustment_id, item_code, theoretical_qty, counted_qty, difference, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(adjId, l.item_code, l.theoretical_qty, l.counted_qty, l.counted_qty - l.theoretical_qty, l.notes ?? null)
  )

  if (lineStmts.length > 0) await c.env.DB.batch(lineStmts)

  return c.json({ success: true, id: adjId })
})

adjustments.get('/adjustments/:id', async (c) => {
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

adjustments.post('/adjustments/:id/post', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const adj = await c.env.DB.prepare(
    'SELECT * FROM inventory_adjustments WHERE id = ? AND company_id = ?'
  ).bind(id, company_id)
    .first<{ id: number; status: string; warehouse_id: number; adjustment_date: string }>()

  if (!adj) return c.json({ success: false, error: 'التسوية غير موجودة' }, 404)
  if (adj.status !== 'draft') return c.json({ success: false, error: 'التسوية تم ترحيلها بالفعل' }, 400)

  const wh = await c.env.DB.prepare('SELECT name FROM warehouses WHERE id = ?')
    .bind(adj.warehouse_id).first<{ name: string }>()
  const warehouseName = wh?.name || 'مخزن'

  const { results: lines } = await c.env.DB.prepare(
    'SELECT * FROM inventory_adjustment_lines WHERE adjustment_id = ?'
  ).bind(id).all<{ item_code: number; difference: number; theoretical_qty: number; counted_qty: number }>()

  const periodId = await getOpenPeriod(c.env.DB, company_id, adj.adjustment_date)
  if (!periodId) return c.json({ success: false, error: 'الفترة المالية مغلقة' }, 400)

  const yr = new Date(adj.adjustment_date).getFullYear()
  const mo = new Date(adj.adjustment_date).getMonth() + 1
  const batchKey = `adj_${id}_${Date.now()}`

  for (const l of lines) {
    if (l.difference === 0) continue

    const movementType = l.difference > 0 ? 'اضافة' : 'صرف'
    const absQty = Math.abs(l.difference)

    const lastRow = await c.env.DB.prepare(
      `SELECT balance_qty, balance_value FROM inventory_movements
       WHERE company_id = ? AND item_code = ? AND warehouse = ?
       ORDER BY movement_date DESC, id DESC LIMIT 1`
    ).bind(company_id, l.item_code, warehouseName)
      .first<{ balance_qty: number; balance_value: number }>()

    const prevQty = lastRow?.balance_qty ?? 0
    const prevVal = lastRow?.balance_value ?? 0
    const unitPrice  = prevQty > 0 ? prevVal / prevQty : 0
    const totalValue = absQty * unitPrice

    const qtyIn  = movementType === 'اضافة' ? absQty : 0
    const qtyOut = movementType === 'صرف'   ? absQty : 0
    const valIn  = movementType === 'اضافة' ? totalValue : 0
    const valOut = movementType === 'صرف'   ? totalValue : 0

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

    try {
      await FinanceCore.resolveInventoryMovement(c.env.DB, {
        company_id,
        ref_id: id,
        item_code: l.item_code,
        warehouse: warehouseName,
        movement_type: movementType,
        value: totalValue,
        date: adj.adjustment_date,
        item_name: `تسوية جردية - ${l.item_code}`,
        created_by: userId,
        // Adjustments are internal, no supplier or payment method
      })
    } catch {
      // GL failure on adjustment lines is logged but non-fatal;
      // the physical count correction is committed, GL needs manual fix.
    }
  }

  await c.env.DB.prepare(
    'UPDATE inventory_adjustments SET status = "posted" WHERE id = ?'
  ).bind(id).run()

  return c.json({ success: true })
})

export default adjustments
