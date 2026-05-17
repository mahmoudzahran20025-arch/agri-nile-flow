import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveInventoryMovement as peResolveInventory,
  resolveInventoryTransfer as peResolveTransfer,
  resolvePurchaseReceipt as peResolvePurchaseReceipt,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'
import { normalizeIsoDate, yearMonthParts } from '../../utils/date'
import { readInventoryBalance, upsertInventoryBalance, enqueueInventoryPostingOutbox } from '../../inventory_posting'
import { resolveSupplierPayableAccount } from './supplier_payable_account'
import { resolveUnitFactor } from '../../finance_core'
import { postCostToWIP } from '../../wip_engine'

// Movement types that represent materials consumed on a crop cycle (field issue).
const ISSUE_MOVEMENT_TYPES = new Set(['ISSUE', 'issue', 'field_issue', 'consume', 'CONSUME'])

export async function resolveInventoryMovement(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    item_code: number
    warehouse_id: number
    movement_type: string
    quantity: number      // Quantity in the transaction unit
    unit?: string         // Unit in the transaction
    unit_price: number    // Price per transaction unit
    date: string
    item_name: string
    created_by?: number
    center_code?: number
    season_id?: number
    field_id?: number
    supplier_code?: number | string
    payment_method?: string
    work_order_id?: number
    batch_number?: string
    expiry_date?: string
    // When set and movement_type is an ISSUE type, cost is also posted to wip_ledger.
    crop_cycle_id?: number | null
  },
): Promise<number | null> {
  // Resolve base unit and posting groups
  const itemRow = await db.prepare(
    'SELECT unit, prod_posting_group_code, inv_posting_group_code FROM items WHERE company_id = ? AND code = ? LIMIT 1'
  ).bind(opts.company_id, opts.item_code).first<{ unit: string | null; prod_posting_group_code: string | null; inv_posting_group_code: string | null }>()

  if (!itemRow) throw new Error(`ITEM_NOT_FOUND: ${opts.item_code}`)

  // UOM Engine: Resolve factor
  const factor = (opts.unit && itemRow.unit) 
    ? await resolveUnitFactor(db, opts.company_id, opts.unit, itemRow.unit, opts.item_code)
    : 1

  const baseQty = opts.quantity * factor
  const totalValue = Math.round(opts.quantity * opts.unit_price * 100) / 100

  // Resolve IPG from warehouse
  const warehouseRow = await db.prepare(
    'SELECT inv_posting_group_code, name FROM warehouses WHERE company_id = ? AND id = ? AND is_active = 1 LIMIT 1'
  ).bind(opts.company_id, opts.warehouse_id).first<{ inv_posting_group_code: string | null; name: string }>()

  const ipg = warehouseRow?.inv_posting_group_code ?? itemRow.inv_posting_group_code ?? null
  const ppg = itemRow.prod_posting_group_code ?? null

  const blueprint = await peResolveInventory(
    db,
    opts.company_id,
    ipg,
    ppg,
    totalValue,
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

  const refId = opts.ref_id
  const entryId = await postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'inventory_movement',
    source_module: 'inventory',
    source_id:     refId,
    source_link_id: refId,
    event_date:    opts.date,
    description:   `${opts.movement_type} مخزني | ${opts.item_name} | ${warehouseRow?.name ?? opts.warehouse_id}`,
    created_by:    opts.created_by,
    payload:       {
      item_code: opts.item_code,
      warehouse_id: opts.warehouse_id,
      movement_type: opts.movement_type,
      quantity: opts.quantity,
      unit: opts.unit,
      factor,
      base_qty: baseQty,
      value: totalValue,
      item_name: opts.item_name,
      ipg, ppg,
      batch_number: opts.batch_number,
      expiry_date: opts.expiry_date,
    },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:    l.account_code!,
      debit:           l.debit ?? 0,
      credit:          l.credit ?? 0,
      description:     l.description ?? `${opts.movement_type} مخزني | ${opts.item_name}`,
      rule_slot:       l.rule_slot,
      source_ledger:   'inventory' as const,
      source_record_id: refId,
      ...dims,
    })),
    onJournalEntryPosted: async (journalEntryId) => {
      await db.prepare('UPDATE inventory_movements SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(journalEntryId, refId, opts.company_id).run()
    },
  })

  // WIP side-effect: field issue tied to a crop cycle → accumulate material cost.
  if (opts.crop_cycle_id && ISSUE_MOVEMENT_TYPES.has(opts.movement_type) && opts.season_id) {
    try {
      await postCostToWIP({
        db,
        company_id:         opts.company_id,
        crop_cycle_id:      opts.crop_cycle_id,
        season_id:          opts.season_id,
        transaction_date:   opts.date,
        cost_category:      'materials',
        cost_category_code: 'MATERIALS',
        debit:              totalValue,
        description:        `مواد: ${opts.item_name}`,
        source_module:      'inventory',
        source_id:          refId,
        journal_entry_id:   entryId,
      })
    } catch (wipErr) {
      // WIP failure must not roll back the GL posting — log and continue.
      console.error(`WIP_ACCUMULATION_FAILED: inventory movement ${refId}:`, (wipErr as Error).message)
    }
  }

  return entryId
}

export async function resolveInventoryTransfer(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    item_code: number
    from_warehouse_id: number
    to_warehouse_id: number
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
      'SELECT inv_posting_group_code, name FROM warehouses WHERE company_id = ? AND id = ? AND is_active = 1 LIMIT 1'
    ).bind(opts.company_id, opts.from_warehouse_id).first<{ inv_posting_group_code: string | null; name: string }>(),
    db.prepare(
      'SELECT inv_posting_group_code, name FROM warehouses WHERE company_id = ? AND id = ? AND is_active = 1 LIMIT 1'
    ).bind(opts.company_id, opts.to_warehouse_id).first<{ inv_posting_group_code: string | null; name: string }>(),
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

  const refId = opts.ref_id
  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'inventory_transfer',
    source_module: 'inventory',
    source_id:     refId,
    source_link_id: refId,
    event_date:    opts.date,
    description:   `تحويل مخزني | ${opts.item_name} | ${srcRow?.name} → ${dstRow?.name}`,
    created_by:    opts.created_by,
    payload:       {
      item_code: opts.item_code, from_warehouse_id: opts.from_warehouse_id,
      to_warehouse_id: opts.to_warehouse_id, quantity: opts.quantity, value: opts.value,
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
      source_record_id: refId,
      center_code:     opts.center_code,
      season_id:       opts.season_id,
      field_id:        opts.field_id,
    })),
    onJournalEntryPosted: async (entryId) => {
      await db.prepare('UPDATE inventory_movements SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, refId, opts.company_id).run()
    },
  })
}

export async function resolvePurchaseReceipt(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    po_id?: number
    supplier_code?: number
    warehouse_id: number
    item_code?: number | null
    total_amount: number
    date: string
    description?: string
    service_type_code?: string | null
    created_by?: number
  },
): Promise<number | null> {
  const [warehouseRow, itemRow] = await Promise.all([
    db.prepare('SELECT inv_posting_group_code, name FROM warehouses WHERE company_id=? AND id=? AND is_active=1 LIMIT 1')
      .bind(opts.company_id, opts.warehouse_id).first<{ inv_posting_group_code: string | null; name: string }>(),
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
    warehouseRow?.name ? `مخزن ${warehouseRow.name}` : null,
    opts.description?.trim() || null,
  ].filter(Boolean).join(' | ')

  const refId = opts.ref_id
  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'purchase_receipt',
    source_module: 'inventory',
    source_id:     refId,
    source_link_id: refId,
    event_date:    opts.date,
    description:   entryDescription,
    created_by:    opts.created_by,
    payload:       { po_id: opts.po_id, supplier_code: opts.supplier_code, warehouse_id: opts.warehouse_id, total_amount: opts.total_amount, ipg, ppg, item_code: opts.item_code ?? null },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? entryDescription,
      rule_slot:     l.rule_slot,
      source_ledger: 'inventory' as const,
      source_record_id: refId,
    })),
    onJournalEntryPosted: async (entryId) => {
      await db.prepare('UPDATE inventory_movements SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, refId, opts.company_id).run()
    },
  })
}

async function resolveWarehouse(
  db: D1Database,
  companyId: number,
  id?: number,
  name?: string,
): Promise<{ id: number; name: string } | null> {
  if (id) {
    return db.prepare('SELECT id, name FROM warehouses WHERE id = ? AND company_id = ? AND is_active = 1').bind(id, companyId).first<{ id: number; name: string }>() ?? null
  }
  if (name) {
    return db.prepare('SELECT id, name FROM warehouses WHERE name = ? AND company_id = ? AND is_active = 1').bind(name, companyId).first<{ id: number; name: string }>() ?? null
  }
  return null
}

export interface RawPOReceiptItem {
  po_item_id: number
  qty_received: number
  warehouse?: string
  warehouse_id?: number
  unit_price?: number
}

export interface EnrichedPOReceiptItem {
  po_item_id: number
  item_code: number
  item_name: string
  qty_received: number
  unit_price: number
  warehouse_id: number
}

export async function enrichPOReceiptItems(
  db: D1Database,
  companyId: number,
  poId: number,
  rawItems: RawPOReceiptItem[],
): Promise<EnrichedPOReceiptItem[]> {
  const enriched: EnrichedPOReceiptItem[] = []
  for (const item of rawItems) {
    const wh = await resolveWarehouse(db, companyId, item.warehouse_id, item.warehouse)
    if (!wh) throw Object.assign(new Error('المخزن غير موجود أو غير نشط'), { status: 422 })

    const poItem = await db.prepare(
      `SELECT id, item_code, item_name, unit_price, qty_ordered, qty_received
       FROM purchase_order_items WHERE id = ? AND po_id = ? AND company_id = ?`
    ).bind(item.po_item_id, poId, companyId)
      .first<{ id: number; item_code: number; item_name: string; unit_price: number; qty_ordered: number; qty_received: number }>()

    if (!poItem) throw Object.assign(new Error(`البند ${item.po_item_id} غير موجود`), { status: 404 })

    const remaining = poItem.qty_ordered - poItem.qty_received
    if (item.qty_received > remaining) {
      throw Object.assign(
        new Error(`الكمية المستلمة (${item.qty_received}) تتجاوز المتبقي (${remaining}) لبند ${poItem.item_name}`),
        { status: 409 }
      )
    }

    enriched.push({
      po_item_id:   item.po_item_id,
      item_code:    poItem.item_code,
      item_name:    poItem.item_name,
      qty_received: item.qty_received,
      unit_price:   item.unit_price ?? poItem.unit_price,
      warehouse_id: wh.id,
    })
  }
  return enriched
}

export async function processPOReceiptOrchestrated(
  db: D1Database,
  opts: {
    company_id: number
    userId: number
    po_id: number
    received_date: string
    supplier_code?: number
    notes?: string
    season_id?: number
    center_code?: number
    field_id?: number
    items: Array<{
      po_item_id: number
      item_code: number
      item_name: string
      qty_received: number
      unit_price: number
      warehouse_id: number
    }>
  },
): Promise<{ movements: number; movement_ids: number[]; status: string }> {
  const receiptDate = normalizeIsoDate(opts.received_date)
  const ym = yearMonthParts(receiptDate)
  const localIdBase = `por_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const transactionId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000)
  let movCount = 0
  const movementIds: number[] = []

  for (const item of opts.items) {
    const prev    = await readInventoryBalance(db, opts.company_id, item.item_code, item.warehouse_id)
    const valueIn = item.qty_received * item.unit_price
    const balQty  = prev.balance_qty + item.qty_received
    const balVal  = prev.balance_value + valueIn
    const localId = `${localIdBase}_${item.po_item_id}`

    const insertResult = await db.prepare(
      `INSERT INTO inventory_movements
       (company_id, item_code, movement_date, warehouse_id, movement_type,
        quantity, unit_price, qty_in, qty_out, balance_qty, value_in, value_out, balance_value,
        year, month, created_by_user_id, local_id, gl_posting_status, transaction_id,
        season_id, center_code, field_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      opts.company_id, item.item_code, receiptDate, item.warehouse_id, 'GRN',
      item.qty_received, item.unit_price, item.qty_received, 0, balQty, valueIn, 0, balVal,
      ym.year, ym.month, opts.userId, localId, 'pending', transactionId,
      opts.season_id ?? null, opts.center_code ?? null, opts.field_id ?? null
    ).run()

    const movementId = insertResult.meta.last_row_id as number
    movementIds.push(movementId)
    await upsertInventoryBalance(db, opts.company_id, item.item_code, item.warehouse_id, balQty, balVal, movementId)

    await db.prepare(
      `UPDATE purchase_order_items SET qty_received = qty_received + ? WHERE id = ? AND company_id = ?`
    ).bind(item.qty_received, item.po_item_id, opts.company_id).run()

    movCount++
  }

  const remaining = await db.prepare(
    `SELECT SUM(qty_ordered - qty_received) AS rem
     FROM purchase_order_items WHERE po_id = ? AND company_id = ?`
  ).bind(opts.po_id, opts.company_id).first<{ rem: number }>()
  const newStatus = (remaining?.rem ?? 1) <= 0 ? 'received' : 'partial'

  await db.prepare(`UPDATE purchase_orders SET status = ? WHERE id = ? AND company_id = ?`).bind(newStatus, opts.po_id, opts.company_id).run()

  const itemSummary = opts.items.length === 1 ? opts.items[0].item_name : `${opts.items.length} أصناف`
  const receiptDescription = [itemSummary, opts.notes?.trim() || null].filter(Boolean).join(' | ')

  for (const item of opts.items) {
    const lineAmount = Math.round(item.qty_received * item.unit_price * 100) / 100
    if (lineAmount <= 0) continue

    const movRow = await db.prepare(
      `SELECT id FROM inventory_movements WHERE company_id = ? AND local_id = ? LIMIT 1`
    ).bind(opts.company_id, `${localIdBase}_${item.po_item_id}`).first<{ id: number }>()

    try {
      const jeId = await resolvePurchaseReceipt(db, {
        company_id:        opts.company_id,
        ref_id:            movRow?.id ?? opts.po_id,
        po_id:             opts.po_id,
        supplier_code:     opts.supplier_code,
        warehouse_id:      item.warehouse_id,
        item_code:         item.item_code,
        total_amount:      lineAmount,
        date:              receiptDate,
        description:       `${item.item_name} | ${receiptDescription}`,
        service_type_code: 'SRV_SUPPLY',
        created_by:        opts.userId,
      })
      if (movRow?.id && jeId) {
        await db.prepare(
          `UPDATE inventory_movements SET gl_posting_status = 'posted', journal_entry_id = ?
           WHERE id = ? AND company_id = ?`
        ).bind(jeId, movRow.id, opts.company_id).run()
      }
    } catch (err: unknown) {
      const errMsg = String((err as Error)?.message ?? err)
      if (movRow?.id) {
        await db.prepare(
          `UPDATE inventory_movements SET gl_posting_status = 'failed', gl_posting_error = ?
           WHERE id = ? AND company_id = ?`
        ).bind(errMsg, movRow.id, opts.company_id).run()
        await enqueueInventoryPostingOutbox(db, opts.company_id, 'inventory_movement', movRow.id, {
          company_id: opts.company_id, ref_id: movRow.id, item_code: item.item_code,
          warehouse_id: item.warehouse_id, movement_type: 'GRN',
          value: lineAmount, date: receiptDate,
        })
      }
    }
  }

  return { movements: movCount, movement_ids: movementIds, status: newStatus }
}
