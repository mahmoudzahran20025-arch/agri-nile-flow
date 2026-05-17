/**
 * suppliers/shared.ts
 * ===================
 * Internal helpers shared across all suppliers sub-modules.
 * Not exported from the router — internal use only.
 */

import type { Env } from '../../types'
import { tableExists } from '../../lib/utils/api_helpers'

// ── Role guard ────────────────────────────────────────────────────────────────
// Re-exported so invoices.ts / payments.ts don't need to repeat the import.
export { roleGuard } from '../../middleware/auth'

export const FINANCE_ROLES = ['super_admin', 'company_admin', 'accountant'] as const

// ── Service authorization ─────────────────────────────────────────────────────
export async function isSupplierAuthorizedForService(
  db: Env['DB'],
  company_id: number,
  supplier_code: number,
  service_type_code: string,
): Promise<boolean> {
  if (!(await tableExists(db, 'supplier_service_map'))) return true

  const row = await db.prepare(
    `SELECT 1 AS ok
     FROM supplier_service_map
     WHERE company_id = ? AND supplier_code = ? AND service_type_code = ? AND is_active = 1
     LIMIT 1`
  ).bind(company_id, supplier_code, service_type_code).first<{ ok: number }>()

  return !!row?.ok
}

// ── Running balance maintenance ───────────────────────────────────────────────

/**
 * O(1) forward propagation for appended transactions.
 * Falls back to full rebalance for backdated inserts.
 * Call AFTER the new row is already inserted with balance = 0.
 */
export async function updateSupplierRunningBalance(
  db: Env['DB'],
  companyId: number,
  supplierCode: number,
  newTxnId: number,
  newTxnDate: string,
) {
  const latestRow = await db.prepare(
    `SELECT transaction_date FROM supplier_transactions
     WHERE company_id = ? AND supplier_code = ? AND id != ? AND status = 'posted'
     ORDER BY transaction_date DESC, id DESC LIMIT 1`
  ).bind(companyId, supplierCode, newTxnId).first<{ transaction_date: string }>()

  if (latestRow && latestRow.transaction_date > newTxnDate) {
    return fullRebalanceSupplierBalances(db, companyId, supplierCode)
  }

  const prevRow = await db.prepare(
    `SELECT balance_no_checks, balance_with_checks FROM supplier_transactions
     WHERE company_id = ? AND supplier_code = ? AND id < ? AND status = 'posted'
     ORDER BY transaction_date DESC, id DESC LIMIT 1`
  ).bind(companyId, supplierCode, newTxnId).first<{
    balance_no_checks: number; balance_with_checks: number
  }>()

  const newRow = await db.prepare(
    `SELECT credit, debit, check_amount FROM supplier_transactions WHERE id = ? AND company_id = ?`
  ).bind(newTxnId, companyId).first<{ credit: number; debit: number; check_amount: number | null }>()

  if (!newRow) return

  const prevNoChecks   = prevRow?.balance_no_checks   ?? 0
  const prevWithChecks = prevRow?.balance_with_checks ?? 0
  const delta          = (newRow.credit ?? 0) - (newRow.debit ?? 0)
  const deltaCheck     = delta + (newRow.check_amount ?? 0)

  await db.prepare(
    `UPDATE supplier_transactions SET balance_no_checks = ?, balance_with_checks = ? WHERE id = ? AND company_id = ?`
  ).bind(prevNoChecks + delta, prevWithChecks + deltaCheck, newTxnId, companyId).run()

  if (Math.abs(delta) > 0 || Math.abs(deltaCheck) > 0) {
    await db.prepare(
      `UPDATE supplier_transactions
       SET balance_no_checks   = balance_no_checks   + ?,
           balance_with_checks = balance_with_checks + ?
       WHERE company_id = ? AND supplier_code = ? AND id > ? AND status = 'posted'`
    ).bind(delta, deltaCheck, companyId, supplierCode, newTxnId).run()
  }
}

/** Full rebalance — used for backdated inserts and deletes. */
export async function fullRebalanceSupplierBalances(
  db: Env['DB'],
  companyId: number,
  supplierCode: number,
) {
  const { results: rows } = await db.prepare(
    `SELECT id, credit, debit, check_amount
     FROM supplier_transactions
     WHERE company_id = ? AND supplier_code = ? AND status = 'posted'
     ORDER BY transaction_date ASC, id ASC`
  ).bind(companyId, supplierCode).all<{
    id: number; credit: number | null; debit: number | null; check_amount: number | null
  }>()

  let runningNoChecks   = 0
  let runningWithChecks = 0

  const updates = rows.map((row) => {
    runningNoChecks   += (row.credit ?? 0) - (row.debit ?? 0)
    runningWithChecks += (row.credit ?? 0) - (row.debit ?? 0) + (row.check_amount ?? 0)
    return db.prepare(
      `UPDATE supplier_transactions SET balance_no_checks = ?, balance_with_checks = ? WHERE id = ? AND company_id = ?`
    ).bind(runningNoChecks, runningWithChecks, row.id, companyId)
  })

  if (updates.length) await db.batch(updates)
}

// ── Capital asset creation ────────────────────────────────────────────────────
export async function createOwnedCapitalAsset(
  db: Env['DB'],
  opts: {
    companyId: number
    txnId: number
    supplierCode: number
    equipmentType: { id: number; name: string; asset_nature: string; default_life_months: number } | null
    transactionDate: string
    amount: number
    centerCode: number | null
    userId: number
  },
): Promise<number | null> {
  if (!opts.equipmentType || opts.equipmentType.asset_nature !== 'capital') return null

  const assetCode  = `${opts.supplierCode}-${opts.txnId}-${Date.now()}`
  const lifeMonths = opts.equipmentType.default_life_months || 60

  const assetResult = await db.prepare(`
    INSERT INTO fixed_assets
      (company_id, asset_code, name, category, acquisition_date, cost, useful_life_months,
       depreciation_method, supplier_transaction_id, equipment_type_id, center_code, field_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    opts.companyId, assetCode, opts.equipmentType.name,
    'equipment', opts.transactionDate, opts.amount, lifeMonths,
    'straight_line', opts.txnId, opts.equipmentType.id,
    opts.centerCode, null, opts.userId,
  ).run()

  const assetId    = assetResult.meta.last_row_id as number
  const acqDate    = new Date(opts.transactionDate)
  const now        = new Date()
  const monthlyDep = lifeMonths > 0 ? Math.round((opts.amount / lifeMonths) * 100) / 100 : 0

  const scheduleInserts: Array<ReturnType<typeof db.prepare>> = []
  for (let y = acqDate.getFullYear(); y <= now.getFullYear(); y++) {
    const startMonth = y === acqDate.getFullYear() ? acqDate.getMonth() + 1 : 1
    const endMonth   = y === now.getFullYear() ? now.getMonth() + 1 : 12
    for (let m = startMonth; m <= endMonth; m++) {
      scheduleInserts.push(db.prepare(`
        INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, amount, status)
        VALUES (?,?,?,?,?,?)
      `).bind(opts.companyId, assetId, y, m, monthlyDep, 'pending'))
    }
  }
  if (scheduleInserts.length) await db.batch(scheduleInserts)

  return assetId
}

// ── Asset rollback (compensating action on GL failure) ───────────────────────
export async function rollbackCreatedAsset(
  db: Env['DB'],
  companyId: number,
  assetId: number,
) {
  await db.batch([
    db.prepare('DELETE FROM depreciation_schedules WHERE asset_id = ? AND company_id = ?').bind(assetId, companyId),
    db.prepare('DELETE FROM fixed_assets WHERE id = ? AND company_id = ?').bind(assetId, companyId),
  ])
}
