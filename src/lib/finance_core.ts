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
    `SELECT id, name, cost_value, salvage_value, useful_life_months
     FROM fixed_assets
     WHERE company_id = ? AND status = 'active' AND useful_life_months > 0`
  ).bind(opts.company_id).all<{
    id: number; name: string; cost_value: number; salvage_value: number | null; useful_life_months: number
  }>()

  if (!assets.length) return []

  const depExpAcc   = await resolveControlAccount(db, opts.company_id, 'depreciation_expense') ?? '6200'
  const accumDepAcc = await resolveControlAccount(db, opts.company_id, 'accumulated_depreciation') ?? '1690'
  const month       = String(opts.period_month).padStart(2, '0')
  const entryDate   = `${opts.period_year}-${month}-28`

  const out: Array<{ asset_id: number; asset_name: string; depreciation_amount: number; entry_id: number | null }> = []

  for (const asset of assets) {
    const depAmount = Math.round(((asset.cost_value - (asset.salvage_value ?? 0)) / asset.useful_life_months) * 100) / 100
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
  _db: D1Database,
  _opts: { company_id: number; season_id: number; user_id: number },
): Promise<Array<{ field_id: number; crop_name: string; cost_balance: number }>> {
  // Stub — returns empty when WIP tracking schema is not yet active.
  // Replace with full implementation once wip_balances table is populated.
  return []
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
