import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveInventoryMovement as peResolveInventory,
  resolveInventoryTransfer as peResolveTransfer,
  resolvePurchaseReceipt as peResolvePurchaseReceipt,
  resolveControlAccount,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'
import { readInventoryBalance, upsertInventoryBalance, enqueueInventoryPostingOutbox } from '../../inventory_posting'

export async function resolveInventoryMovement(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    item_code: number
    warehouse: string
    movement_type: string
    value: number
    date: string
    item_name: string
    created_by?: number
    // Optional context fields passed through to payload
    center_code?: number
    supplier_code?: number | string
    payment_method?: string
    work_order_id?: number
  },
): Promise<number | null> {
  const blueprint = await peResolveInventory(
    db,
    opts.company_id,
    null,
    null,
    opts.value,
    opts.movement_type,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`INVENTORY_MOVEMENT_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'inventory_movement',
    source_module: 'inventory',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `${opts.movement_type} مخزني | ${opts.item_name} | ${opts.warehouse}`,
    created_by:    opts.created_by,
    payload:       { item_code: opts.item_code, warehouse: opts.warehouse, movement_type: opts.movement_type, value: opts.value, item_name: opts.item_name },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `${opts.movement_type} مخزني | ${opts.item_name}`,
      rule_slot:     l.rule_slot,
      source_ledger: 'inventory' as const,
      source_record_id: opts.ref_id,
    })),
  })
}

export async function resolveInventoryTransfer(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    item_code: number
    from_warehouse: string
    to_warehouse: string
    quantity?: number
    value: number
    date: string
    item_name: string
    created_by?: number
  },
): Promise<number | null> {
  const blueprint = await peResolveTransfer(
    db,
    opts.company_id,
    null,
    null,
    null,
    opts.value,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`INVENTORY_TRANSFER_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'inventory_transfer',
    source_module: 'inventory',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `تحويل مخزني | ${opts.item_name} | ${opts.from_warehouse} → ${opts.to_warehouse}`,
    created_by:    opts.created_by,
    payload:       { item_code: opts.item_code, from_warehouse: opts.from_warehouse, to_warehouse: opts.to_warehouse, quantity: opts.quantity, value: opts.value },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `تحويل مخزني | ${opts.item_name}`,
      rule_slot:     l.rule_slot,
      source_ledger: 'inventory' as const,
      source_record_id: opts.ref_id,
    })),
  })
}

export async function resolvePurchaseReceipt(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    po_id?: number
    supplier_id?: number
    warehouse?: string
    total_amount: number
    date: string
    description?: string
    created_by?: number
  },
): Promise<number | null> {
  const apCode = await resolveControlAccount(db, opts.company_id, 'accounts_payable') ?? '212000010'
  const blueprint = await peResolvePurchaseReceipt(
    db,
    opts.company_id,
    null,
    null,
    apCode,
    opts.total_amount,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`PURCHASE_RECEIPT_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'purchase_receipt',
    source_module: 'inventory',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `استلام مشتريات | ${opts.description ?? ''} | ${opts.warehouse ?? ''}`,
    created_by:    opts.created_by,
    payload:       { po_id: opts.po_id, supplier_id: opts.supplier_id, warehouse: opts.warehouse ?? '', total_amount: opts.total_amount },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `استلام مشتريات | ${opts.warehouse}`,
      rule_slot:     l.rule_slot,
      source_ledger: 'inventory' as const,
      source_record_id: opts.ref_id,
    })),
  })
}

/**
 * processPOReceiptOrchestrated — high-level PO receipt orchestrator.
 * Creates inventory movements, updates PO item quantities, updates PO status,
 * and posts a GL entry via resolvePurchaseReceipt.
 * Returns { movements: count, status: new_po_status }.
 */
export async function processPOReceiptOrchestrated(
  db: D1Database,
  opts: {
    company_id: number
    userId: number
    po_id: number
    received_date: string
    supplier_code?: number
    items: Array<{
      po_item_id: number
      item_code: number
      item_name: string
      qty_received: number
      unit_price: number
      warehouse: string
    }>
  },
): Promise<{ movements: number; status: string }> {
  const localIdBase = `por_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  let movCount = 0

  for (const item of opts.items) {
    // Use authoritative balance snapshot (with staleness-heal fallback)
    const prev    = await readInventoryBalance(db, opts.company_id, item.item_code, item.warehouse)
    const valueIn = item.qty_received * item.unit_price
    const balQty  = prev.balance_qty + item.qty_received
    const balVal  = prev.balance_value + valueIn
    const d       = new Date(opts.received_date)
    const localId = `${localIdBase}_${item.po_item_id}`

    const insertResult = await db.prepare(
      `INSERT INTO inventory_movements
       (company_id, item_code, movement_date, warehouse, movement_type,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        year, month, created_by_user_id, local_id, gl_posting_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`
    ).bind(
      opts.company_id, item.item_code, opts.received_date, item.warehouse, 'GRN',
      item.qty_received, item.unit_price, item.qty_received, 0, balQty, valueIn, 0, balVal,
      d.getFullYear(), d.getMonth() + 1, opts.userId, localId,
    ).run()

    const movementId = insertResult.meta.last_row_id as number

    // Keep snapshot current so next item in the loop reads the correct balance
    await upsertInventoryBalance(db, opts.company_id, item.item_code, item.warehouse, balQty, balVal, movementId)

    await db.prepare(
      `UPDATE purchase_order_items SET qty_received = qty_received + ? WHERE id = ? AND company_id = ?`
    ).bind(item.qty_received, item.po_item_id, opts.company_id).run()

    movCount++
  }

  // Determine new PO status
  const remaining = await db.prepare(
    `SELECT SUM(qty_ordered - qty_received) AS rem
     FROM purchase_order_items WHERE po_id = ? AND company_id = ?`
  ).bind(opts.po_id, opts.company_id).first<{ rem: number }>()
  const newStatus = (remaining?.rem ?? 1) <= 0 ? 'received' : 'partial'

  await db.prepare(
    `UPDATE purchase_orders SET status = ? WHERE id = ? AND company_id = ?`
  ).bind(newStatus, opts.po_id, opts.company_id).run()

  // Post GL — on failure, mark movements failed and enqueue for async retry
  const totalAmount = opts.items.reduce((s, i) => s + i.qty_received * i.unit_price, 0)
  try {
    await resolvePurchaseReceipt(db, {
      company_id:   opts.company_id,
      ref_id:       opts.po_id,
      po_id:        opts.po_id,
      total_amount: totalAmount,
      date:         opts.received_date,
      created_by:   opts.userId,
    })
  } catch (err: unknown) {
    const errMsg = String((err as Error)?.message ?? err)
    // Mark all movements for this PO receipt as failed, then enqueue outbox
    const { results: failedMovs } = await db.prepare(
      `UPDATE inventory_movements SET gl_posting_status = 'failed', gl_posting_error = ?
       WHERE company_id = ? AND local_id LIKE ? AND gl_posting_status = 'pending'
       RETURNING id, item_code, warehouse, movement_type, value_in, value_out, movement_date`
    ).bind(errMsg, opts.company_id, `por_%_${opts.po_id}%`).all<{
      id: number; item_code: number; warehouse: string; movement_type: string
      value_in: number; value_out: number; movement_date: string
    }>()

    for (const mov of failedMovs ?? []) {
      await enqueueInventoryPostingOutbox(db, opts.company_id, 'inventory_movement', mov.id, {
        company_id: opts.company_id, ref_id: mov.id, item_code: mov.item_code,
        warehouse: mov.warehouse, movement_type: mov.movement_type,
        value: mov.value_in - mov.value_out, date: mov.movement_date,
      })
    }
  }

  return { movements: movCount, status: newStatus }
}
