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

// Import WIP engine
import { postCostToWIP, creditCostFromWIP } from './wip_engine'
export type { WIPCostCategory, PostCostToWIPOpts, WIPPostResult } from './wip_engine'

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

/**
 * carryForwardCropCycleWIP — cycle-aware carry-forward for long-cycle crops.
 *
 * Reads wip_ledger.running_balance per active crop_cycle_id and posts a
 * season-close/open pair in the GL for each cycle with a positive balance.
 * Does NOT touch cycles in 'harvested', 'abandoned', or 'written_off' status.
 *
 * Replaces carryForwardWIP (field-aggregate, deprecated) for new crop cycles.
 */
async function carryForwardCropCycleWIP(
  db: D1Database,
  opts: { company_id: number; from_season_id: number; to_season_id: number; user_id: number },
): Promise<Array<{ crop_cycle_id: number; crop_name: string; wip_balance: number; entry_id: number | null }>> {
  const { company_id, from_season_id, to_season_id, user_id } = opts

  const { results: cycles } = await db.prepare(`
    SELECT cc.id AS crop_cycle_id, cc.crop_name, cc.center_code, cc.field_id,
           COALESCE(
             (SELECT running_balance FROM wip_ledger
              WHERE company_id = cc.company_id AND crop_cycle_id = cc.id
              ORDER BY id DESC LIMIT 1),
             0
           ) AS wip_balance
    FROM crop_cycles cc
    WHERE cc.company_id = ? AND cc.season_id = ? AND cc.status = 'active'
  `).bind(company_id, from_season_id).all<{
    crop_cycle_id: number; crop_name: string; center_code: number | null
    field_id: number | null; wip_balance: number
  }>()

  const wipAcc = await requireControlAccount(db, company_id, ['wip_asset'], 'WIP asset account for carry-forward')
  const today  = getTodayIsoDate()
  const out: Array<{ crop_cycle_id: number; crop_name: string; wip_balance: number; entry_id: number | null }> = []

  for (const cycle of cycles) {
    const balance = Math.round(cycle.wip_balance * 100) / 100
    if (balance <= 0) continue

    const entryId = await postFromBusinessEvent(db, {
      company_id,
      event_type:    'wip_carry_forward_cycle',
      source_module: 'operations',
      source_id:     cycle.crop_cycle_id,
      event_date:    today,
      description:   `ترحيل WIP: ${cycle.crop_name} (موسم ${from_season_id} → ${to_season_id})`,
      created_by:    user_id,
      payload:       { crop_cycle_id: cycle.crop_cycle_id, from_season: from_season_id, to_season: to_season_id, balance },
      lines: [
        { account_code: wipAcc, debit: 0,       credit: balance, description: `إقفال WIP موسم ${from_season_id}: ${cycle.crop_name}`, rule_slot: 'wip_asset', source_ledger: 'manual' as const, source_record_id: cycle.crop_cycle_id, center_code: cycle.center_code ?? undefined, season_id: from_season_id, field_id: cycle.field_id ?? undefined },
        { account_code: wipAcc, debit: balance, credit: 0,       description: `فتح WIP موسم ${to_season_id}: ${cycle.crop_name}`,   rule_slot: 'wip_asset', source_ledger: 'manual' as const, source_record_id: cycle.crop_cycle_id, center_code: cycle.center_code ?? undefined, season_id: to_season_id,   field_id: cycle.field_id ?? undefined },
      ],
    })

    // Append carry-forward marker to wip_ledger (zero-net: debit + credit = balance)
    await postCostToWIP({
      db, company_id,
      crop_cycle_id:    cycle.crop_cycle_id,
      season_id:        to_season_id,
      transaction_date: today,
      cost_category:    'other',
      cost_category_code: 'OTHER',
      debit:            balance,
      credit:           balance,
      description:      `ترحيل إلى موسم ${to_season_id}`,
      source_module:    'operations',
      source_id:        cycle.crop_cycle_id,
      journal_entry_id: entryId,
    })

    out.push({ crop_cycle_id: cycle.crop_cycle_id, crop_name: cycle.crop_name, wip_balance: balance, entry_id: entryId })
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

/**
 * postHarvestSettlement — converts WIP into inventory or COGS at harvest time.
 *
 * Disposition rules (binding architectural decision):
 *  - 'stored'  → DR Inventory / CR Agricultural COGS   (cost moves to inventory asset)
 *  - 'sold'    → DR Agricultural COGS / CR Revenue      (cost recognized, revenue booked)
 *
 * WIP zeroing: after the GL entry posts, a credit row is appended to wip_ledger
 * to bring the running_balance to zero. This is the source-of-truth settlement.
 *
 * The harvest_settlements record must already exist in 'draft' status.
 * This function posts it and flips it to 'posted'.
 */
async function postHarvestSettlement(
  db: D1Database,
  opts: {
    company_id:        number
    user_id:           number
    settlement_id:     number
    crop_cycle_id:     number
    season_id:         number
    settlement_date:   string
    disposition:       'stored' | 'sold'
    // settlement_mode drives GL routing:
    //   'inventory'   → DR Inventory / CR WIP  (cost moves to inventory asset)
    //   'direct_sale' → DR COGS / CR WIP        (cost recognized without inventory step)
    // Defaults to 'inventory' for backwards compatibility with pre-Phase-3 settlements.
    settlement_mode?:  'inventory' | 'direct_sale'
    total_wip_cost:    number
    // stored only
    inventory_value?:  number
    warehouse_id?:     number
    item_code?:        number
    // sold only
    revenue?:          number
    buyer_name?:       string
    qty_tons?:         number
    notes?:            string
  },
): Promise<{
  wip_gl_entry_id:       number | null
  inventory_gl_entry_id: number | null
  cogs_gl_entry_id:      number | null
  revenue_gl_entry_id:   number | null
}> {
  const { company_id, user_id, settlement_id, crop_cycle_id, season_id, settlement_date } = opts
  // Resolve settlement_mode: default to 'inventory' for backwards compatibility.
  const settlementMode = opts.settlement_mode ?? 'inventory'

  const inventoryAcc   = await requireControlAccount(db, company_id, ['inventory'],         'Settlement inventory account')
  const cogsAcc        = await requireControlAccount(db, company_id, ['agricultural_cogs', 'harvest_cogs', 'cogs'], 'Settlement COGS account')
  const revenueAcc     = await requireControlAccount(db, company_id, ['harvest_revenue', 'revenue_default'], 'Settlement revenue account')

  const wipCost    = Math.round(opts.total_wip_cost * 100) / 100
  const invValue   = Math.round((opts.inventory_value ?? wipCost) * 100) / 100
  const revenue    = Math.round((opts.revenue ?? 0) * 100) / 100
  const cropCycle  = await db.prepare('SELECT crop_name, field_id, center_code FROM crop_cycles WHERE id = ? AND company_id = ?')
    .bind(crop_cycle_id, company_id).first<{ crop_name: string; field_id: number | null; center_code: number | null }>()
  const cycleDesc  = cropCycle?.crop_name ?? `دورة #${crop_cycle_id}`

  let wipGlEntryId:       number | null = null
  let inventoryGlEntryId: number | null = null
  let cogsGlEntryId:      number | null = null
  let revenueGlEntryId:   number | null = null

  const dims = {
    center_code: cropCycle?.center_code ?? undefined,
    season_id,
    field_id: cropCycle?.field_id ?? undefined,
  }

  if (settlementMode === 'inventory') {
    // DR Inventory / CR Agricultural COGS — WIP cost transfers to inventory asset.
    inventoryGlEntryId = await postFromBusinessEvent(db, {
      company_id, event_type: 'harvest_settlement_stored',
      source_module: 'harvest', source_id: settlement_id,
      event_date: settlement_date,
      description: `تسوية حصاد (مخزون): ${cycleDesc}`,
      created_by: user_id,
      payload: { settlement_id, crop_cycle_id, settlement_mode: settlementMode, wip_cost: wipCost, inventory_value: invValue },
      lines: [
        { account_code: inventoryAcc, debit: invValue,  credit: 0,        description: `إضافة مخزون: ${cycleDesc}`, rule_slot: 'inventory',         source_ledger: 'harvest' as const, source_record_id: settlement_id, ...dims },
        { account_code: cogsAcc,      debit: 0,         credit: invValue,  description: `إقفال WIP ← مخزون: ${cycleDesc}`,  rule_slot: 'agricultural_cogs', source_ledger: 'harvest' as const, source_record_id: settlement_id, ...dims },
      ],
    })
    // Variance entry if inventory_value ≠ wip_cost
    const variance = Math.round((wipCost - invValue) * 100) / 100
    if (Math.abs(variance) > 0.01) {
      cogsGlEntryId = await postFromBusinessEvent(db, {
        company_id, event_type: 'harvest_settlement_variance',
        source_module: 'harvest', source_id: settlement_id,
        event_date: settlement_date,
        description: `فارق تقييم حصاد: ${cycleDesc}`,
        created_by: user_id,
        payload: { settlement_id, variance },
        lines: [
          { account_code: cogsAcc, debit: variance > 0 ? variance : 0, credit: variance < 0 ? Math.abs(variance) : 0, description: `فارق WIP ← مخزون`, rule_slot: 'agricultural_cogs', source_ledger: 'harvest' as const, source_record_id: settlement_id, ...dims },
        ],
      })
    }
  } else {
    // settlement_mode === 'direct_sale'
    // DR Agricultural COGS / CR WIP — cost recognized directly without inventory step.
    cogsGlEntryId = await postFromBusinessEvent(db, {
      company_id, event_type: 'harvest_settlement_direct_sale_cogs',
      source_module: 'harvest', source_id: settlement_id,
      event_date: settlement_date,
      description: `تسوية حصاد (بيع مباشر — تكلفة): ${cycleDesc}`,
      created_by: user_id,
      payload: { settlement_id, crop_cycle_id, settlement_mode: settlementMode, wip_cost: wipCost },
      lines: [
        { account_code: cogsAcc,      debit: wipCost, credit: 0,        description: `تكلفة بضاعة مباعة: ${cycleDesc}`,     rule_slot: 'agricultural_cogs', source_ledger: 'harvest' as const, source_record_id: settlement_id, ...dims },
        { account_code: inventoryAcc, debit: 0,       credit: wipCost,  description: `إقفال WIP ← بيع مباشر: ${cycleDesc}`, rule_slot: 'inventory',         source_ledger: 'harvest' as const, source_record_id: settlement_id, ...dims },
      ],
    })
    if (revenue > 0) {
      revenueGlEntryId = await postFromBusinessEvent(db, {
        company_id, event_type: 'harvest_settlement_direct_sale_revenue',
        source_module: 'harvest', source_id: settlement_id,
        event_date: settlement_date,
        description: `تسوية حصاد (بيع مباشر — إيراد): ${cycleDesc}${opts.buyer_name ? ' — ' + opts.buyer_name : ''}`,
        created_by: user_id,
        payload: { settlement_id, revenue, buyer: opts.buyer_name },
        lines: [
          { account_code: '14010101', debit: revenue, credit: 0,       description: `حصيلة بيع: ${cycleDesc}`, rule_slot: 'cash',            source_ledger: 'harvest' as const, source_record_id: settlement_id, ...dims },
          { account_code: revenueAcc, debit: 0,       credit: revenue,  description: `إيراد مبيعات محاصيل`,     rule_slot: 'harvest_revenue', source_ledger: 'harvest' as const, source_record_id: settlement_id, ...dims },
        ],
      })
    }
  }

  // Zero out WIP ledger with a credit row
  const { wip_ledger_id: wipLedgerId } = await creditCostFromWIP({
    db, company_id,
    crop_cycle_id, season_id,
    transaction_date: settlement_date,
    cost_category: 'other',
    amount: wipCost,
    description: `تسوية نهائية — ${opts.disposition === 'stored' ? 'نقل إلى مخزون' : 'بيع مباشر'}`,
    source_module: 'harvest', source_id: settlement_id,
    journal_entry_id: inventoryGlEntryId ?? cogsGlEntryId,
  })
  wipGlEntryId = inventoryGlEntryId ?? cogsGlEntryId

  // Update crop cycle status to 'harvested' and patch settlement to 'posted'
  await db.batch([
    db.prepare(
      `UPDATE harvest_settlements
       SET status = 'posted',
           wip_gl_entry_id = ?, inventory_gl_entry_id = ?,
           cogs_gl_entry_id = ?, revenue_gl_entry_id = ?,
           cost_per_ton = CASE WHEN qty_tons > 0 THEN ? / qty_tons ELSE NULL END,
           updated_at = datetime('now')
       WHERE id = ? AND company_id = ?`
    ).bind(
      wipGlEntryId, inventoryGlEntryId ?? null,
      cogsGlEntryId ?? null, revenueGlEntryId ?? null,
      wipCost, settlement_id, company_id,
    ),
    db.prepare(
      `UPDATE crop_cycles SET status = 'harvested', actual_harvest_date = ?, updated_at = datetime('now')
       WHERE id = ? AND company_id = ?`
    ).bind(settlement_date, crop_cycle_id, company_id),
  ])

  void wipLedgerId // used for side effect; referenced for bookkeeping

  return { wip_gl_entry_id: wipGlEntryId, inventory_gl_entry_id: inventoryGlEntryId, cogs_gl_entry_id: cogsGlEntryId, revenue_gl_entry_id: revenueGlEntryId }
}

/**
 * postCycleAbandonment — writes off the WIP balance of an abandoned crop cycle.
 *
 * Reads abandonment_policy from crop_cycles:
 *   'operating_loss'     → DR 61060001 (مصروف هلاك محاصيل — operating)
 *   'extraordinary_loss' → DR 61060002 (خسارة إهلاك محاصيل — extraordinary)
 * Credit: WIP asset account (the accumulated cost is written off).
 *
 * After posting, marks crop_cycle status = 'abandoned' and appends a WIP credit row.
 */
async function postCycleAbandonment(
  db: D1Database,
  opts: {
    company_id:    number
    user_id:       number
    crop_cycle_id: number
    abandonment_date: string
    notes?: string
  },
): Promise<{ gl_entry_id: number | null; wip_written_off: number }> {
  const { company_id, user_id, crop_cycle_id, abandonment_date } = opts

  const cycle = await db.prepare(`
    SELECT cc.*, f.name AS field_name,
           COALESCE(
             (SELECT running_balance FROM wip_ledger
              WHERE company_id = cc.company_id AND crop_cycle_id = cc.id
              ORDER BY id DESC LIMIT 1),
             0
           ) AS wip_balance
    FROM crop_cycles cc
    LEFT JOIN fields f ON f.id = cc.field_id AND f.company_id = cc.company_id
    WHERE cc.id = ? AND cc.company_id = ?
  `).bind(crop_cycle_id, company_id).first<{
    id: number; crop_name: string; field_name: string | null; center_code: number | null
    season_id: number; abandonment_policy: 'operating_loss' | 'extraordinary_loss'
    wip_balance: number; status: string
  }>()

  if (!cycle) throw new Error(`ABANDONMENT: crop_cycle_id=${crop_cycle_id} not found`)
  if (cycle.status === 'abandoned' || cycle.status === 'harvested') {
    throw new Error(`ABANDONMENT: cycle ${crop_cycle_id} already in terminal status '${cycle.status}'`)
  }

  const wipBalance = Math.round(cycle.wip_balance * 100) / 100
  const lossAccount = cycle.abandonment_policy === 'extraordinary_loss' ? '61060002' : '61060001'
  const wipAcc = await requireControlAccount(db, company_id, ['wip_asset'], 'WIP asset account for abandonment')
  const cycleDesc = `${cycle.crop_name}${cycle.field_name ? ' — ' + cycle.field_name : ''}`

  let glEntryId: number | null = null

  if (wipBalance > 0) {
    glEntryId = await postFromBusinessEvent(db, {
      company_id,
      event_type:    'crop_cycle_abandonment',
      source_module: 'operations',
      source_id:     crop_cycle_id,
      event_date:    abandonment_date,
      description:   `إهلاك دورة محصول مهجورة: ${cycleDesc}`,
      created_by:    user_id,
      payload:       { crop_cycle_id, wip_balance: wipBalance, policy: cycle.abandonment_policy, notes: opts.notes },
      lines: [
        { account_code: lossAccount, debit: wipBalance, credit: 0,          description: `خسارة إهلاك: ${cycleDesc}`, source_ledger: 'manual' as const, source_record_id: crop_cycle_id, center_code: cycle.center_code ?? undefined, season_id: cycle.season_id },
        { account_code: wipAcc,      debit: 0,          credit: wipBalance,  description: `إقفال WIP: ${cycleDesc}`,   rule_slot: 'wip_asset',           source_ledger: 'manual' as const, source_record_id: crop_cycle_id, center_code: cycle.center_code ?? undefined, season_id: cycle.season_id },
      ],
    })

    await creditCostFromWIP({
      db, company_id,
      crop_cycle_id, season_id: cycle.season_id,
      transaction_date: abandonment_date,
      cost_category: 'other',
      cost_category_code: 'OTHER',
      amount: wipBalance,
      description: `إهلاك دورة مهجورة — ${cycleDesc}`,
      source_module: 'operations', source_id: crop_cycle_id,
      journal_entry_id: glEntryId,
    })
  }

  await db.prepare(
    `UPDATE crop_cycles SET status = 'abandoned', updated_at = datetime('now') WHERE id = ? AND company_id = ?`
  ).bind(crop_cycle_id, company_id).run()

  return { gl_entry_id: glEntryId, wip_written_off: wipBalance }
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
  postCostToWIP,
  creditCostFromWIP,
  postHarvestSettlement,
  postCycleAbandonment,
  carryForwardCropCycleWIP,
} as const

export {
  postCostToWIP,
  creditCostFromWIP,
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
  postCycleAbandonment,
}
