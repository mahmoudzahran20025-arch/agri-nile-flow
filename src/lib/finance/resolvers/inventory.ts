import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveInventoryMovement as peResolveInventory,
  resolveInventoryTransfer as peResolveTransfer,
  resolvePurchaseReceipt as peResolvePurchaseReceipt,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'

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
  },
): Promise<number | null> {
  const blueprint = await peResolveInventory(
    db,
    opts.company_id,
    null,
    null,
    opts.value,
    opts.movement_type === 'اضافة',
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
    quantity: number
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
    warehouse: string
    total_amount: number
    date: string
    description?: string
    created_by?: number
  },
): Promise<number | null> {
  const apCode = '2100' // Default AP code - should come from control accounts
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
    description:   `استلام مشتريات | ${opts.description ?? ''} | ${opts.warehouse}`,
    created_by:    opts.created_by,
    payload:       { po_id: opts.po_id, supplier_id: opts.supplier_id, warehouse: opts.warehouse, total_amount: opts.total_amount },
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
