import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveInventoryMovement as peResolveInventory,
  resolveInventoryTransfer as peResolveTransfer,
  resolvePurchaseReceipt as peResolvePurchaseReceipt,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'
import { readInventoryBalance, upsertInventoryBalance, enqueueInventoryPostingOutbox } from '../../inventory_posting'
import { resolveSupplierPayableAccount } from './supplier_payable_account'

function normalizeIsoDate(value: string): string {
  const raw = value.trim()
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) {
    throw new Error(`INVALID_RECEIPT_DATE: expected YYYY-MM-DD, got "${value}"`)
  }
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  const valid = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  if (!valid) {
    throw new Error(`INVALID_RECEIPT_DATE: out-of-range date "${value}"`)
  }
  return `${m[1]}-${m[2]}-${m[3]}`
}

function yearMonthParts(isoDate: string): { year: number; month: number } {
  const [y, m] = isoDate.split('-')
  return { year: Number(y), month: Number(m) }
}

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
    center_code?: number
    season_id?: number
    field_id?: number
    supplier_code?: number | string
    payment_method?: string
    work_order_id?: number
    warehouse_id?: number | null
  },
): Promise<number | null> {
  // Resolve IPG/PPG from DB so the posting_engine cascade uses Steps 1-7, not always Step 8.
  const [itemRow, movementRow] = await Promise.all([
    db.prepare(
      'SELECT prod_posting_group_code, inv_posting_group_code FROM items WHERE company_id = ? AND code = ? LIMIT 1'
    ).bind(opts.company_id, opts.item_code).first<{ prod_posting_group_code: string | null; inv_posting_group_code: string | null }>(),
    db.prepare(
      'SELECT warehouse_id, warehouse FROM inventory_movements WHERE company_id = ? AND id = ? LIMIT 1'
    ).bind(opts.company_id, opts.ref_id).first<{ warehouse_id: number | null; warehouse: string | null }>(),
  ])

  const effectiveWarehouseId = opts.warehouse_id ?? movementRow?.warehouse_id ?? null
  const effectiveWarehouseName = (opts.warehouse && opts.warehouse.trim()) || movementRow?.warehouse || null

  const warehouseRow = effectiveWarehouseId != null
    ? await db.prepare(
      'SELECT inv_posting_group_code FROM warehouses WHERE company_id = ? AND id = ? AND is_active = 1 LIMIT 1'
    ).bind(opts.company_id, effectiveWarehouseId).first<{ inv_posting_group_code: string | null }>()
    : (effectiveWarehouseName
      ? await db.prepare(
        'SELECT inv_posting_group_code FROM warehouses WHERE company_id = ? AND name = ? AND is_active = 1 LIMIT 1'
      ).bind(opts.company_id, effectiveWarehouseName).first<{ inv_posting_group_code: string | null }>()
      : null)

  // Warehouse IPG takes precedence over item-level IPG (warehouse is the physical location context)
  const ipg = warehouseRow?.inv_posting_group_code ?? itemRow?.inv_posting_group_code ?? null
  const ppg = itemRow?.prod_posting_group_code ?? null

  const blueprint = await peResolveInventory(
    db,
    opts.company_id,
    ipg,
    ppg,
    opts.value,
    opts.movement_type,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`INVENTORY_MOVEMENT_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  const dims = {
    center_code: opts.center_code,
    season_id:   opts.season_id,
    field_id:    opts.field_id,
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'inventory_movement',
    source_module: 'inventory',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `${opts.movement_type} مخزني | ${opts.item_name} | ${opts.warehouse}`,
    created_by:    opts.created_by,
    payload:       {
      item_code: opts.item_code,
      warehouse: opts.warehouse,
      warehouse_id: effectiveWarehouseId,
      movement_type: opts.movement_type,
      value: opts.value, item_name: opts.item_name, ipg, ppg,
    },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:    l.account_code!,
      debit:           l.debit ?? 0,
      credit:          l.credit ?? 0,
      description:     l.description ?? `${opts.movement_type} مخزني | ${opts.item_name}`,
      rule_slot:       l.rule_slot,
      source_ledger:   'inventory' as const,
      source_record_id: opts.ref_id,
      ...dims,
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
    center_code?: number
    season_id?: number
    field_id?: number
  },
): Promise<number | null> {
  const [itemRow, srcRow, dstRow] = await Promise.all([
    db.prepare(
      'SELECT prod_posting_group_code FROM items WHERE company_id = ? AND code = ? LIMIT 1'
    ).bind(opts.company_id, opts.item_code).first<{ prod_posting_group_code: string | null }>(),
    db.prepare(
      'SELECT inv_posting_group_code FROM warehouses WHERE company_id = ? AND name = ? AND is_active = 1 LIMIT 1'
    ).bind(opts.company_id, opts.from_warehouse).first<{ inv_posting_group_code: string | null }>(),
    db.prepare(
      'SELECT inv_posting_group_code FROM warehouses WHERE company_id = ? AND name = ? AND is_active = 1 LIMIT 1'
    ).bind(opts.company_id, opts.to_warehouse).first<{ inv_posting_group_code: string | null }>(),
  ])

  const ppg    = itemRow?.prod_posting_group_code ?? null
  const srcIpg = srcRow?.inv_posting_group_code ?? null
  const dstIpg = dstRow?.inv_posting_group_code ?? null

  const blueprint = await peResolveTransfer(
    db,
    opts.company_id,
    srcIpg,
    dstIpg,
    ppg,
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
    payload:       {
      item_code: opts.item_code, from_warehouse: opts.from_warehouse,
      to_warehouse: opts.to_warehouse, quantity: opts.quantity, value: opts.value,
      src_ipg: srcIpg, dst_ipg: dstIpg, ppg,
    },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:    l.account_code!,
      debit:           l.debit ?? 0,
      credit:          l.credit ?? 0,
      description:     l.description ?? `تحويل مخزني | ${opts.item_name}`,
      rule_slot:       l.rule_slot,
      source_ledger:   'inventory' as const,
      source_record_id: opts.ref_id,
      center_code:     opts.center_code,
      season_id:       opts.season_id,
      field_id:        opts.field_id,
    })),
  })
}

export async function resolvePurchaseReceipt(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    po_id?: number
    supplier_code?: number
    warehouse?: string
    warehouse_id?: number | null
    item_code?: number | null
    total_amount: number
    date: string
    description?: string
    service_type_code?: string | null
    created_by?: number
  },
): Promise<number | null> {
  // Resolve IPG from warehouse and PPG from item so the engine uses the correct
  // inventory account (step 1/2 of cascade) rather than always falling through to
  // the NULL×NULL catch-all (step 8 → 14070106 مخزن متنوع).
  const [warehouseRow, itemRow] = await Promise.all([
    opts.warehouse_id != null
      ? db.prepare('SELECT inv_posting_group_code FROM warehouses WHERE company_id=? AND id=? AND is_active=1 LIMIT 1')
          .bind(opts.company_id, opts.warehouse_id).first<{ inv_posting_group_code: string | null }>()
      : opts.warehouse
        ? db.prepare('SELECT inv_posting_group_code FROM warehouses WHERE company_id=? AND name=? AND is_active=1 LIMIT 1')
            .bind(opts.company_id, opts.warehouse).first<{ inv_posting_group_code: string | null }>()
        : Promise.resolve(null),
    opts.item_code != null
      ? db.prepare('SELECT prod_posting_group_code FROM items WHERE company_id=? AND code=? LIMIT 1')
          .bind(opts.company_id, opts.item_code).first<{ prod_posting_group_code: string | null }>()
      : Promise.resolve(null),
  ])
  const ipg = warehouseRow?.inv_posting_group_code ?? null
  const ppg = itemRow?.prod_posting_group_code ?? null

  const apCode = await resolveSupplierPayableAccount(db, opts.company_id, opts.supplier_code, null, opts.service_type_code)
  const blueprint = await peResolvePurchaseReceipt(
    db,
    opts.company_id,
    ipg,
    ppg,
    apCode,
    opts.total_amount,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`PURCHASE_RECEIPT_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  const supplierName = opts.supplier_code == null
    ? null
    : (await db.prepare(
      'SELECT name FROM suppliers WHERE company_id = ? AND code = ? LIMIT 1'
    ).bind(opts.company_id, opts.supplier_code).first<{ name: string | null }>())?.name ?? null

  const entryDescription = [
    'استلام مشتريات',
    supplierName ? `مورد ${supplierName}` : null,
    opts.po_id ? `أمر شراء #${opts.po_id}` : null,
    opts.warehouse ? `مخزن ${opts.warehouse}` : null,
    opts.description?.trim() || null,
  ].filter(Boolean).join(' | ')

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'purchase_receipt',
    source_module: 'inventory',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   entryDescription,
    created_by:    opts.created_by,
    payload:       { po_id: opts.po_id, supplier_code: opts.supplier_code, warehouse: opts.warehouse ?? '', total_amount: opts.total_amount, ipg, ppg, item_code: opts.item_code ?? null },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? entryDescription,
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
    notes?: string
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
  const receiptDate = normalizeIsoDate(opts.received_date)
  const ym = yearMonthParts(receiptDate)
  const localIdBase = `por_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  let movCount = 0

  for (const item of opts.items) {
    // Use authoritative balance snapshot (with staleness-heal fallback)
    const prev    = await readInventoryBalance(db, opts.company_id, item.item_code, item.warehouse)
    const valueIn = item.qty_received * item.unit_price
    const balQty  = prev.balance_qty + item.qty_received
    const balVal  = prev.balance_value + valueIn
    const localId = `${localIdBase}_${item.po_item_id}`

    const insertResult = await db.prepare(
      `INSERT INTO inventory_movements
       (company_id, item_code, movement_date, warehouse, movement_type,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        year, month, created_by_user_id, local_id, gl_posting_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`
    ).bind(
      opts.company_id, item.item_code, receiptDate, item.warehouse, 'GRN',
      item.qty_received, item.unit_price, item.qty_received, 0, balQty, valueIn, 0, balVal,
      ym.year, ym.month, opts.userId, localId,
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
  const warehouseSummary = Array.from(new Set(opts.items.map((item) => item.warehouse).filter(Boolean))).join(' + ')
  const itemSummary = opts.items.length === 1 ? opts.items[0].item_name : `${opts.items.length} أصناف`
  const receiptDescription = [itemSummary, opts.notes?.trim() || null].filter(Boolean).join(' | ')
  try {
    await resolvePurchaseReceipt(db, {
      company_id:    opts.company_id,
      ref_id:        opts.po_id,
      po_id:         opts.po_id,
      supplier_code: opts.supplier_code,
      warehouse:     warehouseSummary,
      // Pass first item's code so PPG can route to the correct inventory account
      item_code:     opts.items[0]?.item_code ?? null,
      total_amount:  totalAmount,
      date:          receiptDate,
      description:   receiptDescription,
      service_type_code: 'SRV_SUPPLY',
      created_by:    opts.userId,
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
