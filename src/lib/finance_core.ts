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
): Promise<Array<{ asset_id: number; asset_name: string; depreciation_amount: number; entry_id: number | null; wip_allocations: number }>> {
  const { results: assets } = await db.prepare(
    `SELECT id, name, cost, salvage_value, useful_life_months,
            field_id, center_code, season_id,
            crop_cycle_id, allocation_method, depreciation_allocation_method
     FROM fixed_assets
     WHERE company_id = ? AND is_active = 1 AND useful_life_months > 0`
  ).bind(opts.company_id).all<{
    id: number; name: string; cost: number; salvage_value: number | null; useful_life_months: number
    field_id: number | null; center_code: number | null; season_id: number | null
    crop_cycle_id: number | null
    allocation_method: string | null
    depreciation_allocation_method: string | null
  }>()

  if (!assets.length) return []

  const depExpAcc   = await requireControlAccount(db, opts.company_id, ['depreciation_expense'], 'Monthly depreciation debit account')
  const accumDepAcc = await requireControlAccount(db, opts.company_id, ['accumulated_depreciation'], 'Monthly depreciation credit account')
  const month       = String(opts.period_month).padStart(2, '0')
  const entryDate   = `${opts.period_year}-${month}-28`

  const out: Array<{ asset_id: number; asset_name: string; depreciation_amount: number; entry_id: number | null; wip_allocations: number }> = []

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

    // WIP allocation: route depreciation cost to active crop cycles.
    const wipAllocations = await allocateDepreciationToWIP(db, {
      company_id:  opts.company_id,
      asset_id:    asset.id,
      asset_name:  asset.name,
      dep_amount:  depAmount,
      entry_date:  entryDate,
      entry_id:    entryId,
      field_id:    asset.field_id,
      center_code: asset.center_code,
      season_id:   asset.season_id,
      // Asset-level method overrides; falls back to crop_cycle policy then area_ratio
      allocation_method: asset.depreciation_allocation_method ?? asset.allocation_method,
      // Direct single-cycle assignment (simplest path)
      direct_crop_cycle_id: asset.crop_cycle_id,
    })

    out.push({ asset_id: asset.id, asset_name: asset.name, depreciation_amount: depAmount, entry_id: entryId, wip_allocations: wipAllocations })
  }

  return out
}

/**
 * Allocates a depreciation amount to one or more active crop cycles.
 *
 * Allocation hierarchy (reads from DB at runtime — never hardcoded):
 *  1. direct_crop_cycle_id set → entire amount to that cycle (single-cycle path)
 *  2. allocation_method = 'machine_hours' → split by recorded machine hours per cycle
 *     (falls through to area_ratio if machine_hours data is absent)
 *  3. allocation_method = 'area_ratio' → split by area_feddan per active cycle on same field/center
 *  4. No active cycles or no method → skip WIP (operating expense only, GL already posted)
 *
 * Returns the number of wip_ledger rows written.
 */
async function allocateDepreciationToWIP(
  db: D1Database,
  opts: {
    company_id:           number
    asset_id:             number
    asset_name:           string
    dep_amount:           number
    entry_date:           string
    entry_id:             number | null
    field_id:             number | null
    center_code:          number | null
    season_id:            number | null
    allocation_method:    string | null
    direct_crop_cycle_id: number | null
  },
): Promise<number> {
  const { company_id, asset_id, asset_name, dep_amount, entry_date, entry_id } = opts

  // ── Path 1: single-cycle direct assignment ──────────────────────────────────
  if (opts.direct_crop_cycle_id) {
    const cycle = await db.prepare(
      `SELECT id, season_id, depreciation_allocation_method FROM crop_cycles
       WHERE id = ? AND company_id = ? AND status = 'active'`
    ).bind(opts.direct_crop_cycle_id, company_id).first<{ id: number; season_id: number; depreciation_allocation_method: string | null }>()

    if (!cycle) return 0 // cycle no longer active — skip silently

    try {
      await postCostToWIP({
        db, company_id,
        crop_cycle_id:      cycle.id,
        season_id:          cycle.season_id,
        transaction_date:   entry_date,
        cost_category:      'depreciation',
        cost_category_code: 'depreciation',
        debit:              dep_amount,
        description:        `إهلاك: ${asset_name}`,
        source_module:      'assets',
        source_id:          asset_id,
        journal_entry_id:   entry_id,
        allocation_method:  'manual',
        allocation_share:   1,
      })
      return 1
    } catch (err) {
      console.error(`DEP_WIP_ALLOC_FAILED asset=${asset_id} cycle=${cycle.id}:`, (err as Error).message)
      return 0
    }
  }

  // ── Path 2 & 3: multi-cycle allocation by field or center ──────────────────
  if (!opts.field_id && !opts.center_code) return 0

  // Find all active cycles on the same field or center
  const cycleQuery = opts.field_id
    ? `SELECT cc.id, cc.season_id, cc.area_feddan, cc.depreciation_allocation_method,
              COALESCE(cc.area_feddan, 0) AS area_weight
       FROM crop_cycles cc
       WHERE cc.company_id = ? AND cc.field_id = ? AND cc.status = 'active'`
    : `SELECT cc.id, cc.season_id, cc.area_feddan, cc.depreciation_allocation_method,
              COALESCE(cc.area_feddan, 0) AS area_weight
       FROM crop_cycles cc
       JOIN fields f ON f.id = cc.field_id AND f.center_code = ?
       WHERE cc.company_id = ? AND cc.status = 'active'`

  const cycleParams = opts.field_id
    ? [company_id, opts.field_id]
    : [opts.center_code!, company_id]

  const { results: cycles } = await db.prepare(cycleQuery).bind(...cycleParams).all<{
    id: number; season_id: number; area_feddan: number | null
    depreciation_allocation_method: string | null; area_weight: number
  }>()

  if (!cycles.length) return 0

  // Resolve effective allocation method: asset-level → cycle-level → area_ratio fallback
  const resolvedMethod = opts.allocation_method
    ?? cycles[0]?.depreciation_allocation_method
    ?? 'area_ratio'

  // ── machine_hours: try to read logged hours per cycle; fall back to area_ratio ──
  type CycleShare = { id: number; season_id: number; share: number }
  let shares: CycleShare[] = []

  if (resolvedMethod === 'machine_hours') {
    // Sum hours logged in work_orders or wip_ledger allocation_share for this asset
    const { results: hours } = await db.prepare(`
      SELECT wl.crop_cycle_id AS id, SUM(wl.allocation_share) AS total_hours
      FROM wip_ledger wl
      WHERE wl.company_id = ? AND wl.source_id = ? AND wl.source_module = 'assets'
        AND wl.allocation_method = 'machine_hours'
        AND wl.crop_cycle_id IN (${cycles.map(() => '?').join(',')})
      GROUP BY wl.crop_cycle_id
    `).bind(company_id, asset_id, ...cycles.map(c => c.id)).all<{ id: number; total_hours: number }>()

    const hourMap = Object.fromEntries(hours.map(h => [h.id, h.total_hours]))
    const totalHours = Object.values(hourMap).reduce((s, h) => s + h, 0)

    if (totalHours > 0) {
      shares = cycles
        .filter(c => (hourMap[c.id] ?? 0) > 0)
        .map(c => ({ id: c.id, season_id: c.season_id, share: hourMap[c.id] / totalHours }))
    }
    // machine_hours data absent — fall through to area_ratio
  }

  if (!shares.length) {
    // area_ratio (default fallback)
    const totalArea = cycles.reduce((s, c) => s + (c.area_feddan ?? 1), 0)
    if (totalArea <= 0) return 0
    shares = cycles.map(c => ({
      id:        c.id,
      season_id: c.season_id,
      share:     (c.area_feddan ?? 1) / totalArea,
    }))
  }

  // Post to each cycle proportionally; round last entry to avoid float drift
  let posted = 0
  let remaining = dep_amount

  for (let i = 0; i < shares.length; i++) {
    const s = shares[i]
    const isLast = i === shares.length - 1
    const portion = isLast
      ? Math.round(remaining * 100) / 100
      : Math.round(dep_amount * s.share * 100) / 100
    remaining = Math.round((remaining - portion) * 100) / 100

    if (portion <= 0) continue

    try {
      await postCostToWIP({
        db, company_id,
        crop_cycle_id:      s.id,
        season_id:          s.season_id,
        transaction_date:   entry_date,
        cost_category:      'depreciation',
        cost_category_code: 'depreciation',
        debit:              portion,
        description:        `إهلاك (${Math.round(s.share * 100)}%): ${asset_name}`,
        source_module:      'assets',
        source_id:          asset_id,
        journal_entry_id:   entry_id,
        allocation_method:  resolvedMethod === 'machine_hours' ? 'machine_hours' : 'acreage',
        allocation_share:   Math.round(s.share * 10000) / 10000,
      })
      posted++
    } catch (err) {
      console.error(`DEP_WIP_ALLOC_FAILED asset=${asset_id} cycle=${s.id}:`, (err as Error).message)
    }
  }

  return posted
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

  const inventoryAcc   = await requireControlAccount(db, company_id, ['inventory'],                                    'Settlement inventory account')
  const cogsAcc        = await requireControlAccount(db, company_id, ['agricultural_cogs', 'harvest_cogs', 'cogs'],    'Settlement COGS account')
  const revenueAcc     = await requireControlAccount(db, company_id, ['harvest_revenue', 'revenue_default'],           'Settlement revenue account')
  const cashAcc        = await requireControlAccount(db, company_id, ['cash', 'accounts_receivable', 'cash_default'],  'Settlement cash/AR account for direct sale')

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
          { account_code: cashAcc,    debit: revenue, credit: 0,       description: `حصيلة بيع: ${cycleDesc}`, rule_slot: 'cash',            source_ledger: 'harvest' as const, source_record_id: settlement_id, ...dims },
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
 * postCycleWriteOff — writes off the WIP balance of a written-off crop cycle.
 *
 * Written-off differs from abandonment: this is a formal accounting write-off
 * (e.g. crop destroyed, unrecoverable loss) that posts to account 61060003
 * (خسارة محاصيل — شطب) via the 'agricultural_loss_writeoff' control key.
 *
 * After posting, marks crop_cycle status = 'written_off' and appends a WIP credit row.
 */
async function postCycleWriteOff(
  db: D1Database,
  opts: {
    company_id:    number
    user_id:       number
    crop_cycle_id: number
    writeoff_date: string
    notes?: string
  },
): Promise<{ gl_entry_id: number | null; wip_written_off: number }> {
  const { company_id, user_id, crop_cycle_id, writeoff_date } = opts

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
    season_id: number; wip_balance: number; status: string
  }>()

  if (!cycle) throw new Error(`WRITEOFF: crop_cycle_id=${crop_cycle_id} not found`)
  if (cycle.status === 'written_off' || cycle.status === 'harvested' || cycle.status === 'abandoned') {
    throw new Error(`WRITEOFF: cycle ${crop_cycle_id} already in terminal status '${cycle.status}'`)
  }

  const wipBalance  = Math.round(cycle.wip_balance * 100) / 100
  const lossAccount = await requireControlAccount(db, company_id, ['agricultural_loss_writeoff', 'agricultural_loss'], 'Write-off loss account')
  const wipAcc      = await requireControlAccount(db, company_id, ['wip_asset'], 'WIP asset account for write-off')
  const cycleDesc   = `${cycle.crop_name}${cycle.field_name ? ' — ' + cycle.field_name : ''}`

  let glEntryId: number | null = null

  if (wipBalance > 0) {
    glEntryId = await postFromBusinessEvent(db, {
      company_id,
      event_type:    'crop_cycle_writeoff',
      source_module: 'operations',
      source_id:     crop_cycle_id,
      event_date:    writeoff_date,
      description:   `شطب دورة محصول: ${cycleDesc}`,
      created_by:    user_id,
      payload:       { crop_cycle_id, wip_balance: wipBalance, notes: opts.notes },
      lines: [
        { account_code: lossAccount, debit: wipBalance, credit: 0,         description: `خسارة شطب: ${cycleDesc}`,  source_ledger: 'manual' as const, source_record_id: crop_cycle_id, center_code: cycle.center_code ?? undefined, season_id: cycle.season_id },
        { account_code: wipAcc,      debit: 0,          credit: wipBalance, description: `إقفال WIP: ${cycleDesc}`, rule_slot: 'wip_asset',           source_ledger: 'manual' as const, source_record_id: crop_cycle_id, center_code: cycle.center_code ?? undefined, season_id: cycle.season_id },
      ],
    })

    await creditCostFromWIP({
      db, company_id,
      crop_cycle_id, season_id: cycle.season_id,
      transaction_date: writeoff_date,
      cost_category: 'other',
      cost_category_code: 'OTHER',
      amount: wipBalance,
      description: `شطب دورة محصول — ${cycleDesc}`,
      source_module: 'operations', source_id: crop_cycle_id,
      journal_entry_id: glEntryId,
    })
  }

  await db.prepare(
    `UPDATE crop_cycles SET status = 'written_off', updated_at = datetime('now') WHERE id = ? AND company_id = ?`
  ).bind(crop_cycle_id, company_id).run()

  return { gl_entry_id: glEntryId, wip_written_off: wipBalance }
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
  const lossAccount = await requireControlAccount(
    db, company_id,
    cycle.abandonment_policy === 'extraordinary_loss'
      ? ['agricultural_loss_extraordinary', 'agricultural_loss_abandonment', 'agricultural_loss']
      : ['agricultural_loss_operating',     'agricultural_loss_abandonment', 'agricultural_loss'],
    'Abandonment loss account',
  )
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
  postCycleWriteOff,
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
  postCycleWriteOff,
}
