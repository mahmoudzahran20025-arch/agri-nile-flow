/**
 * posting_engine.ts — Zero-Data-Safe Posting Groups Engine
 * =========================================================
 * Microsoft Dynamics–style account resolution for Agri-Nile Flow ERP.
 *
 * Design goals:
 *  - Works with ZERO initial setup (returns descriptive errors, never throws)
 *  - Separates warnings (advisory) from errors (blocking)
 *  - Validates all resolved account codes against chart_of_accounts
 *  - Deterministic cascade: exact -> wildcard -> default
 *  - Full resolution trace: every line tagged with rule_slot + step used
 */

import type { D1Database } from '@cloudflare/workers-types'

// ── Public Types ──────────────────────────────────────────────────────────────

export interface JournalLine {
  account_code: string
  debit:        number
  credit:       number
  description?: string
  center_code?: number
  season_id?:   number
  field_id?:    number
  rule_slot?:   string   // which posting slot this line came from
}

export interface RuleTrace {
  rule_type:          string
  input_bpg:          string | null
  input_ppg:          string | null
  input_ipg:          string | null
  resolution_step:    number         // 1-8 (which cascade level matched)
  matched_rule_id:    number | null  // posting_rules.id that resolved
  resolved_accounts:  Record<string, string>  // slot → account_code
  resolved_at:        string
}

export interface JournalBlueprint {
  lines:            JournalLine[]
  validationErrors: string[]
  warnings:         string[]
  isBlocked:        boolean
  trace:            RuleTrace | null  // null if blocked before resolution
}

// ── Internal Types ────────────────────────────────────────────────────────────

interface GeneralPostingRuleRow {
  id:                      number
  bus_posting_group_code:  string | null
  prod_posting_group_code: string | null
  sales_account:           string | null
  purchases_account:       string | null
  cogs_account:            string | null
  sales_returns_account:   string | null
  purch_returns_account:   string | null
  expense_account:         string | null
}

interface InventoryPostingRuleRow {
  id:                      number
  inv_posting_group_code:  string | null
  prod_posting_group_code: string | null
  inventory_account:       string | null
  wip_account:             string | null
  finished_goods_account:  string | null
}

type DimOpts = { center_code?: number; season_id?: number; field_id?: number }

type CacheEntry<T> = { expiresAt: number; value: T }

const SETUP_CACHE_TTL_MS = 60 * 1000   // 1 minute (was 5 min — faster invalidation)

const generalSetupCache  = new Map<string, CacheEntry<GeneralPostingRuleRow | null>>()
const inventorySetupCache = new Map<string, CacheEntry<InventoryPostingRuleRow | null>>()
const controlAccountCache = new Map<string, CacheEntry<string | null>>()

function getCacheKey(company_id: number, left: string | null, right: string | null): string {
  return `${company_id}:${left ?? 'NULL'}:${right ?? 'NULL'}`
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expiresAt) { cache.delete(key); return undefined }
  return hit.value
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): T {
  cache.set(key, { value, expiresAt: Date.now() + SETUP_CACHE_TTL_MS })
  return value
}

export function clearPostingEngineCaches(): void {
  generalSetupCache.clear()
  inventorySetupCache.clear()
  controlAccountCache.clear()
}

// ── Posting Group Validation ──────────────────────────────────────────────────

async function checkPostingGroupExists(
  db: D1Database,
  table: 'business_posting_groups' | 'product_posting_groups' | 'inventory_posting_groups',
  code: string,
  company_id: number,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT is_active FROM ${table} WHERE company_id = ? AND code = ? LIMIT 1`)
    .bind(company_id, code)
    .first<{ is_active: number }>()
  if (!row) return `Posting group "${code}" not found in ${table}.`
  if (row.is_active !== 1) return `Posting group "${code}" is inactive. Assign an active group.`
  return null
}

// ── Rule Resolution with Step Tracking ───────────────────────────────────────

/**
 * Resolves the general posting setup rule using an 8-step cascade.
 * Returns the matched rule AND which step (1-8) was used.
 */
async function resolveGeneralSetup(
  db: D1Database,
  company_id: number,
  bpg_code: string | null,
  ppg_code: string | null,
): Promise<{ row: GeneralPostingRuleRow; step: number } | null> {
  // Check cache (cache stores the resolved row only, not the step — step is cheap to re-derive)
  const cacheKey = getCacheKey(company_id, bpg_code, ppg_code)
  const cached = readCache(generalSetupCache, cacheKey)
  if (cached !== undefined) {
    // Re-derive step from cached row
    const step = deriveGeneralStep(bpg_code, ppg_code, cached)
    return cached ? { row: cached, step } : null
  }

  // 8-step cascade: exact → BPG-only → PPG-only → global default
  const candidates: [string | null, string | null, number][] = [
    [bpg_code, ppg_code, 1],   // exact match
    [bpg_code, null,     2],   // PPG wildcard
    [null,     ppg_code, 3],   // BPG wildcard
    [null,     null,     4],   // global default
  ]
  for (const [b, p, step] of candidates) {
    const row = await db
      .prepare(`SELECT id, bus_posting_group_code, prod_posting_group_code,
                  sales_account, purchases_account, cogs_account,
                  sales_returns_account, purch_returns_account, expense_account
                FROM posting_rules
                WHERE company_id = ?
                  AND rule_type = 'general'
                  AND (bus_posting_group_code IS ? OR (bus_posting_group_code IS NULL AND ? IS NULL))
                  AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL))
                  AND is_active = 1
                ORDER BY priority ASC, id ASC
                LIMIT 1`)
      .bind(company_id, b, b, p, p)
      .first<GeneralPostingRuleRow>()
    if (row) {
      writeCache(generalSetupCache, cacheKey, row)
      return { row, step }
    }
  }
  writeCache(generalSetupCache, cacheKey, null)
  return null
}

function deriveGeneralStep(
  bpg: string | null,
  ppg: string | null,
  row: GeneralPostingRuleRow | null,
): number {
  if (!row) return 0
  const bMatches = row.bus_posting_group_code === bpg
  const pMatches = row.prod_posting_group_code === ppg
  if (bMatches && pMatches) return 1
  if (bMatches && !pMatches) return 2
  if (!bMatches && pMatches) return 3
  return 4
}

async function resolveInventorySetup(
  db: D1Database,
  company_id: number,
  ipg_code: string | null,
  ppg_code: string | null,
  movementType?: string | null,
): Promise<{ row: InventoryPostingRuleRow; step: number } | null> {
  // Cache key includes movement_type so specific and wildcard rules don't collide.
  const cacheKey = `${getCacheKey(company_id, ipg_code, ppg_code)}:${movementType ?? 'NULL'}`
  const cached = readCache(inventorySetupCache, cacheKey)
  if (cached !== undefined) {
    const step = deriveInventoryStep(ipg_code, ppg_code, cached)
    return cached ? { row: cached, step } : null
  }

  // 8-step cascade: for each of the 4 dimension combinations, try movement_type-specific
  // rule first (step n), then movement_type IS NULL wildcard (step n+4).
  // NULL movementType → skip the specific pass and only try wildcard.
  const dimCandidates: [string | null, string | null, number][] = [
    [ipg_code, ppg_code, 1],
    [ipg_code, null,     2],
    [null,     ppg_code, 3],
    [null,     null,     4],
  ]
  const passes: Array<'specific' | 'wildcard'> = movementType ? ['specific', 'wildcard'] : ['wildcard']
  for (const pass of passes) {
    const mt = pass === 'specific' ? movementType! : null
    for (const [i, p, baseStep] of dimCandidates) {
      const step = pass === 'specific' ? baseStep : baseStep + 4
      const row = await db
        .prepare(`SELECT id, inv_posting_group_code, prod_posting_group_code, inventory_account, wip_account, finished_goods_account
                  FROM posting_rules
                  WHERE company_id = ?
                    AND rule_type = 'inventory'
                    AND (inv_posting_group_code IS ? OR (inv_posting_group_code IS NULL AND ? IS NULL))
                    AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL))
                    AND (movement_type IS ? OR (movement_type IS NULL AND ? IS NULL))
                    AND is_active = 1
                  ORDER BY priority ASC, id ASC
                  LIMIT 1`)
        .bind(company_id, i, i, p, p, mt, mt)
        .first<InventoryPostingRuleRow>()
      if (row) {
        writeCache(inventorySetupCache, cacheKey, row)
        return { row, step }
      }
    }
  }
  writeCache(inventorySetupCache, cacheKey, null)
  return null
}

function deriveInventoryStep(
  ipg: string | null,
  ppg: string | null,
  row: InventoryPostingRuleRow | null,
): number {
  if (!row) return 0
  const iMatches = row.inv_posting_group_code === ipg
  const pMatches = row.prod_posting_group_code === ppg
  if (iMatches && pMatches) return 1
  if (iMatches && !pMatches) return 2
  if (!iMatches && pMatches) return 3
  return 4
}

// ── Account Validation ────────────────────────────────────────────────────────

async function validateAccounts(
  db: D1Database,
  company_id: number,
  codes: (string | null | undefined)[],
): Promise<string[]> {
  const errors: string[] = []
  const unique = [...new Set(codes.filter((c): c is string => !!c))]
  for (const code of unique) {
    const row = await db
      .prepare('SELECT is_active, is_header FROM chart_of_accounts WHERE company_id = ? AND code = ?')
      .bind(company_id, code)
      .first<{ is_active: number; is_header: number }>()
    if (!row)            errors.push(`PG-ACCT-001: Account "${code}" does not exist in Chart of Accounts.`)
    else if (!row.is_active) errors.push(`PG-ACCT-002: Account "${code}" is inactive.`)
    else if (row.is_header)  errors.push(`PG-ACCT-003: Account "${code}" is a header/group account — cannot post directly.`)
  }
  return errors
}

// ── Error Factories ───────────────────────────────────────────────────────────

function noSetupError(entity: string, bpg: string | null, ppg: string | null): string {
  return [
    `PG-RULE-001: No posting_rules row found for ${entity}.`,
    `BPG="${bpg ?? 'DEFAULT'}", PPG="${ppg ?? 'DEFAULT'}".`,
    'Go to /gl/posting-setup and create an exact row or a NULL/NULL catch-all rule.',
    'Run /gl/posting-setup/health for missing combinations.',
  ].join(' ')
}

function noInvSetupError(ipg: string | null, ppg: string | null): string {
  return [
    'PG-INV-001: No inventory posting_rules row found.',
    `IPG="${ipg ?? 'DEFAULT'}", PPG="${ppg ?? 'DEFAULT'}".`,
    'Go to /gl/posting-setup and create an exact inventory row or a NULL/NULL catch-all.',
  ].join(' ')
}

function blocked(
  errors: string[],
  warnings: string[] = [],
  partialTrace?: Partial<RuleTrace>,
): JournalBlueprint {
  return {
    lines:            [],
    validationErrors: errors,
    warnings,
    isBlocked:        true,
    trace:            partialTrace ? {
      rule_type:         partialTrace.rule_type         ?? 'unknown',
      input_bpg:         partialTrace.input_bpg         ?? null,
      input_ppg:         partialTrace.input_ppg         ?? null,
      input_ipg:         partialTrace.input_ipg         ?? null,
      resolution_step:   partialTrace.resolution_step   ?? 0,
      matched_rule_id:   partialTrace.matched_rule_id   ?? null,
      resolved_accounts: partialTrace.resolved_accounts ?? {},
      resolved_at:       new Date().toISOString(),
    } : null,
  }
}

function buildTrace(
  rule_type: string,
  input_bpg: string | null,
  input_ppg: string | null,
  input_ipg: string | null,
  step: number,
  matched_rule_id: number | null,
  resolved_accounts: Record<string, string>,
): RuleTrace {
  return {
    rule_type,
    input_bpg,
    input_ppg,
    input_ipg,
    resolution_step:  step,
    matched_rule_id,
    resolved_accounts,
    resolved_at:      new Date().toISOString(),
  }
}

// ── Public: Control Account Resolution ───────────────────────────────────────

export async function resolveControlAccount(
  db: D1Database,
  company_id: number,
  mapping_key: string,
): Promise<string | null> {
  const key = `${company_id}:${mapping_key}`
  const cached = readCache(controlAccountCache, key)
  if (cached !== undefined) return cached

  const row = await db.prepare(
    `SELECT account_code FROM posting_rules
     WHERE company_id = ? AND rule_type = 'control' AND mapping_key = ? AND is_active = 1
     ORDER BY priority ASC, id ASC LIMIT 1`
  ).bind(company_id, mapping_key).first<{ account_code: string | null }>()

  return writeCache(controlAccountCache, key, row?.account_code ?? null)
}

// ── Movement Direction Helper ─────────────────────────────────────────────────
// Derives IN / OUT from the movement_types code, with backward-compat for the
// legacy Arabic literals 'اضافة' and 'صرف' that still exist in live data.

export function resolveMovementDirection(movementType: string): 'IN' | 'OUT' {
  // New typed codes
  const IN_CODES  = new Set(['GRN', 'TRANSFER_IN', 'RETURN_CUSTOMER', 'ADJUSTMENT_PROFIT', 'PRODUCTION_OUTPUT'])
  const OUT_CODES = new Set(['ISSUE', 'TRANSFER_OUT', 'RETURN_SUPPLIER', 'ADJUSTMENT_LOSS', 'PRODUCTION_INPUT'])
  if (IN_CODES.has(movementType))  return 'IN'
  if (OUT_CODES.has(movementType)) return 'OUT'
  // Legacy Arabic literals
  if (movementType === 'اضافة') return 'IN'
  return 'OUT'
}

// ── Public: resolveInventoryMovement ─────────────────────────────────────────

export async function resolveInventoryMovement(
  db: D1Database, company_id: number,
  ipg_code: string | null, ppg_code: string | null,
  amount: number, movementType: string,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const isIncrease = resolveMovementDirection(movementType) === 'IN'

  const warnings: string[] = []
  if (!ipg_code) warnings.push('Warehouse has no Inventory Posting Group assigned. Using default setup.')
  if (!ppg_code) warnings.push('Item has no Product Posting Group assigned. Using default setup.')
  if (ipg_code) { const w = await checkPostingGroupExists(db, 'inventory_posting_groups', ipg_code, company_id); if (w) warnings.push(w) }
  if (ppg_code) { const w = await checkPostingGroupExists(db, 'product_posting_groups', ppg_code, company_id); if (w) warnings.push(w) }

  // Normalise to a known code or null so the movement_type cascade is skipped for
  // legacy Arabic strings that don't exist in posting_rules.movement_type.
  const mtCode = resolveMovementDirection(movementType) === 'IN' || resolveMovementDirection(movementType) === 'OUT'
    ? (['GRN','ISSUE','TRANSFER_IN','TRANSFER_OUT','RETURN_CUSTOMER','RETURN_SUPPLIER',
        'ADJUSTMENT_PROFIT','ADJUSTMENT_LOSS','PRODUCTION_INPUT','PRODUCTION_OUTPUT'].includes(movementType)
        ? movementType : null)
    : null

  const invResult = await resolveInventorySetup(db, company_id, ipg_code, ppg_code, mtCode)
  if (!invResult) return blocked(
    [noInvSetupError(ipg_code, ppg_code)], warnings,
    { rule_type: 'inventory', input_ipg: ipg_code, input_ppg: ppg_code },
  )

  const genResult = await resolveGeneralSetup(db, company_id, null, ppg_code)
  if (!genResult) return blocked(
    [noSetupError('inventory movement', null, ppg_code)], warnings,
    { rule_type: 'general', input_ppg: ppg_code },
  )

  const inventoryAcc = invResult.row.inventory_account
  const offsetAcc    = isIncrease ? genResult.row.purchases_account : genResult.row.cogs_account
  const offsetSlot   = isIncrease ? 'purchases_account' : 'cogs_account'

  if (!inventoryAcc) return blocked(
    [`PG-INV-002: inventory_account is NULL for IPG="${invResult.row.inv_posting_group_code ?? 'DEFAULT'}" x PPG="${invResult.row.prod_posting_group_code ?? 'DEFAULT'}".`],
    warnings,
  )
  if (!offsetAcc) return blocked(
    [`PG-RULE-002: ${offsetSlot} is NULL for BPG="DEFAULT" x PPG="${genResult.row.prod_posting_group_code ?? 'DEFAULT'}".`],
    warnings,
  )

  const traceRuleType = `inventory_${movementType.toLowerCase().replace(/[^a-z_]/g, '')}`
  const trace = buildTrace(
    traceRuleType,
    null, ppg_code, ipg_code,
    Math.max(invResult.step, genResult.step),
    invResult.row.id,
    { inventory_account: inventoryAcc, [offsetSlot]: offsetAcc },
  )

  const lines: JournalLine[] = isIncrease
    ? [
        { account_code: inventoryAcc, debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'inventory_account' },
        { account_code: offsetAcc,    debit: 0,      credit: amount, description, ...dimensions, rule_slot: offsetSlot },
      ]
    : [
        { account_code: offsetAcc,    debit: amount, credit: 0,      description, ...dimensions, rule_slot: offsetSlot },
        { account_code: inventoryAcc, debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'inventory_account' },
      ]

  const errors = await validateAccounts(db, company_id, [inventoryAcc, offsetAcc])
  return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0, trace }
}

// ── Public: resolveHarvestMovement ───────────────────────────────────────────

export async function resolveHarvestMovement(
  db: D1Database,
  company_id: number,
  ipg_code: string | null,
  ppg_code: string | null,
  amount: number,
  description?: string,
  dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const warnings: string[] = []
  if (!ipg_code) warnings.push('Warehouse has no Inventory Posting Group assigned. Using default setup.')
  if (!ppg_code) warnings.push('Item has no Product Posting Group assigned. Using default setup.')
  if (ipg_code) { const w = await checkPostingGroupExists(db, 'inventory_posting_groups', ipg_code, company_id); if (w) warnings.push(w) }
  if (ppg_code) { const w = await checkPostingGroupExists(db, 'product_posting_groups', ppg_code, company_id); if (w) warnings.push(w) }

  const invResult = await resolveInventorySetup(db, company_id, ipg_code, ppg_code)
  if (!invResult) return blocked(
    [noInvSetupError(ipg_code, ppg_code)], warnings,
    { rule_type: 'harvest', input_ipg: ipg_code, input_ppg: ppg_code },
  )

  const finishedGoodsAcc = invResult.row.finished_goods_account ?? await resolveControlAccount(db, company_id, 'FINISHED_GOODS')
  const wipAcc = invResult.row.wip_account ?? await resolveControlAccount(db, company_id, 'WIP_ACCOUNT')

  const errors: string[] = []
  if (!finishedGoodsAcc) {
    errors.push(`PG-HRV-001: finished_goods_account is NULL for IPG="${invResult.row.inv_posting_group_code ?? 'DEFAULT'}" x PPG="${invResult.row.prod_posting_group_code ?? 'DEFAULT'}" and no FINISHED_GOODS control rule is active.`)
  }
  if (!wipAcc) {
    errors.push(`PG-HRV-002: wip_account is NULL for IPG="${invResult.row.inv_posting_group_code ?? 'DEFAULT'}" x PPG="${invResult.row.prod_posting_group_code ?? 'DEFAULT'}" and no WIP_ACCOUNT control rule is active.`)
  }
  if (errors.length > 0) return blocked(errors, warnings)

  const trace = buildTrace(
    'harvest',
    null,
    ppg_code,
    ipg_code,
    invResult.step,
    invResult.row.id,
    {
      finished_goods_account: finishedGoodsAcc!,
      wip_account: wipAcc!,
    },
  )

  const lines: JournalLine[] = [
    { account_code: finishedGoodsAcc!, debit: amount, credit: 0, description, ...dimensions, rule_slot: 'finished_goods_account' },
    { account_code: wipAcc!, debit: 0, credit: amount, description, ...dimensions, rule_slot: 'wip_account' },
  ]

  const validationErrors = await validateAccounts(db, company_id, [finishedGoodsAcc!, wipAcc!])
  return { lines, validationErrors, warnings, isBlocked: validationErrors.length > 0, trace }
}

// ── Public: resolveInventoryTransfer ──────────────────────────────────────────

export async function resolveInventoryTransfer(
  db: D1Database, company_id: number,
  src_ipg_code: string | null, dst_ipg_code: string | null,
  ppg_code: string | null, amount: number,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const warnings: string[] = []
  if (!src_ipg_code) warnings.push('Source warehouse has no Inventory Posting Group.')
  if (!dst_ipg_code) warnings.push('Destination warehouse has no Inventory Posting Group.')
  
  const srcResult = await resolveInventorySetup(db, company_id, src_ipg_code, ppg_code)
  const dstResult = await resolveInventorySetup(db, company_id, dst_ipg_code, ppg_code)

  const errors: string[] = []
  if (!srcResult) errors.push(noInvSetupError(src_ipg_code, ppg_code))
  if (!dstResult) errors.push(noInvSetupError(dst_ipg_code, ppg_code))
  
  if (errors.length > 0) return blocked(errors, warnings)

  const srcAcc = srcResult!.row.inventory_account
  const dstAcc = dstResult!.row.inventory_account

  if (!srcAcc) errors.push(`PG-INV-002: Source inventory_account is NULL.`)
  if (!dstAcc) errors.push(`PG-INV-002: Destination inventory_account is NULL.`)
  if (errors.length > 0) return blocked(errors, warnings)

  const trace = buildTrace('inventory_transfer', null, ppg_code, src_ipg_code, 
    Math.max(srcResult!.step, dstResult!.step), srcResult!.row.id,
    { source_inventory: srcAcc!, destination_inventory: dstAcc! })

  const lines: JournalLine[] = [
    { account_code: dstAcc!, debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'inventory_account' },
    { account_code: srcAcc!, debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'inventory_account' },
  ]

  const vErrors = await validateAccounts(db, company_id, [srcAcc!, dstAcc!])
  return { lines, validationErrors: vErrors, warnings, isBlocked: vErrors.length > 0, trace }
}

// ── Public: resolvePurchaseReceipt ────────────────────────────────────────────

export async function resolvePurchaseReceipt(
  db: D1Database, company_id: number,
  ipg_code: string | null, ppg_code: string | null,
  ap_code: string, amount: number,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const warnings: string[] = []
  if (!ipg_code) warnings.push('Warehouse has no Inventory Posting Group.')
  if (!ppg_code) warnings.push('Item has no Product Posting Group.')

  const invResult = await resolveInventorySetup(db, company_id, ipg_code, ppg_code)
  if (!invResult) return blocked([noInvSetupError(ipg_code, ppg_code)], warnings,
    { rule_type: 'inventory', input_ipg: ipg_code, input_ppg: ppg_code })

  const inventoryAcc = invResult.row.inventory_account
  if (!inventoryAcc) return blocked([`PG-INV-002: inventory_account is NULL.`], warnings)

  const trace = buildTrace('purchase_receipt', null, ppg_code, ipg_code, invResult.step, invResult.row.id,
    { inventory_account: inventoryAcc, accounts_payable: ap_code })

  const lines: JournalLine[] = [
    { account_code: inventoryAcc, debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'inventory_account' },
    { account_code: ap_code,      debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'accounts_payable' },
  ]
  const errors = await validateAccounts(db, company_id, [inventoryAcc, ap_code])
  return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0, trace }
}

// ── Public: resolveCashTransaction ───────────────────────────────────────────

export async function resolveCashTransaction(
  db: D1Database, company_id: number,
  cash_code: string, contra_code: string,
  amount: number, isReceipt: boolean,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const trace = buildTrace('cash_transaction', null, null, null, 0, null,
    { cash_account: cash_code, contra_account: contra_code })
    
  const lines: JournalLine[] = isReceipt
    ? [
        { account_code: cash_code,   debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'cash_account' },
        { account_code: contra_code, debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'contra_account' },
      ]
    : [
        { account_code: contra_code, debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'contra_account' },
        { account_code: cash_code,   debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'cash_account' },
      ]

  const errors = await validateAccounts(db, company_id, [cash_code, contra_code])
  return { lines, validationErrors: errors, warnings: [], isBlocked: errors.length > 0, trace }
}

// ── Public: resolveSupplierInvoice ────────────────────────────────────────────

export async function resolveSupplierInvoice(
  db: D1Database, company_id: number,
  bpg_code: string | null, ppg_code: string | null,
  ap_code: string, amount: number,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const warnings: string[] = []
  if (!bpg_code) warnings.push('Supplier has no Business Posting Group. Assign one for accurate account routing.')
  if (!ppg_code) warnings.push('Item has no Product Posting Group. Using default setup.')
  if (bpg_code) { const w = await checkPostingGroupExists(db, 'business_posting_groups', bpg_code, company_id); if (w) warnings.push(w) }
  if (ppg_code) { const w = await checkPostingGroupExists(db, 'product_posting_groups', ppg_code, company_id); if (w) warnings.push(w) }

  const result = await resolveGeneralSetup(db, company_id, bpg_code, ppg_code)
  if (!result) return blocked([noSetupError('supplier invoice', bpg_code, ppg_code)], warnings,
    { rule_type: 'general', input_bpg: bpg_code, input_ppg: ppg_code })

  if (!result.row.purchases_account) return blocked(
    [`PG-RULE-002: purchases_account is NULL for BPG="${result.row.bus_posting_group_code ?? 'DEFAULT'}" x PPG="${result.row.prod_posting_group_code ?? 'DEFAULT'}".`],
    warnings,
  )

  const trace = buildTrace('supplier_invoice', bpg_code, ppg_code, null, result.step, result.row.id,
    { purchases_account: result.row.purchases_account, accounts_payable: ap_code })

  const lines: JournalLine[] = [
    { account_code: result.row.purchases_account, debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'purchases_account' },
    { account_code: ap_code,                      debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'accounts_payable' },
  ]
  const errors = await validateAccounts(db, company_id, [result.row.purchases_account, ap_code])
  return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0, trace }
}

// ── Public: resolveSupplierPayment ────────────────────────────────────────────

export async function resolveSupplierPayment(
  db: D1Database, company_id: number,
  ap_code: string, cash_code: string, amount: number,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const trace = buildTrace('supplier_payment', null, null, null, 0, null,
    { accounts_payable: ap_code, cash_account: cash_code })
  const lines: JournalLine[] = [
    { account_code: ap_code,   debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'accounts_payable' },
    { account_code: cash_code, debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'cash_account' },
  ]
  const errors = await validateAccounts(db, company_id, [ap_code, cash_code])
  return { lines, validationErrors: errors, warnings: [], isBlocked: errors.length > 0, trace }
}

// ── Public: resolveExpensePosting ─────────────────────────────────────────────

export async function resolveExpensePosting(
  db: D1Database, company_id: number,
  bpg_code: string | null, ppg_code: string | null,
  cash_code: string, amount: number,
  expenseAccount?: string, description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const warnings: string[] = []
  if (!bpg_code) warnings.push('No Business Posting Group. Using default setup for expense account resolution.')

  let expAcc = expenseAccount ?? null
  let trace: RuleTrace
  if (!expAcc) {
    const result = await resolveGeneralSetup(db, company_id, bpg_code, ppg_code)
    if (!result) return blocked([noSetupError('expense', bpg_code, ppg_code)], warnings,
      { rule_type: 'general', input_bpg: bpg_code, input_ppg: ppg_code })
    expAcc = result.row.expense_account ?? null
    if (!expAcc) return blocked(
      [`PG-RULE-002: expense_account is NULL for BPG="${result.row.bus_posting_group_code ?? 'DEFAULT'}" x PPG="${result.row.prod_posting_group_code ?? 'DEFAULT'}".`],
      warnings,
    )
    trace = buildTrace('cash_expense', bpg_code, ppg_code, null, result.step, result.row.id,
      { expense_account: expAcc, cash_account: cash_code })
  } else {
    trace = buildTrace('cash_expense', bpg_code, ppg_code, null, 0, null,
      { expense_account: expAcc, cash_account: cash_code })
  }

  const lines: JournalLine[] = [
    { account_code: expAcc,    debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'expense_account' },
    { account_code: cash_code, debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'cash_account' },
  ]
  const errors = await validateAccounts(db, company_id, [expAcc, cash_code])
  return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0, trace }
}

// Public alias
export const resolveExpense = resolveExpensePosting

// ── Public: resolveSalesRevenue ───────────────────────────────────────────────

export async function resolveSalesRevenue(
  db: D1Database, company_id: number,
  bpg_code: string | null, ppg_code: string | null,
  receivable_code: string, amount: number,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const warnings: string[] = []
  if (!bpg_code) warnings.push('No Business Posting Group on this customer/buyer. Using default revenue account.')
  if (!ppg_code) warnings.push('Item has no Product Posting Group. Using default setup.')

  const result = await resolveGeneralSetup(db, company_id, bpg_code, ppg_code)
  if (!result) return blocked([noSetupError('revenue', bpg_code, ppg_code)], warnings,
    { rule_type: 'general', input_bpg: bpg_code, input_ppg: ppg_code })
  if (!result.row.sales_account) return blocked(
    [`PG-RULE-002: sales_account is NULL for BPG="${result.row.bus_posting_group_code ?? 'DEFAULT'}" x PPG="${result.row.prod_posting_group_code ?? 'DEFAULT'}".`],
    warnings,
  )

  const trace = buildTrace('sales_revenue', bpg_code, ppg_code, null, result.step, result.row.id,
    { receivable_account: receivable_code, sales_account: result.row.sales_account })

  const lines: JournalLine[] = [
    { account_code: receivable_code,     debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'receivable_account' },
    { account_code: result.row.sales_account, debit: 0, credit: amount, description, ...dimensions, rule_slot: 'sales_account' },
  ]
  const errors = await validateAccounts(db, company_id, [receivable_code, result.row.sales_account])
  return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0, trace }
}

// ── Public: resolvePayrollPosting ─────────────────────────────────────────────

export async function resolvePayrollPosting(
  db: D1Database, company_id: number,
  wages_account: string, wages_payable_account: string,
  amount: number, description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const trace = buildTrace('payroll_run', null, null, null, 0, null,
    { wages_account, wages_payable_account })
  const lines: JournalLine[] = [
    { account_code: wages_account,         debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'wages_account' },
    { account_code: wages_payable_account, debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'wages_payable_account' },
  ]
  const errors = await validateAccounts(db, company_id, [wages_account, wages_payable_account])
  const warnings = errors.length > 0 ? ['One or more wage accounts failed CoA validation. Fix ghost mappings in GL Settings.'] : []
  return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0, trace }
}

export const resolvePayroll = resolvePayrollPosting

// ── Public: resolveWorkOrderLabor ───────────────────────────────────────────

export async function resolveWorkOrderLabor(
  db: D1Database, company_id: number,
  cogs_account: string, wages_payable_account: string,
  amount: number, description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const trace = buildTrace('work_order_labor', null, null, null, 0, null,
    { cogs_account, wages_payable_account })
  const lines: JournalLine[] = [
    { account_code: cogs_account,          debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'cogs_account' },
    { account_code: wages_payable_account, debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'wages_payable_account' },
  ]
  const errors = await validateAccounts(db, company_id, [cogs_account, wages_payable_account])
  return { lines, validationErrors: errors, warnings: [], isBlocked: errors.length > 0, trace }
}

// ── Public: resolveContractAdvance ──────────────────────────────────────────

export async function resolveContractAdvance(
  db: D1Database, company_id: number,
  cash_account: string, deferred_account: string,
  amount: number, description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const trace = buildTrace('contract_advance', null, null, null, 0, null,
    { cash_account, deferred_account })
  const lines: JournalLine[] = [
    { account_code: cash_account,     debit: amount, credit: 0,      description, ...dimensions, rule_slot: 'cash_account' },
    { account_code: deferred_account, debit: 0,      credit: amount, description, ...dimensions, rule_slot: 'deferred_account' },
  ]
  const errors = await validateAccounts(db, company_id, [cash_account, deferred_account])
  return { lines, validationErrors: errors, warnings: [], isBlocked: errors.length > 0, trace }
}
