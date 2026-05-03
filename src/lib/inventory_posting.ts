import type { D1Database } from '@cloudflare/workers-types'

export type InventoryPostingMode = 'strict_sync' | 'async_reliable' | 'decoupled'

export type InventoryPostingControls = {
  posting_mode: InventoryPostingMode
  zero_value_require_reason: number
  zero_value_approval_roles: string
  locked_through_date: string | null
}

const DEFAULT_CONTROLS: InventoryPostingControls = {
  posting_mode: 'strict_sync',
  zero_value_require_reason: 1,
  zero_value_approval_roles: 'super_admin,company_admin,accountant,field_supervisor',
  locked_through_date: null,
}

export async function getInventoryPostingControls(db: D1Database, companyId: number): Promise<InventoryPostingControls> {
  await db.prepare(
    `INSERT OR IGNORE INTO inventory_posting_controls
     (company_id, posting_mode, zero_value_require_reason, zero_value_approval_roles)
     VALUES (?, 'strict_sync', 1, 'super_admin,company_admin,accountant,field_supervisor')`
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
  await db.prepare(
    `INSERT OR REPLACE INTO inventory_posting_outbox
     (company_id, event_type, movement_id, payload_json, status, attempts, idempotency_key, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, datetime('now'))`
  ).bind(companyId, eventType, movementId, JSON.stringify(payload), idempotencyKey).run()
}
