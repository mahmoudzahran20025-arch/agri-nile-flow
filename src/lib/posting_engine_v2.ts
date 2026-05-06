/**
 * src/lib/posting_engine_v2.ts
 *
 * Posting Engine V2 — Multi-Dimensional Cascade + Multi-Currency
 * ==============================================================
 *
 * ⚠️  NOT YET WIRED — ZERO CALLERS IN PRODUCTION
 * ------------------------------------------------
 * This engine is fully implemented but not integrated into the active request
 * flow. All live GL postings go through posting_engine.ts (V1).
 *
 * Wire this engine when the business requires:
 *   - Date-bounded posting rules (valid_from / valid_to)
 *   - Warehouse dimension in the cascade (wh_id)
 *   - Multi-currency transactions (currency_code / amount_in_base_currency)
 *
 * Migration path: replace peResolveXxx() calls in src/lib/finance/resolvers/*
 * one resolver at a time, using the V2ResolutionInput interface below.
 * The postFromBusinessEvent() layer and journal write path need no changes.
 *
 * Differences from V1 (posting_engine.ts):
 *  - Validity-date filtering on rules (valid_from / valid_to)
 *  - priority_index ordering within cascade steps
 *  - Warehouse dimension (wh_id) as additional cascade axis
 *  - Multi-currency: converts amounts to base currency via exchange_rates
 *  - Outputs JournalLineV2 with currency_code + amount_in_base_currency
 *  - Falls back to V1 behaviour when no V2-specific rules found
 *  - 60-second cache per company+key
 */

import type { D1Database } from '@cloudflare/workers-types'
import type { JournalLineV2 } from '../types/posting_v2'

// ── Internal Types ────────────────────────────────────────────────────────────

interface V2RuleRow {
  id:                      number
  rule_type:               string
  bus_posting_group_code:  string | null
  prod_posting_group_code: string | null
  inv_posting_group_code:  string | null
  wh_id:                   number | null
  sales_account:           string | null
  purchases_account:       string | null
  cogs_account:            string | null
  sales_returns_account:   string | null
  purch_returns_account:   string | null
  expense_account:         string | null
  inventory_account:       string | null
  wip_account:             string | null
  finished_goods_account:  string | null
  valid_from:              string | null
  valid_to:                string | null
  priority_index:          number
}

interface ExchangeRateRow {
  rate:           number
  effective_date: string
}

export interface V2ResolutionInput {
  company_id:            number
  event_date:            string       // YYYY-MM-DD (used for validity + FX lookup)
  bus_posting_group_code?: string | null
  prod_posting_group_code?: string | null
  inv_posting_group_code?: string | null
  wh_id?:                number | null
  currency_code?:        string       // Defaults to EGP (base)
  amount:                number
  slot:                  keyof Pick<V2RuleRow,
    'sales_account' | 'purchases_account' | 'cogs_account' |
    'sales_returns_account' | 'purch_returns_account' | 'expense_account' |
    'inventory_account' | 'wip_account' | 'finished_goods_account'>
  description?:          string
  center_code?:          number | null
  season_id?:            number | null
  field_id?:             number | null
  business_unit_id?:     number | null
}

export interface V2ResolutionResult {
  lines:           JournalLineV2[]
  resolvedRuleId:  number | null
  cascadeStep:     number           // 1–8, which level matched
  currencyRate:    number           // 1.0 if base currency
  warnings:        string[]
  isBlocked:       boolean
}

// ── Module-level Cache ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000

type CacheEntry<T> = { value: T; expiresAt: number }

const ruleCache = new Map<string, CacheEntry<V2RuleRow | null>>()
const fxCache   = new Map<string, CacheEntry<number>>()
const roleCache  = new Map<string, CacheEntry<string | null>>()

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const e = map.get(key)
  if (!e) return undefined
  if (Date.now() > e.expiresAt) { map.delete(key); return undefined }
  return e.value
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function clearV2Caches(): void {
  ruleCache.clear()
  fxCache.clear()
  roleCache.clear()
}

// ── Account Role Resolution (Phase 3 Policy Engine) ──────────────────────────

/**
 * Resolves a role code (e.g. 'INVENTORY') to an actual account_code
 * via the account_role_mappings table for this company.
 * Returns null if no mapping found (caller decides how to handle).
 * Results cached 60 seconds.
 */
export async function resolveAccountByRole(
  db:          D1Database,
  company_id:  number,
  role_code:   string,
): Promise<string | null> {
  const cacheKey = `${company_id}:${role_code}`
  const cached = cacheGet(roleCache, cacheKey)
  if (cached !== undefined) return cached

  const row = await db
    .prepare(`
      SELECT account_code
      FROM account_role_mappings
      WHERE company_id = ? AND role_code = ? AND is_active = 1
      ORDER BY priority ASC
      LIMIT 1
    `)
    .bind(company_id, role_code)
    .first<{ account_code: string }>()

  const result = row?.account_code ?? null
  cacheSet(roleCache, cacheKey, result)
  return result
}

// ── Exchange Rate Lookup ──────────────────────────────────────────────────────

/**
 * Returns the conversion rate from `from` to `to` as of `date`.
 * Returns 1.0 if from === to (base currency).
 * Throws if rate not found (caller should handle gracefully).
 */
export async function getExchangeRate(
  db:          D1Database,
  company_id:  number,
  from:        string,
  to:          string,
  date:        string,   // YYYY-MM-DD
): Promise<number> {
  if (from === to) return 1.0

  const cacheKey = `${company_id}:${from}:${to}:${date}`
  const cached = cacheGet(fxCache, cacheKey)
  if (cached !== undefined) return cached

  const row = await db
    .prepare(`
      SELECT rate, effective_date
      FROM exchange_rates
      WHERE company_id = ?
        AND from_currency = ?
        AND to_currency   = ?
        AND effective_date <= ?
      ORDER BY effective_date DESC
      LIMIT 1
    `)
    .bind(company_id, from, to, date)
    .first<ExchangeRateRow>()

  if (!row) {
    throw new Error(`FX_RATE_NOT_FOUND:${from}:${to}:${date}`)
  }

  cacheSet(fxCache, cacheKey, row.rate)
  return row.rate
}

// ── Rule Cascade ──────────────────────────────────────────────────────────────

/**
 * V2 cascade — 8 levels, adds wh_id axis + validity dates + priority_index.
 *
 * Cascade priority (most specific → least specific):
 *  1. BPG + PPG + WH  (exact match with warehouse)
 *  2. BPG + PPG       (exact match, no warehouse)
 *  3. BPG + WH        (PPG wildcard with warehouse)
 *  4. PPG + WH        (BPG wildcard with warehouse)
 *  5. BPG only
 *  6. PPG only
 *  7. WH only
 *  8. Global default
 */
async function resolveV2Rule(
  db:          D1Database,
  company_id:  number,
  bpg:         string | null,
  ppg:         string | null,
  wh_id:       number | null,
  event_date:  string,
): Promise<{ row: V2RuleRow; step: number } | null> {

  const candidates: [string | null, string | null, number | null, number][] = [
    [bpg,  ppg,  wh_id, 1],
    [bpg,  ppg,  null,  2],
    [bpg,  null, wh_id, 3],
    [null, ppg,  wh_id, 4],
    [bpg,  null, null,  5],
    [null, ppg,  null,  6],
    [null, null, wh_id, 7],
    [null, null, null,  8],
  ]

  for (const [b, p, w, step] of candidates) {
    // Skip if dimension requested but NULL in candidate (reduces false matches)
    if (bpg  && b  === null && step !== 8) continue
    if (ppg  && p  === null && step !== 8) continue
    if (wh_id && w === null && step < 7)   continue

    const cacheKey = `${company_id}:${b ?? 'N'}:${p ?? 'N'}:${w ?? 'N'}:${event_date}`
    const cached = cacheGet(ruleCache, cacheKey)

    let row: V2RuleRow | null | undefined = cached

    if (row === undefined) {
      const whereWh = w !== null ? 'AND (wh_id = ? OR wh_id IS NULL)' : 'AND wh_id IS NULL'
      const whBind  = w !== null ? [w] : []

      row = await db
        .prepare(`
          SELECT id, rule_type,
            bus_posting_group_code, prod_posting_group_code, inv_posting_group_code,
            wh_id,
            sales_account, purchases_account, cogs_account,
            sales_returns_account, purch_returns_account, expense_account,
            inventory_account, wip_account, finished_goods_account,
            valid_from, valid_to, priority_index
          FROM posting_rules
          WHERE company_id              = ?
            AND is_active               = 1
            AND (bus_posting_group_code  = ? OR bus_posting_group_code  IS NULL)
            AND (prod_posting_group_code = ? OR prod_posting_group_code IS NULL)
            ${whereWh}
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_to   IS NULL OR valid_to   >= ?)
          ORDER BY priority_index ASC, id ASC
          LIMIT 1
        `)
        .bind(company_id, b, p, ...whBind, event_date, event_date)
        .first<V2RuleRow>() ?? null

      cacheSet(ruleCache, cacheKey, row)
    }

    if (row) return { row, step }
  }

  return null
}

// ── Main Resolution Function ──────────────────────────────────────────────────

/**
 * Resolves a posting rule and builds journal lines for V2.
 *
 * Backward compatible: if no V2-specific configuration is found,
 * the output is identical to V1 (EGP, no currency conversion).
 */
export async function resolvePostingV2(
  db:    D1Database,
  input: V2ResolutionInput,
): Promise<V2ResolutionResult> {
  const warnings: string[]         = []
  const lines:    JournalLineV2[]  = []
  const baseCurrency               = 'EGP'
  const txCurrency                 = (input.currency_code ?? baseCurrency).toUpperCase()

  // 1. Resolve rule
  const resolved = await resolveV2Rule(
    db,
    input.company_id,
    input.bus_posting_group_code ?? null,
    input.prod_posting_group_code ?? null,
    input.wh_id ?? null,
    input.event_date,
  )

  if (!resolved) {
    return {
      lines:          [],
      resolvedRuleId: null,
      cascadeStep:    0,
      currencyRate:   1,
      warnings:       [`لم يتم العثور على قاعدة ترحيل للمجموعات المحددة في تاريخ ${input.event_date}`],
      isBlocked:      true,
    }
  }

  const { row, step } = resolved

  // 2. Get the target account from the requested slot
  const accountCode = row[input.slot]
  if (!accountCode) {
    return {
      lines:          [],
      resolvedRuleId: row.id,
      cascadeStep:    step,
      currencyRate:   1,
      warnings:       [`حساب "${input.slot}" غير معرف في قاعدة الترحيل رقم ${row.id}`],
      isBlocked:      true,
    }
  }

  // 3. Currency conversion
  let currencyRate = 1.0
  let amountInBase = input.amount

  if (txCurrency !== baseCurrency) {
    try {
      currencyRate = await getExchangeRate(db, input.company_id, txCurrency, baseCurrency, input.event_date)
      amountInBase = parseFloat((input.amount * currencyRate).toFixed(2))
    } catch (err) {
      const msg = (err as Error).message
      if (msg.startsWith('FX_RATE_NOT_FOUND')) {
        warnings.push(`سعر الصرف ${txCurrency}→${baseCurrency} غير موجود بتاريخ ${input.event_date}. سيتم استخدام المبلغ الأصلي.`)
        amountInBase = input.amount  // fallback: use original amount
      } else {
        throw err
      }
    }
  }

  // 4. Build journal lines (DR or CR depends on convention — caller decides debit/credit split)
  //    V2 emits a single line per call; caller composes the full entry
  const line: JournalLineV2 = {
    id:                      0,  // assigned by DB on insert
    entry_id:                0,  // assigned by caller when entry is created
    account_code:            accountCode,
    debit:                   0,
    credit:                  0,
    currency_code:           txCurrency,
    amount_in_base_currency: amountInBase,
    description:             input.description,
    center_code:             input.center_code ?? null,
    season_id:               input.season_id   ?? null,
    field_id:                input.field_id     ?? null,
    business_unit_id:        input.business_unit_id ?? null,
    created_at:              new Date().toISOString(),
  }

  lines.push(line)

  return {
    lines,
    resolvedRuleId: row.id,
    cascadeStep:    step,
    currencyRate,
    warnings,
    isBlocked:      false,
  }
}

// ── Batch Helper ──────────────────────────────────────────────────────────────

/**
 * Resolves multiple slots in one call and returns all lines.
 * Useful when building a complete journal entry (DR side + CR side).
 */
export async function resolvePostingBatchV2(
  db:     D1Database,
  inputs: V2ResolutionInput[],
): Promise<{ results: V2ResolutionResult[]; hasBlockers: boolean }> {
  const results: V2ResolutionResult[] = []
  let hasBlockers = false

  for (const input of inputs) {
    const result = await resolvePostingV2(db, input)
    results.push(result)
    if (result.isBlocked) hasBlockers = true
  }

  return { results, hasBlockers }
}
