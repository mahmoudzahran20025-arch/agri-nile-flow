/**
 * posting_engine.ts — Zero-Data-Safe Posting Groups Engine
 * =========================================================
 * Microsoft Dynamics–style account resolution for Agri-Nile Flow ERP.
 *
 * Design goals:
 *  - Works with ZERO initial setup (returns descriptive errors, never throws)
 *  - Separates warnings (advisory) from errors (blocking)
 *  - Validates all resolved account codes against chart_of_accounts
 *  - 4-step cascade: exact → BPG wildcard → PPG wildcard → company default (NULL/NULL)
 */

import type { D1Database } from '@cloudflare/workers-types'

export interface JournalLine {
  account_code: string
  debit:        number
  credit:       number
  description?: string
  center_code?: number
  season_id?:   number
  field_id?:    number
}

export interface JournalBlueprint {
  lines:            JournalLine[]
  validationErrors: string[]
  warnings:         string[]
  isBlocked:        boolean
}

interface GeneralPostingSetupRow {
  bus_posting_group_code:  string | null
  prod_posting_group_code: string | null
  sales_account:           string | null
  purchases_account:       string | null
  cogs_account:            string | null
  sales_returns_account:   string | null
  purch_returns_account:   string | null
  expense_account:         string | null
}

interface InventoryPostingSetupRow {
  inv_posting_group_code:  string | null
  prod_posting_group_code: string | null
  inventory_account:       string | null
}

type DimOpts = { center_code?: number; season_id?: number; field_id?: number }

type CacheEntry<T> = {
  expiresAt: number
  value: T
}

const SETUP_CACHE_TTL_MS = 5 * 60 * 1000
const generalSetupCache = new Map<string, CacheEntry<GeneralPostingSetupRow | null>>()
const inventorySetupCache = new Map<string, CacheEntry<InventoryPostingSetupRow | null>>()

function getCacheKey(company_id: number, left: string | null, right: string | null): string {
  return `${company_id}:${left ?? 'NULL'}:${right ?? 'NULL'}`
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expiresAt) {
    cache.delete(key)
    return undefined
  }
  return hit.value
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): T {
  cache.set(key, { value, expiresAt: Date.now() + SETUP_CACHE_TTL_MS })
  return value
}

async function resolveWithMetrics<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    console.log(`[posting_engine] ${name} ${Date.now() - start}ms`)
    return result
  } catch (error) {
    console.error(`[posting_engine] ${name} FAILED ${Date.now() - start}ms`, error)
    throw error
  }
}

export function clearPostingEngineCaches(): void {
  generalSetupCache.clear()
  inventorySetupCache.clear()
}

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

async function resolveGeneralSetup(
  db: D1Database, company_id: number, bpg_code: string | null, ppg_code: string | null,
): Promise<GeneralPostingSetupRow | null> {
  const cached = readCache(generalSetupCache, getCacheKey(company_id, bpg_code, ppg_code))
  if (cached !== undefined) return cached

  const candidates: [string | null, string | null][] = [
    [bpg_code, ppg_code], [bpg_code, null], [null, ppg_code], [null, null],
  ]
  for (const [b, p] of candidates) {
    const row = await db
      .prepare(`SELECT bus_posting_group_code, prod_posting_group_code,
               sales_account, purchases_account, cogs_account,
               sales_returns_account, purch_returns_account, expense_account
        FROM general_posting_setup
        WHERE company_id = ?
          AND (bus_posting_group_code IS ? OR (bus_posting_group_code IS NULL AND ? IS NULL))
          AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL))
          AND is_active = 1 LIMIT 1`)
      .bind(company_id, b, b, p, p)
      .first<GeneralPostingSetupRow>()
    if (row) {
      writeCache(generalSetupCache, getCacheKey(company_id, bpg_code, ppg_code), row)
      return row
    }
  }
  return writeCache(generalSetupCache, getCacheKey(company_id, bpg_code, ppg_code), null)
}

async function resolveInventorySetup(
  db: D1Database, company_id: number, ipg_code: string | null, ppg_code: string | null,
): Promise<InventoryPostingSetupRow | null> {
  const cached = readCache(inventorySetupCache, getCacheKey(company_id, ipg_code, ppg_code))
  if (cached !== undefined) return cached

  const candidates: [string | null, string | null][] = [
    [ipg_code, ppg_code], [ipg_code, null], [null, ppg_code], [null, null],
  ]
  for (const [i, p] of candidates) {
    const row = await db
      .prepare(`SELECT inv_posting_group_code, prod_posting_group_code, inventory_account
        FROM inventory_posting_setup
        WHERE company_id = ?
          AND (inv_posting_group_code IS ? OR (inv_posting_group_code IS NULL AND ? IS NULL))
          AND (prod_posting_group_code IS ? OR (prod_posting_group_code IS NULL AND ? IS NULL))
          AND is_active = 1 LIMIT 1`)
      .bind(company_id, i, i, p, p)
      .first<InventoryPostingSetupRow>()
    if (row) {
      writeCache(inventorySetupCache, getCacheKey(company_id, ipg_code, ppg_code), row)
      return row
    }
  }
  return writeCache(inventorySetupCache, getCacheKey(company_id, ipg_code, ppg_code), null)
}

async function validateAccounts(
  db: D1Database, company_id: number, codes: (string | null | undefined)[],
): Promise<string[]> {
  const errors: string[] = []
  const unique = [...new Set(codes.filter((c): c is string => !!c))]
  for (const code of unique) {
    const row = await db
      .prepare('SELECT is_active FROM chart_of_accounts WHERE company_id = ? AND code = ?')
      .bind(company_id, code).first<{ is_active: number }>()
    if (!row) errors.push(`PG-ACCT-001: Account "${code}" does not exist in Chart of Accounts.`)
    else if (row.is_active !== 1) errors.push(`PG-ACCT-002: Account "${code}" is inactive.`)
  }
  return errors
}

function noSetupError(entity: string, bpg: string | null, ppg: string | null): string {
  return [
    `PG-GPS-001: No general_posting_setup row found for ${entity}.`,
    `BPG="${bpg ?? 'DEFAULT'}", PPG="${ppg ?? 'DEFAULT'}".`,
    'Open /gl/posting-setup and create either an exact row or a NULL/NULL catch-all rule.',
    'Check /gl/posting-setup/health for missing combinations.',
  ].join(' ')
}

function noInvSetupError(ipg: string | null, ppg: string | null): string {
  return [
    'PG-INV-001: No inventory_posting_setup row found.',
    `IPG="${ipg ?? 'DEFAULT'}", PPG="${ppg ?? 'DEFAULT'}".`,
    'Open /gl/posting-setup and create either an exact inventory row or a NULL/NULL catch-all rule.',
    'Check /gl/posting-setup/health for missing warehouse or product assignments.',
  ].join(' ')
}

function blocked(errors: string[], warnings: string[] = []): JournalBlueprint {
  return { lines: [], validationErrors: errors, warnings, isBlocked: true }
}

export async function resolveInventoryMovement(
  db: D1Database, company_id: number,
  ipg_code: string | null, ppg_code: string | null,
  amount: number, isIncrease: boolean,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  return resolveWithMetrics('resolveInventoryMovement', async () => {
    const warnings: string[] = []
    if (!ipg_code) warnings.push('Warehouse has no Inventory Posting Group assigned. Using default setup.')
    if (!ppg_code) warnings.push('Item has no Product Posting Group assigned. Using default setup.')
    if (ipg_code) { const w = await checkPostingGroupExists(db, 'inventory_posting_groups', ipg_code, company_id); if (w) warnings.push(w) }
    if (ppg_code) { const w = await checkPostingGroupExists(db, 'product_posting_groups', ppg_code, company_id); if (w) warnings.push(w) }

    const invSetup = await resolveInventorySetup(db, company_id, ipg_code, ppg_code)
    if (!invSetup) return blocked([noInvSetupError(ipg_code, ppg_code)], warnings)

    const genSetup = await resolveGeneralSetup(db, company_id, null, ppg_code)
    if (!genSetup) return blocked([noSetupError('inventory movement', null, ppg_code)], warnings)

    const inventoryAcc = invSetup.inventory_account
    const offsetAcc    = isIncrease ? genSetup.purchases_account : genSetup.cogs_account

    if (!inventoryAcc) return blocked([`PG-INV-002: inventory_posting_setup row (IPG="${invSetup.inv_posting_group_code ?? 'DEFAULT'}" x PPG="${invSetup.prod_posting_group_code ?? 'DEFAULT'}") has NULL inventory_account. Edit in Inventory Posting Setup.`], warnings)
    if (!offsetAcc)    return blocked([`PG-GPS-002: general_posting_setup is missing ${isIncrease ? 'purchases_account' : 'cogs_account'} (BPG="DEFAULT" x PPG="${genSetup.prod_posting_group_code ?? 'DEFAULT'}"). Edit in Posting Setup.`], warnings)

    const lines: JournalLine[] = isIncrease
      ? [{ account_code: inventoryAcc, debit: amount, credit: 0, description, ...dimensions }, { account_code: offsetAcc, debit: 0, credit: amount, description, ...dimensions }]
      : [{ account_code: offsetAcc, debit: amount, credit: 0, description, ...dimensions }, { account_code: inventoryAcc, debit: 0, credit: amount, description, ...dimensions }]

    const errors = await validateAccounts(db, company_id, [inventoryAcc, offsetAcc])
    return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0 }
  })
}

export async function resolveSupplierInvoice(
  db: D1Database, company_id: number,
  bpg_code: string | null, ppg_code: string | null,
  ap_code: string, amount: number,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  return resolveWithMetrics('resolveSupplierInvoice', async () => {
    const warnings: string[] = []
    if (!bpg_code) warnings.push('Supplier has no Business Posting Group. Assign one in Supplier settings for accurate account routing.')
    if (!ppg_code) warnings.push('Item has no Product Posting Group. Using default setup.')
    if (bpg_code) { const w = await checkPostingGroupExists(db, 'business_posting_groups', bpg_code, company_id); if (w) warnings.push(w) }
    if (ppg_code) { const w = await checkPostingGroupExists(db, 'product_posting_groups', ppg_code, company_id); if (w) warnings.push(w) }

    const setup = await resolveGeneralSetup(db, company_id, bpg_code, ppg_code)
    if (!setup) return blocked([noSetupError('supplier invoice', bpg_code, ppg_code)], warnings)
    if (!setup.purchases_account) return blocked([`PG-GPS-002: purchases_account is NULL in setup (BPG="${setup.bus_posting_group_code ?? 'DEFAULT'}" x PPG="${setup.prod_posting_group_code ?? 'DEFAULT'}"). Edit the setup row.`], warnings)

    const lines: JournalLine[] = [
      { account_code: setup.purchases_account, debit: amount, credit: 0, description, ...dimensions },
      { account_code: ap_code, debit: 0, credit: amount, description, ...dimensions },
    ]
    const errors = await validateAccounts(db, company_id, [setup.purchases_account, ap_code])
    return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0 }
  })
}

export async function resolveSupplierPayment(
  db: D1Database, company_id: number,
  ap_code: string, cash_code: string, amount: number,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const lines: JournalLine[] = [
    { account_code: ap_code,   debit: amount, credit: 0,      description, ...dimensions },
    { account_code: cash_code, debit: 0,      credit: amount, description, ...dimensions },
  ]
  const errors = await validateAccounts(db, company_id, [ap_code, cash_code])
  return { lines, validationErrors: errors, warnings: [], isBlocked: errors.length > 0 }
}

export async function resolveExpensePosting(
  db: D1Database, company_id: number,
  bpg_code: string | null, ppg_code: string | null,
  cash_code: string, amount: number,
  expenseAccount?: string, description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const warnings: string[] = []
  if (!bpg_code) warnings.push('No Business Posting Group provided. Using default setup for expense account resolution.')

  let expAcc = expenseAccount ?? null
  if (!expAcc) {
    const setup = await resolveGeneralSetup(db, company_id, bpg_code, ppg_code)
    if (!setup) return blocked([noSetupError('expense', bpg_code, ppg_code)], warnings)
    expAcc = setup.expense_account ?? null
    if (!expAcc) return blocked([`PG-GPS-002: expense_account is NULL in setup (BPG="${setup.bus_posting_group_code ?? 'DEFAULT'}" x PPG="${setup.prod_posting_group_code ?? 'DEFAULT'}"). Edit the setup row.`], warnings)
  }

  const lines: JournalLine[] = [
    { account_code: expAcc,    debit: amount, credit: 0,      description, ...dimensions },
    { account_code: cash_code, debit: 0,      credit: amount, description, ...dimensions },
  ]
  const errors = await validateAccounts(db, company_id, [expAcc, cash_code])
  return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0 }
}

export async function resolveSalesRevenue(
  db: D1Database, company_id: number,
  bpg_code: string | null, ppg_code: string | null,
  receivable_code: string, amount: number,
  description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const warnings: string[] = []
  if (!bpg_code) warnings.push('No Business Posting Group on this customer/buyer. Using default revenue account.')
  if (!ppg_code) warnings.push('Item has no Product Posting Group. Using default setup.')

  const setup = await resolveGeneralSetup(db, company_id, bpg_code, ppg_code)
  if (!setup) return blocked([noSetupError('revenue', bpg_code, ppg_code)], warnings)
  if (!setup.sales_account) return blocked([`PG-GPS-002: sales_account is NULL in setup (BPG="${setup.bus_posting_group_code ?? 'DEFAULT'}" x PPG="${setup.prod_posting_group_code ?? 'DEFAULT'}"). Edit the setup row.`], warnings)

  const lines: JournalLine[] = [
    { account_code: receivable_code,     debit: amount, credit: 0,      description, ...dimensions },
    { account_code: setup.sales_account, debit: 0,      credit: amount, description, ...dimensions },
  ]
  const errors = await validateAccounts(db, company_id, [receivable_code, setup.sales_account])
  return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0 }
}

// resolveCustomerSale / resolveCustomerPayment removed — use resolveSalesRevenue / resolveSupplierPayment directly

export async function resolveExpense(
  db: D1Database, company_id: number,
  bpg_code: string | null, ppg_code: string | null,
  cash_code: string, amount: number,
  expenseAccount?: string, description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  return resolveExpensePosting(db, company_id, bpg_code, ppg_code, cash_code, amount, expenseAccount, description, dimensions)
}

export async function resolvePayroll(
  db: D1Database, company_id: number,
  wages_account: string, wages_payable_account: string,
  amount: number, description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  return resolvePayrollPosting(db, company_id, wages_account, wages_payable_account, amount, description, dimensions)
}

export async function resolvePayrollPosting(
  db: D1Database, company_id: number,
  wages_account: string, wages_payable_account: string,
  amount: number, description?: string, dimensions?: DimOpts,
): Promise<JournalBlueprint> {
  const lines: JournalLine[] = [
    { account_code: wages_account,         debit: amount, credit: 0,      description, ...dimensions },
    { account_code: wages_payable_account, debit: 0,      credit: amount, description, ...dimensions },
  ]
  const errors = await validateAccounts(db, company_id, [wages_account, wages_payable_account])
  const warnings: string[] = errors.length > 0 ? ['One or more wage accounts failed CoA validation. Fix ghost mappings in GL Settings.'] : []
  return { lines, validationErrors: errors, warnings, isBlocked: errors.length > 0 }
}
