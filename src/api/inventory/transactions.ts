/**
 * src/api/inventory/transactions.ts
 * ──────────────────────────────────
 * Refactored: Uses inventory_movements directly as the source of truth
 * for logical documents (grouping by transaction_id).
 * The inventory_transactions header table has been DELETED.
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'

const transactions = new Hono<{ Bindings: Env }>()

// ── GET /inventory/transactions/summary ─────────────────────────────────────
transactions.get('/transactions/summary', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const warehouse    = c.req.query('warehouse')
  const start        = c.req.query('start')
  const end          = c.req.query('end')

  let where = 'WHERE im.company_id = ?'
  const binds: unknown[] = [company_id]

  if (warehouse) { where += ' AND im.warehouse = ?'; binds.push(warehouse) }
  if (start)     { where += ' AND im.movement_date >= ?'; binds.push(start) }
  if (end)       { where += ' AND im.movement_date <= ?'; binds.push(end) }

  const rows = await c.env.DB.prepare(
    `SELECT 
       CASE 
         WHEN im.movement_type IN ('ADJUSTMENT_PROFIT', 'ADJUSTMENT_LOSS') THEN 'ADJUSTMENT'
         WHEN im.movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER'
         ELSE im.movement_type 
       END AS transaction_type,
       COUNT(DISTINCT im.transaction_id) AS doc_count,
       COUNT(*) AS total_lines,
       SUM(im.qty_in + im.qty_out) AS total_qty,
       SUM(im.value_in + im.value_out) AS total_value
     FROM inventory_movements im
     \${where}
     GROUP BY transaction_type
     ORDER BY total_value DESC`
  ).bind(...binds).all()

  return c.json({ success: true, data: rows.results })
})

// ── GET /inventory/transactions ───────────────────────────────────────────────
transactions.get('/transactions', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const warehouse   = c.req.query('warehouse')
  const txType      = c.req.query('transaction_type')
  const start       = c.req.query('start')
  const end         = c.req.query('end')
  const workOrderId = c.req.query('work_order_id')
  const page        = Math.max(1, Number(c.req.query('page') ?? 1))
  const size        = Math.min(200, Number(c.req.query('size') ?? 50))
  const offset      = (page - 1) * size

  let where = 'WHERE im.company_id = ?'
  const binds: unknown[] = [company_id]

  if (warehouse)   { where += ' AND im.warehouse = ?'; binds.push(warehouse) }
  if (start)       { where += ' AND im.movement_date >= ?'; binds.push(start) }
  if (end)         { where += ' AND im.movement_date <= ?'; binds.push(end) }
  if (workOrderId) { where += ' AND im.work_order_id = ?'; binds.push(Number(workOrderId)) }
  
  if (txType) {
    if (txType === 'ADJUSTMENT') {
      where += " AND im.movement_type IN ('ADJUSTMENT_PROFIT', 'ADJUSTMENT_LOSS')"
    } else if (txType === 'TRANSFER') {
      where += " AND im.movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT')"
    } else {
      where += " AND im.movement_type = ?"
      binds.push(txType)
    }
  }

  // We group by transaction_id to present a document-level view
  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT 
         im.transaction_id AS id,
         CASE 
           WHEN im.movement_type IN ('ADJUSTMENT_PROFIT', 'ADJUSTMENT_LOSS') THEN 'ADJUSTMENT'
           WHEN im.movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER'
           ELSE im.movement_type 
         END AS transaction_type,
         im.document_number,
         im.movement_date,
         im.warehouse,
         MAX(im.notes) AS notes,
         'confirmed' AS status,
         COUNT(*) AS line_count,
         SUM(im.qty_in + im.qty_out) AS total_qty,
         SUM(im.value_in + im.value_out) AS total_value,
         MIN(im.created_by_user_id) AS created_by_user_id,
         MIN(im.created_at) AS created_at,
         SUM(CASE WHEN im.gl_posting_status IN ('pending','failed','outbox_pending') THEN 1 ELSE 0 END) AS unposted_lines
       FROM inventory_movements im
       \${where}
       GROUP BY im.transaction_id, transaction_type, im.document_number, im.movement_date, im.warehouse
       ORDER BY im.movement_date DESC, im.transaction_id DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT im.transaction_id) AS n FROM inventory_movements im \${where}`
    ).bind(...binds).first<{ n: number }>(),
  ])

  return c.json({
    success: true,
    data: rows.results,
    total: cnt?.n ?? 0,
    page,
    page_size: size,
    has_more: offset + size < (cnt?.n ?? 0),
  })
})

// ── GET /inventory/transactions/:id ──────────────────────────────────────────
transactions.get('/transactions/:id', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  // Reconstruct header from the movement lines
  const header = await c.env.DB.prepare(
    `SELECT 
       im.transaction_id AS id,
       CASE 
         WHEN im.movement_type IN ('ADJUSTMENT_PROFIT', 'ADJUSTMENT_LOSS') THEN 'ADJUSTMENT'
         WHEN im.movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER'
         ELSE im.movement_type 
       END AS transaction_type,
       im.document_number,
       im.movement_date,
       im.warehouse,
       MAX(im.notes) AS notes,
       'confirmed' AS status,
       COUNT(*) AS line_count,
       SUM(im.qty_in + im.qty_out) AS total_qty,
       SUM(im.value_in + im.value_out) AS total_value,
       MIN(im.created_by_user_id) AS created_by_user_id,
       MIN(im.created_at) AS created_at
     FROM inventory_movements im
     WHERE im.transaction_id = ? AND im.company_id = ?
     GROUP BY im.transaction_id, transaction_type, im.document_number, im.movement_date, im.warehouse`
  ).bind(id, company_id).first()

  if (!header) return c.json({ success: false, error: 'المعاملة غير موجودة' }, 404)

  const lines = await c.env.DB.prepare(
    `SELECT im.id, im.item_code, i.name AS item_name, i.unit,
            im.warehouse, im.movement_type,
            im.quantity, im.unit_price,
            im.qty_in, im.qty_out, im.balance_qty,
            im.value_in, im.value_out, im.balance_value,
            im.gl_posting_status, im.journal_entry_id,
            im.movement_date, im.notes
     FROM inventory_movements im
     LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
     WHERE im.transaction_id = ? AND im.company_id = ?
     ORDER BY im.id ASC`
  ).bind(id, company_id).all()

  return c.json({ success: true, data: { ...header, lines: lines.results } })
})

export default transactions
