import type { D1Database } from '@cloudflare/workers-types'

export type InventoryPostingMode = 'strict_sync' | 'async_reliable' | 'decoupled'

export type InventoryPostingControls = {
  posting_mode: InventoryPostingMode
  zero_value_require_reason: number
  zero_value_approval_roles: string
  locked_through_date: string | null
}

const DEFAULT_CONTROLS: InventoryPostingControls = {
  posting_mode: 'async_reliable',
  zero_value_require_reason: 1,
  zero_value_approval_roles: 'super_admin,company_admin,accountant,field_supervisor',
  locked_through_date: null,
}

export async function getInventoryPostingControls(db: D1Database, companyId: number): Promise<InventoryPostingControls> {
  await db.prepare(
    `INSERT OR IGNORE INTO inventory_posting_controls
     (company_id, posting_mode, zero_value_require_reason, zero_value_approval_roles)
     VALUES (?, 'async_reliable', 1, 'super_admin,company_admin,accountant,field_supervisor')`
  ).bind(companyId).run()

  const row = await db.prepare(
    `SELECT posting_mode, zero_value_require_reason, zero_value_approval_roles, locked_through_date
     FROM inventory_posting_controls
     WHERE company_id = ?`
  ).bind(companyId).first<InventoryPostingControls>()

  return row ?? DEFAULT_CONTROLS
}

export function enforceInventoryLockDate(controls: InventoryPostingControls, movementDate: string) {
  if (!controls.locked_through_date) return
  if (movementDate <= controls.locked_through_date) {
    throw new Error(`INVENTORY_PERIOD_LOCKED:${controls.locked_through_date}`)
  }
}

export function validateZeroValuePolicy(
  controls: InventoryPostingControls,
  userRole: string,
  movementValue: number,
  zeroValueReason?: string,
): { required: boolean; approved: boolean } {
  if (movementValue !== 0) return { required: false, approved: true }

  if (controls.zero_value_require_reason && !zeroValueReason?.trim()) {
    throw new Error('ZERO_VALUE_REASON_REQUIRED')
  }

  const allowedRoles = (controls.zero_value_approval_roles || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
    throw new Error('ZERO_VALUE_APPROVAL_ROLE_REQUIRED')
  }

  return { required: true, approved: true }
}

export async function enqueueInventoryPostingOutbox(
  db: D1Database,
  companyId: number,
  eventType: 'inventory_movement' | 'inventory_transfer',
  movementId: number,
  payload: unknown,
): Promise<void> {
  const idempotencyKey = `${eventType}:${movementId}`
  // INSERT OR IGNORE: never overwrite a 'done' or 'failed' row with a fresh
  // pending entry. If the idempotency_key already exists (unique index), this
  // is a no-op — the movement was already queued or posted.
  await db.prepare(
    `INSERT OR IGNORE INTO inventory_posting_outbox
     (company_id, event_type, movement_id, payload_json, status, attempts, idempotency_key, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, datetime('now'))`
  ).bind(companyId, eventType, movementId, JSON.stringify(payload), idempotencyKey).run()
}

/**
 * Read the current balance for a (company, item, warehouse) slot.
 *
 * Uses the snapshot in inventory_balances for speed. If the snapshot is
 * marked is_stale (set by trigger trg_inv_bal_mark_stale after any INSERT
 * into inventory_movements), falls back to a full SUM from the ledger and
 * heals the snapshot before returning — so the next caller pays cache cost.
 *
 * Returns { balance_qty, balance_value } always (zero if no rows).
 */
export async function readInventoryBalance(
  db: D1Database,
  companyId: number,
  itemCode: number,
  warehouseId: number,
): Promise<{ balance_qty: number; balance_value: number }> {
  const snap = await db.prepare(
    `SELECT balance_qty, balance_value, is_stale
     FROM inventory_balances
     WHERE company_id = ? AND item_code = ? AND warehouse_id = ?`
  ).bind(companyId, itemCode, warehouseId)
    .first<{ balance_qty: number; balance_value: number; is_stale: number }>()

  if (snap && !snap.is_stale) {
    return { balance_qty: snap.balance_qty, balance_value: snap.balance_value }
  }

  // Stale or missing — recompute from ledger
  const ledger = await db.prepare(
    `SELECT
       COALESCE(SUM(qty_in)   - SUM(qty_out),   0) AS balance_qty,
       COALESCE(SUM(value_in) - SUM(value_out), 0) AS balance_value,
       MAX(id) AS last_movement_id
     FROM inventory_movements
     WHERE company_id = ? AND item_code = ? AND warehouse_id = ?`
  ).bind(companyId, itemCode, warehouseId)
    .first<{ balance_qty: number; balance_value: number; last_movement_id: number | null }>()

  const balQty = ledger?.balance_qty ?? 0
  const balVal = ledger?.balance_value ?? 0
  const lastId = ledger?.last_movement_id ?? null

  // Heal the snapshot (fire-and-forget — caller already has correct values)
  await db.prepare(
    `INSERT INTO inventory_balances
       (company_id, item_code, warehouse_id, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
     VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), 0)
     ON CONFLICT(company_id, item_code, warehouse_id) DO UPDATE SET
       balance_qty      = excluded.balance_qty,
       balance_value    = excluded.balance_value,
       version          = inventory_balances.version + 1,
       last_movement_id = excluded.last_movement_id,
       last_updated     = excluded.last_updated,
       is_stale         = 0`
  ).bind(companyId, itemCode, warehouseId, balQty, balVal, lastId).run()

  return { balance_qty: balQty, balance_value: balVal }
}

/**
 * Upsert the inventory_balances snapshot after every inventory_movements INSERT.
 *
 * The caller computes balQty / balVal — no extra SELECT needed.
 * Sets is_stale = 0 because we are writing the current authoritative value.
 * The version increment lets consumers detect stale reads via optimistic locking.
 */
export async function upsertInventoryBalance(
  db: D1Database,
  companyId: number,
  itemCode: number,
  warehouseId: number,
  balQty: number,
  balVal: number,
  movementId: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO inventory_balances
       (company_id, item_code, warehouse_id, balance_qty, balance_value, version, last_movement_id, last_updated, is_stale)
     VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), 0)
     ON CONFLICT(company_id, item_code, warehouse_id) DO UPDATE SET
       balance_qty      = excluded.balance_qty,
       balance_value    = excluded.balance_value,
       version          = inventory_balances.version + 1,
       last_movement_id = excluded.last_movement_id,
       last_updated     = excluded.last_updated,
       is_stale         = 0`
  ).bind(companyId, itemCode, warehouseId, balQty, balVal, movementId).run()
}
