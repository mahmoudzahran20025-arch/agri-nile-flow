/**
 * FinanceCore - Facade/Factory Pattern
 * ====================================
 */

import type { D1Database } from '@cloudflare/workers-types'
import { resolveControlAccount } from './posting_engine'
import { getTodayIsoDate } from './utils/date'
import { getOpenPeriod } from './gl'

/**
 * Resolves the conversion factor from one unit to another for a specific item or globally.
 * TON -> KG (1000)
 */
async function resolveUnitFactor(
  db: D1Database,
  companyId: number,
  fromUnit: string,
  toUnit: string,
  itemCode?: number | null,
): Promise<number> {
  const f = (fromUnit || '').trim().toUpperCase()
  const t = (toUnit || '').trim().toUpperCase()
  if (!f || !t || f === t) return 1

  if (itemCode) {
    const itemConv = await db.prepare(
      `SELECT factor FROM unit_conversions 
       WHERE company_id = ? AND item_code = ? AND UPPER(from_unit) = ? AND UPPER(to_unit) = ? AND is_active = 1
       LIMIT 1`
    ).bind(companyId, itemCode, f, t).first<{ factor: number }>()
    if (itemConv) return itemConv.factor

    const itemConvRev = await db.prepare(
      `SELECT factor FROM unit_conversions 
       WHERE company_id = ? AND item_code = ? AND UPPER(from_unit) = ? AND UPPER(to_unit) = ? AND is_active = 1
       LIMIT 1`
    ).bind(companyId, itemCode, t, f).first<{ factor: number }>()
    if (itemConvRev) return 1 / itemConvRev.factor
  }

  const globalConv = await db.prepare(
    `SELECT factor FROM unit_conversions 
     WHERE company_id = ? AND item_code IS NULL AND UPPER(from_unit) = ? AND UPPER(to_unit) = ? AND is_active = 1
     LIMIT 1`
  ).bind(companyId, f, t).first<{ factor: number }>()
  if (globalConv) return globalConv.factor

  const globalConvRev = await db.prepare(
    `SELECT factor FROM unit_conversions 
     WHERE company_id = ? AND item_code IS NULL AND UPPER(from_unit) = ? AND UPPER(to_unit) = ? AND is_active = 1
     LIMIT 1`
  ).bind(companyId, t, f).first<{ factor: number }>()
  if (globalConvRev) return 1 / globalConvRev.factor

  console.warn(`UOM_CONVERSION_MISSING: No factor found for "${fromUnit}" -> "${toUnit}". Falling back to 1:1.`)
  return 1
}

async function requireControlAccount(
  db: D1Database,
  companyId: number,
  keys: string[],
  context: string,
): Promise<string> {
  for (const key of keys) {
    const code = await resolveControlAccount(db, companyId, key)
    if (code) return code
  }
  throw new Error(`COA_CONTROL_UNRESOLVED: ${context}. Missing active mapping for keys [${keys.join(', ')}].`)
}

// Import all modules from the finance directory
import {
  postFromBusinessEvent,
  syncSourceDocumentBridge,
  prepareCashMovement,
  commitCashDrafts,
  postCashMovement,
  resolveInventoryMovement,
  resolveInventoryTransfer,
  resolvePurchaseReceipt,
  processPOReceiptOrchestrated,
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
} from './finance'

async function postMonthlyDepreciation(
  db: D1Database,
  opts: { company_id: number; period_year: number; period_month: number; user_id: number },
): Promise<Array<{ asset_id: number; asset_name: string; depreciation_amount: number; entry_id: number | null }>> {
  const { results: assets } = await db.prepare(
    `SELECT id, name, cost, salvage_value, useful_life_months, field_id, center_code, season_id
     FROM fixed_assets
     WHERE company_id = ? AND is_active = 1 AND useful_life_months > 0`
  ).bind(opts.company_id).all<{
    id: number; name: string; cost: number; salvage_value: number | null; useful_life_months: number
    field_id: number | null; center_code: number | null; season_id: number | null
  }>()

  if (!assets.length) return []

  const depExpAcc   = await requireControlAccount(db, opts.company_id, ['depreciation_expense'], 'Monthly depreciation debit account')
  const accumDepAcc = await requireControlAccount(db, opts.company_id, ['accumulated_depreciation'], 'Monthly depreciation credit account')
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
      payload:       { asset_id: asset.id, amount: depAmount },
      lines: [
        { account_code: depExpAcc,   debit: depAmount, credit: 0,         description: `مصروف إهلاك: ${asset.name}`, center_code: asset.center_code ?? undefined, season_id: asset.season_id ?? undefined },
        { account_code: accumDepAcc, debit: 0,         credit: depAmount, description: `مجمع إهلاك: ${asset.name}`,   center_code: asset.center_code ?? undefined, season_id: asset.season_id ?? undefined },
      ],
    })

    out.push({ asset_id: asset.id, asset_name: asset.name, depreciation_amount: depAmount, entry_id: entryId })
  }

  return out
}

async function carryForwardWIP(
  db: D1Database,
  opts: { company_id: number; season_id: number; to_season_id?: number; user_id: number },
): Promise<Array<{ field_id: number; crop_name: string; cost_balance: number; entry_id: number | null }>> {
  const { results: fields } = await db.prepare(
    `SELECT f.id AS field_id, f.name AS field_name, f.center_code,
            COALESCE(SUM(jl.debit - jl.credit), 0) AS balance
     FROM fields f
     JOIN journal_entry_lines jl ON jl.field_id = f.id
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE f.company_id = ? AND je.season_id = ? AND je.is_posted = 1
     GROUP BY f.id`
  ).bind(opts.company_id, opts.season_id).all<{ field_id: number; field_name: string; center_code: number | null; balance: number }>()

  const wipAcc = await requireControlAccount(db, opts.company_id, ['wip_asset'], 'Work-in-progress asset account')
  const today  = getTodayIsoDate()
  const out: Array<{ field_id: number; crop_name: string; cost_balance: number; entry_id: number | null }> = []

  for (const field of fields) {
    const costBalance = field.balance
    if (costBalance <= 0) continue

    let entryId: number | null = null
    if (opts.to_season_id) {
       entryId = await postFromBusinessEvent(db, {
        company_id:    opts.company_id,
        event_type:    'wip_carry_forward',
        source_module: 'operations',
        source_id:     field.field_id,
        event_date:    today,
        description:   `ترحيل تكاليف WIP: ${field.field_name} (موسم ${opts.season_id} -> ${opts.to_season_id})`,
        created_by:    opts.user_id,
        payload:       { from_season: opts.season_id, to_season: opts.to_season_id, balance: costBalance },
        lines: [
          { account_code: wipAcc, debit: 0,           credit: costBalance, description: `إقفال WIP موسم ${opts.season_id}`,  rule_slot: 'wip_asset',   source_ledger: 'manual' as const, source_record_id: field.field_id, center_code: field.center_code ?? undefined, season_id: opts.season_id },
          { account_code: wipAcc, debit: costBalance, credit: 0,           description: `فتح WIP موسم ${opts.to_season_id}`, rule_slot: 'wip_asset',   source_ledger: 'manual' as const, source_record_id: field.field_id, center_code: field.center_code ?? undefined, season_id: opts.to_season_id },
        ],
      })
    }
    
    out.push({ field_id: field.field_id, crop_name: field.field_name, cost_balance: costBalance, entry_id: entryId })
  }
  return out
}

async function postHarvestLedger(
  db: D1Database,
  opts: { 
    company_id: number; user_id: number;
    harvest_id: number; date: string; 
    amount?: number; // legacy cost param
    description?: string; // legacy desc param
    total_revenue: number; 
    total_actual_cost: number;
    crop_name?: string; field_name?: string; center_code?: number | null;
    season_id?: number | null; field_id?: number | null;
  },
): Promise<number | null> {
  const inventoryAcc = await requireControlAccount(db, opts.company_id, ['inventory'], 'Harvest inventory account')
  const revenueAcc   = await requireControlAccount(db, opts.company_id, ['harvest_revenue', 'revenue_default'], 'Harvest revenue account')

  const desc = opts.description || `إثبات إنتاج محصول: ${opts.crop_name || ''} (${opts.field_name || ''})`

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'harvest_output',
    source_module: 'harvest',
    source_id:     opts.harvest_id,
    source_link_id: opts.harvest_id,
    event_date:    opts.date,
    description:   desc,
    created_by:    opts.user_id,
    payload:       { 
      harvest_id: opts.harvest_id, revenue: opts.total_revenue, cost: opts.total_actual_cost,
      crop: opts.crop_name, field: opts.field_name, center: opts.center_code,
      season: opts.season_id, field_id: opts.field_id
    },
    lines: [
      { account_code: inventoryAcc, debit: opts.total_revenue, credit: 0,           description: `إثبات مخزون إنتاج`, rule_slot: 'inventory',   source_ledger: 'harvest' as const, source_record_id: opts.harvest_id, center_code: opts.center_code ?? undefined, season_id: opts.season_id ?? undefined, field_id: opts.field_id ?? undefined },
      { account_code: revenueAcc,   debit: 0,                  credit: opts.total_revenue, description: `إيراد إنتاج محاصيل`, rule_slot: 'revenue_default', source_ledger: 'harvest' as const, source_record_id: opts.harvest_id, center_code: opts.center_code ?? undefined, season_id: opts.season_id ?? undefined, field_id: opts.field_id ?? undefined },
    ],
  })
}

export const FinanceCore = {
  resolveUnitFactor,
  prepareCashMovement,
  commitCashDrafts,
  postCashMovement,
  resolveInventoryMovement,
  resolveInventoryTransfer,
  resolvePurchaseReceipt,
  processPOReceipt: processPOReceiptOrchestrated,
  postMonthlyDepreciation,
  carryForwardWIP,
  postHarvestLedger,
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
  getOpenPeriod,
} as const

export {
  resolveUnitFactor,
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
  getOpenPeriod,
}
