/**
 * src/api/inventory/transactions.ts
 * ──────────────────────────────────
 * Phase 4: Expose the inventory_transactions header table so the frontend
 * (and external integrations) can query grouped movements by document.
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'

const transactions = new Hono<{ Bindings: Env }>()

// ── GET /inventory/transactions/summary ─────────────────────────────────────
// Aggregated totals grouped by transaction_type for a date range.
// Improvement 3: Season/period inventory value report.
// Supports same filters as the list endpoint (no pagination).

transactions.get('/transactions/summary', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const warehouse    = c.req.query('warehouse')
  const txType       = c.req.query('transaction_type')
  const start        = c.req.query('start')
  const end          = c.req.query('end')
  const workOrderId  = c.req.query('work_order_id')
  const glStatus     = c.req.query('gl_posting_status')

  let where   = 'WHERE it.company_id = ?'
  const binds: unknown[] = [company_id]

  if (warehouse)   { where += ' AND it.warehouse = ?';        binds.push(warehouse) }
  if (txType)      { where += ' AND it.transaction_type = ?'; binds.push(txType) }
  if (start)       { where += ' AND it.movement_date >= ?';   binds.push(start) }
  if (end)         { where += ' AND it.movement_date <= ?';   binds.push(end) }
  if (workOrderId) {
    where += ` AND EXISTS (
      SELECT 1 FROM inventory_movements im2
      WHERE im2.transaction_id = it.id AND im2.work_order_id = ?)`
    binds.push(Number(workOrderId))
  }
  if (glStatus) {
    if (glStatus === 'unposted') {
      where += ` AND EXISTS (
        SELECT 1 FROM inventory_movements im2
        WHERE im2.transaction_id = it.id
          AND im2.gl_posting_status IN ('pending','failed','outbox_pending'))`
    } else {
      where += ` AND EXISTS (
        SELECT 1 FROM inventory_movements im2
        WHERE im2.transaction_id = it.id AND im2.gl_posting_status = ?)`
      binds.push(glStatus)
    }
  }

  const rows = await c.env.DB.prepare(
    `SELECT it.transaction_type,
            COUNT(*) AS doc_count,
            COALESCE(SUM(it.line_count), 0)  AS total_lines,
            COALESCE(SUM(it.total_qty),   0) AS total_qty,
            COALESCE(SUM(it.total_value), 0) AS total_value
     FROM inventory_transactions it
     ${where}
     GROUP BY it.transaction_type
     ORDER BY total_value DESC`
  ).bind(...binds).all()

  return c.json({ success: true, data: rows.results })
})

// ── GET /inventory/transactions ───────────────────────────────────────────────
// List transaction headers with optional filters.
// Supports: ?warehouse= &transaction_type= &start= &end= &work_order_id= &page= &size=

transactions.get('/transactions', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const warehouse   = c.req.query('warehouse')
  const txType      = c.req.query('transaction_type')
  const start       = c.req.query('start')
  const end         = c.req.query('end')
  const workOrderId = c.req.query('work_order_id')
  const glStatus    = c.req.query('gl_posting_status')
  const page        = Math.max(1, Number(c.req.query('page') ?? 1))
  const size        = Math.min(200, Number(c.req.query('size') ?? 50))
  const offset      = (page - 1) * size

  let where   = 'WHERE it.company_id = ?'
  const binds: unknown[] = [company_id]

  if (warehouse)   { where += ' AND it.warehouse = ?';        binds.push(warehouse) }
  if (txType)      { where += ' AND it.transaction_type = ?'; binds.push(txType) }
  if (start)       { where += ' AND it.movement_date >= ?';   binds.push(start) }
  if (end)         { where += ' AND it.movement_date <= ?';   binds.push(end) }
  // Improvement 2: work-order cost rollup — filter transactions that have at least
  // one movement line linked to the requested work order.
  if (workOrderId) {
    where += ` AND EXISTS (
      SELECT 1 FROM inventory_movements im2
      WHERE im2.transaction_id = it.id AND im2.work_order_id = ?)`
    binds.push(Number(workOrderId))
  }
  // gl_posting_status filter — shows only transactions containing at least one
  // movement line with the requested GL status (e.g. 'pending', 'failed').
  // Special value 'unposted' expands to pending|failed|outbox_pending.
  if (glStatus) {
    if (glStatus === 'unposted') {
      where += ` AND EXISTS (
        SELECT 1 FROM inventory_movements im2
        WHERE im2.transaction_id = it.id
          AND im2.gl_posting_status IN ('pending','failed','outbox_pending'))`
    } else {
      where += ` AND EXISTS (
        SELECT 1 FROM inventory_movements im2
        WHERE im2.transaction_id = it.id AND im2.gl_posting_status = ?)`
      binds.push(glStatus)
    }
  }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT it.id, it.transaction_type, it.document_number, it.movement_date,
              it.warehouse, it.to_warehouse, it.notes, it.status,
              it.line_count, it.total_qty, it.total_value,
              it.created_by_user_id, it.created_at,
              (SELECT COUNT(*) FROM inventory_movements im3
               WHERE im3.transaction_id = it.id
                 AND im3.gl_posting_status IN ('pending','failed','outbox_pending')) AS unposted_lines
       FROM inventory_transactions it
       ${where}
       ORDER BY it.movement_date DESC, it.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM inventory_transactions it ${where}`
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
// Single transaction header + all movement lines grouped under it.

transactions.get('/transactions/:id', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const header = await c.env.DB.prepare(
    `SELECT id, transaction_type, document_number, movement_date,
            warehouse, to_warehouse, notes, status,
            line_count, total_qty, total_value, created_by_user_id, created_at
     FROM inventory_transactions
     WHERE id = ? AND company_id = ?`
  ).bind(id, company_id).first()

  if (!header) return c.json({ success: false, error: 'المعاملة غير موجودة' }, 404)

  let linesRes = await c.env.DB.prepare(
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

  // Historical imported rows often have inventory_transactions headers populated
  // while inventory_movements.transaction_id remains NULL. Fall back to a natural
  // document match so the drawer can still show the underlying lines.
  if ((linesRes.results?.length ?? 0) === 0 && header.document_number != null) {
    linesRes = await c.env.DB.prepare(
      `SELECT im.id, im.item_code, i.name AS item_name, i.unit,
              im.warehouse, im.movement_type,
              im.quantity, im.unit_price,
              im.qty_in, im.qty_out, im.balance_qty,
              im.value_in, im.value_out, im.balance_value,
              im.gl_posting_status, im.journal_entry_id,
              im.movement_date, im.notes
       FROM inventory_movements im
       LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
       WHERE im.company_id = ?
         AND im.transaction_id IS NULL
         AND CAST(im.document_number AS TEXT) = CAST(? AS TEXT)
         AND im.movement_date = ?
         AND im.warehouse = ?
         AND (
           CASE
             WHEN im.movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN 'TRANSFER'
             ELSE im.movement_type
           END
         ) = ?
       ORDER BY im.id ASC`
    ).bind(company_id, header.document_number, header.movement_date, header.warehouse, header.transaction_type).all()
  }

  return c.json({ success: true, data: { ...header, lines: linesRes.results } })
})

export default transactions
