/**
 * FinanceCore - Facade/Factory Pattern
 * ====================================
 * This file serves as the main entry point for all finance-related operations.
 * It re-exports all functions from the modularized finance directory.
 * 
 * The actual implementations have been split into:
 * - business_events.ts: Core business event posting logic
 * - cash_movement.ts: Cash transaction operations
 * - resolvers/: Domain-specific resolver functions
 */

import type { D1Database } from '@cloudflare/workers-types'
import { resolveControlAccount } from './posting_engine'

// Import all modules from the finance directory
import {
  // Business Events
  postFromBusinessEvent,
  syncSourceDocumentBridge,
  // Cash Movement
  prepareCashMovement,
  commitCashDrafts,
  postCashMovement,
  // Inventory Resolvers
  resolveInventoryMovement,
  resolveInventoryTransfer,
  resolvePurchaseReceipt,
  processPOReceiptOrchestrated,
  // Supplier Resolvers
  resolveSupplierInvoice,
  resolveSupplierPayment,
  // Cash & Revenue Resolvers
  resolveCashLedger,
  resolveExpensePosting,
  resolveSalesRevenue,
  // Payroll Resolvers
  resolvePayrollPosting,
  resolvePayrollPayment,
  // Operations Resolvers
  resolveWorkOrderLabor,
  resolveContractAdvance,
  // Partner Resolvers
  resolvePartnerCapital,
  resolvePartnerCurrent,
  // Manual Entry Resolvers
  postManualEntry,
  postManualReversal,
} from './finance'

// ── Domain-specific orchestrators not covered by resolvers ────────────────

async function postMonthlyDepreciation(
  db: D1Database,
  opts: { company_id: number; period_year: number; period_month: number; user_id: number },
): Promise<Array<{ asset_id: number; asset_name: string; depreciation_amount: number; entry_id: number | null }>> {
  const { results: assets } = await db.prepare(
    `SELECT id, name, cost, salvage_value, useful_life_months
     FROM fixed_assets
     WHERE company_id = ? AND is_active = 1 AND useful_life_months > 0`
  ).bind(opts.company_id).all<{
    id: number; name: string; cost: number; salvage_value: number | null; useful_life_months: number
  }>()

  if (!assets.length) return []

  const depExpAcc   = await resolveControlAccount(db, opts.company_id, 'depreciation_expense') ?? '5503'
  const accumDepAcc = await resolveControlAccount(db, opts.company_id, 'accumulated_depreciation') ?? '2203'
  const month       = String(opts.period_month).padStart(2, '0')
  const entryDate   = `${opts.period_year}-${month}-28`

  const out: Array<{ asset_id: number; asset_name: string; depreciation_amount: number; entry_id: number | null }> = []

  for (const asset of assets) {
    const depAmount = Math.round(((asset.cost - (asset.salvage_value ?? 0)) / asset.useful_life_months) * 100) / 100
    if (depAmount <= 0) continue

    const entryId = await postFromBusinessEvent(db, {
      company_id:    opts.company_id,
      event_type:    'depreciation',
      source_module: 'assets',
      source_id:     asset.id,
      event_date:    entryDate,
      description:   `إهلاك شهري: ${asset.name} — ${opts.period_year}/${opts.period_month}`,
      created_by:    opts.user_id,
      payload:       { asset_id: asset.id, period_year: opts.period_year, period_month: opts.period_month, amount: depAmount },
      lines: [
        { account_code: depExpAcc,   debit: depAmount, credit: 0,          description: `إهلاك: ${asset.name}`,           rule_slot: 'expense',                  source_ledger: 'manual' as const, source_record_id: asset.id },
        { account_code: accumDepAcc, debit: 0,         credit: depAmount,  description: `إهلاك متراكم: ${asset.name}`,   rule_slot: 'accumulated_depreciation', source_ledger: 'manual' as const, source_record_id: asset.id },
      ],
    })
    out.push({ asset_id: asset.id, asset_name: asset.name, depreciation_amount: depAmount, entry_id: entryId })
  }
  return out
}

async function carryForwardWIP(
  db: D1Database,
  opts: { company_id: number; season_id: number; user_id: number },
): Promise<Array<{ field_id: number; crop_name: string; cost_balance: number }>> {
  // Find fields in this season that have work_order costs but no completed harvest.
  // These are genuinely in-progress crops (sugarcane, perennial orchards).
  const { results: unharvestedFields } = await db.prepare(
    `SELECT
       f.id           AS field_id,
       f.name         AS field_name,
       COALESCE(f.crop_name, s.crop_type, 'محصول غير محدد') AS crop_name,
       f.center_code
     FROM fields f
     JOIN seasons s ON s.id = ?
     LEFT JOIN harvest_records hr ON hr.field_id = f.id AND hr.season_id = ? AND hr.status != 'cancelled'
     WHERE f.company_id = ?
       AND s.company_id = ?
       AND hr.id IS NULL
       AND EXISTS (
         SELECT 1 FROM work_orders wo
         WHERE wo.field_id = f.id AND wo.season_id = ? AND wo.company_id = ?
           AND wo.status NOT IN ('cancelled')
       )`
  ).bind(
    opts.season_id, opts.season_id,
    opts.company_id, opts.company_id,
    opts.season_id, opts.company_id
  ).all<{ field_id: number; field_name: string; crop_name: string; center_code: number | null }>()

  if (!unharvestedFields.length) return []

  const wipAcc    = await resolveControlAccount(db, opts.company_id, 'wip_asset')  ?? '1302'
  const contraAcc = await resolveControlAccount(db, opts.company_id, 'wip_contra') ?? '3001'

  const out: Array<{ field_id: number; crop_name: string; cost_balance: number }> = []

  for (const field of unharvestedFields) {
    // Sum all costs attributable to this field in this season:
    // work_tasks (labour + materials via work orders) + cash_transactions with field_id
    const [tasksRow, cashRow] = await Promise.all([
      db.prepare(
        `SELECT COALESCE(SUM(wt.quantity * wt.unit_cost), 0) AS total
         FROM work_tasks wt
         JOIN work_orders wo ON wo.id = wt.work_order_id
         WHERE wo.company_id = ? AND wo.field_id = ? AND wo.season_id = ?`
      ).bind(opts.company_id, field.field_id, opts.season_id).first<{ total: number }>(),

      db.prepare(
        `SELECT COALESCE(SUM(ABS(amount)), 0) AS total
         FROM cash_transactions
         WHERE company_id = ? AND field_id = ? AND season_id = ?
           AND type IN ('expense', 'withdrawal')`
      ).bind(opts.company_id, field.field_id, opts.season_id).first<{ total: number }>(),
    ])

    const costBalance = (tasksRow?.total ?? 0) + (cashRow?.total ?? 0)
    if (costBalance <= 0) continue

    // Check for duplicate (idempotent on re-run)
    const existing = await db.prepare(
      `SELECT id FROM wip_balances WHERE company_id = ? AND from_season_id = ? AND field_id = ? AND status = 'pending'`
    ).bind(opts.company_id, opts.season_id, field.field_id).first<{ id: number }>()

    if (existing) {
      out.push({ field_id: field.field_id, crop_name: field.crop_name, cost_balance: costBalance })
      continue
    }

    // Post GL: DR WIP Asset / CR WIP Contra
    const entryId = await postFromBusinessEvent(db, {
      company_id:    opts.company_id,
      event_type:    'wip_carryforward',
      source_module: 'operations',
      source_id:     field.field_id,
      event_date:    new Date().toISOString().slice(0, 10),
      description:   `ترحيل أعمال تحت التنفيذ: ${field.field_name} — ${field.crop_name}`,
      created_by:    opts.user_id,
      payload:       { season_id: opts.season_id, field_id: field.field_id, cost_balance: costBalance },
      lines: [
        { account_code: wipAcc,    debit: costBalance, credit: 0,            description: `أعمال تحت التنفيذ — ${field.field_name}`, rule_slot: 'wip_asset',   source_ledger: 'manual' as const, source_record_id: field.field_id, center_code: field.center_code ?? undefined },
        { account_code: contraAcc, debit: 0,           credit: costBalance,  description: `مقابل أعمال تحت التنفيذ — ${field.field_name}`, rule_slot: 'wip_contra', source_ledger: 'manual' as const, source_record_id: field.field_id },
      ],
    })

    await db.prepare(
      `INSERT INTO wip_balances
         (company_id, from_season_id, field_id, crop_name, cost_balance, journal_entry_id, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).bind(opts.company_id, opts.season_id, field.field_id, field.crop_name, costBalance, entryId, opts.user_id).run()

    out.push({ field_id: field.field_id, crop_name: field.crop_name, cost_balance: costBalance })
  }

  return out
}

async function postHarvestLedger(
  db: D1Database,
  opts: {
    company_id: number
    userId: number
    harvest_id: number
    harvest_date: string
    crop_name: string
    field_name: string
    center_code: number | null
    total_revenue: number
    total_actual_cost: number
    season_id: number | null
    field_id: number
  },
): Promise<void> {
  if (opts.total_revenue <= 0 && opts.total_actual_cost <= 0) return

  // Void any prior GL entries for this harvest_id before re-posting (idempotent on edit)
  await db.prepare(
    `DELETE FROM journal_entries
     WHERE company_id = ? AND ref_type IN ('harvest_cost','harvest_revenue') AND ref_id = ?`
  ).bind(opts.company_id, opts.harvest_id).run()

  const revenueAcc   = await resolveControlAccount(db, opts.company_id, 'revenue_crops')
                    ?? await resolveControlAccount(db, opts.company_id, 'revenue_default')
                    ?? '4100'
  const cosAcc       = await resolveControlAccount(db, opts.company_id, 'cost_of_goods')
                    ?? await resolveControlAccount(db, opts.company_id, 'expense_default')
                    ?? '5100'
  const inventoryAcc = await resolveControlAccount(db, opts.company_id, 'inventory') ?? '1300'
  const arAcc        = await resolveControlAccount(db, opts.company_id, 'accounts_receivable') ?? '1200'
  const desc         = `حصاد: ${opts.crop_name} — ${opts.field_name}`
  const payload      = { harvest_id: opts.harvest_id, crop_name: opts.crop_name, field_id: opts.field_id, season_id: opts.season_id, center_code: opts.center_code }

  if (opts.total_actual_cost > 0) {
    await postFromBusinessEvent(db, {
      company_id:    opts.company_id,
      event_type:    'harvest_cost',
      source_module: 'fields',
      source_id:     opts.harvest_id,
      event_date:    opts.harvest_date,
      description:   `${desc} (تكلفة)`,
      created_by:    opts.userId,
      payload,
      lines: [
        { account_code: cosAcc,       debit: opts.total_actual_cost, credit: 0,                      description: `تكلفة الحصاد: ${opts.crop_name}`, rule_slot: 'cogs',      source_ledger: 'harvest' as const, source_record_id: opts.harvest_id },
        { account_code: inventoryAcc, debit: 0,                      credit: opts.total_actual_cost, description: `مخزون الحصاد: ${opts.crop_name}`, rule_slot: 'inventory', source_ledger: 'harvest' as const, source_record_id: opts.harvest_id },
      ],
    })
  }
  if (opts.total_revenue > 0) {
    await postFromBusinessEvent(db, {
      company_id:    opts.company_id,
      event_type:    'harvest_revenue',
      source_module: 'fields',
      source_id:     opts.harvest_id,
      event_date:    opts.harvest_date,
      description:   `${desc} (إيراد)`,
      created_by:    opts.userId,
      payload,
      lines: [
        { account_code: arAcc,      debit: opts.total_revenue, credit: 0,                   description: `إيراد الحصاد: ${opts.crop_name}`, rule_slot: 'receivable', source_ledger: 'harvest' as const, source_record_id: opts.harvest_id },
        { account_code: revenueAcc, debit: 0,                  credit: opts.total_revenue,  description: `إيراد: ${opts.crop_name}`,         rule_slot: 'revenue',    source_ledger: 'harvest' as const, source_record_id: opts.harvest_id },
      ],
    })
  }
}

// Re-export types
export type { EventBackedPostOpts } from './finance/business_events'

/**
 * FinanceCore - The main facade for all finance operations
 * All functions are delegated to their respective modules
 */
export const FinanceCore = {
  // Cash Operations
  prepareCashMovement,
  commitCashDrafts,
  postCashMovement,

  // Backward compatibility alias
  recordCashMovement: prepareCashMovement,

  // Inventory Resolvers
  resolveInventoryMovement,
  resolveInventoryTransfer,
  resolvePurchaseReceipt,
  // Full PO receipt orchestrator (creates inventory movements + GL)
  processPOReceipt: processPOReceiptOrchestrated,

  // Domain orchestrators
  postMonthlyDepreciation,
  carryForwardWIP,
  postHarvestLedger,

  // Supplier Resolvers
  resolveSupplierInvoice,
  resolveSupplierPayment,

  // Cash & Revenue Resolvers
  resolveCashLedger,
  resolveExpensePosting,
  resolveSalesRevenue,

  // Payroll Resolvers
  resolvePayrollPosting,
  resolvePayrollPayment,

  // Operations Resolvers
  resolveWorkOrderLabor,
  resolveContractAdvance,

  // Partner Resolvers
  resolvePartnerCapital,
  resolvePartnerCurrent,

  // Manual Entry Resolvers
  postManualEntry,
  postManualReversal,
} as const

// Also export individual functions for direct import
export {
  postFromBusinessEvent,
  syncSourceDocumentBridge,
  prepareCashMovement,
  commitCashDrafts,
  resolveInventoryMovement,
  resolveInventoryTransfer,
  resolvePurchaseReceipt,
  resolveSupplierInvoice,
  resolveSupplierPayment,
  resolveCashLedger,
  resolveExpensePosting,
  resolveSalesRevenue,
  resolvePayrollPosting,
  resolvePayrollPayment,
  resolveWorkOrderLabor,
  resolveContractAdvance,
  resolvePartnerCapital,
  resolvePartnerCurrent,
  postManualEntry,
  postManualReversal,
}
