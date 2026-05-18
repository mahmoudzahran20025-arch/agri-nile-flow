/**
 * company_config.ts — Per-tenant configuration service
 * =====================================================
 * Single source of truth for all per-company behavioral configuration.
 *
 * USAGE:
 *   import { getCompanyConfig } from '../lib/company_config'
 *   const cfg = await getCompanyConfig(db, companyId)
 *   const vat = cfg.vat_pct
 *
 * NEVER read company config columns directly with raw SQL in route handlers.
 * Always go through this service so config reads are:
 *   - Typed (TS catches missing fields at compile time)
 *   - Defaulted (new fields get sane defaults without a backfill migration)
 *   - Cacheable (one place to add caching if needed)
 *   - Testable (pure function, injectable db)
 */

import type { D1Database } from '@cloudflare/workers-types'

// ─── Public Config Type ───────────────────────────────────────────────────────

export interface CompanyConfig {
  // Identity
  company_id:   number
  name:         string
  address:      string | null
  phone:        string | null

  // Tax
  vat_pct:        number      // decimal percentage, e.g. 14 = 14%
  vat_registered: boolean
  vat_number:     string | null

  // Accounting behaviour
  costing_method:          'ACTUAL' | 'STANDARD' | 'MOVING_AVERAGE'
  base_currency:           string   // ISO 4217, e.g. 'EGP', 'SAR', 'USD'
  fiscal_year_start_month: number   // 1–12

  // Locale
  ar_locale: string  // BCP-47: 'ar-EG', 'ar-SA', 'ar-AE', etc.

  // Module gating (null = all enabled)
  enabled_modules: string[] | null

  // Approval workflow
  approval_threshold_egp: number | null  // null = no approval required

  // Current fiscal year (seeded at company creation)
  fiscal_year_current: number | null
}

// ─── DB row shape (only what we SELECT) ──────────────────────────────────────

interface CompanyRow {
  id:                      number
  name:                    string
  address:                 string | null
  phone:                   string | null
  vat_pct:                 number | null
  vat_registered:          number | null
  vat_number:              string | null
  costing_method:          string | null
  base_currency_code:      string | null
  fiscal_year_start_month: number | null
  ar_locale:               string | null
  enabled_modules:         string | null
  approval_threshold_egp:  number | null
  fiscal_year_current:     number | null
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  vat_pct:                 0,
  vat_registered:          false,
  vat_number:              null,
  costing_method:          'MOVING_AVERAGE' as const,
  base_currency:           'EGP',
  fiscal_year_start_month: 1,
  ar_locale:               'ar-EG',
  enabled_modules:         null,
  approval_threshold_egp:  null,
  fiscal_year_current:     null,
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Load company configuration. Throws if company not found.
 * All fields have safe defaults — adding new config keys requires only
 * a migration + new field in CompanyConfig, no backfill.
 */
export async function getCompanyConfig(
  db:        D1Database,
  companyId: number,
): Promise<CompanyConfig> {
  const row = await db.prepare(
    `SELECT id, name, address, phone,
            vat_pct, vat_registered, vat_number,
            costing_method, base_currency_code,
            fiscal_year_start_month, ar_locale,
            enabled_modules, approval_threshold_egp,
            fiscal_year_current
     FROM companies
     WHERE id = ? AND is_active = 1`,
  ).bind(companyId).first<CompanyRow>()

  if (!row) throw new Error(`COMPANY_NOT_FOUND: company_id=${companyId}`)

  let enabledModules: string[] | null = null
  if (row.enabled_modules) {
    try { enabledModules = JSON.parse(row.enabled_modules) } catch { /* invalid json = all enabled */ }
  }

  const costingRaw = (row.costing_method ?? '').toUpperCase()
  const costing: CompanyConfig['costing_method'] =
    costingRaw === 'STANDARD' ? 'STANDARD'
    : costingRaw === 'ACTUAL'  ? 'ACTUAL'
    : 'MOVING_AVERAGE'

  return {
    company_id:              row.id,
    name:                    row.name,
    address:                 row.address,
    phone:                   row.phone,
    vat_pct:                 row.vat_pct                 ?? DEFAULTS.vat_pct,
    vat_registered:          (row.vat_registered ?? 0)   === 1,
    vat_number:              row.vat_number               ?? DEFAULTS.vat_number,
    costing_method:          costing,
    base_currency:           row.base_currency_code       ?? DEFAULTS.base_currency,
    fiscal_year_start_month: row.fiscal_year_start_month  ?? DEFAULTS.fiscal_year_start_month,
    ar_locale:               row.ar_locale                ?? DEFAULTS.ar_locale,
    enabled_modules:         enabledModules,
    approval_threshold_egp:  row.approval_threshold_egp   ?? DEFAULTS.approval_threshold_egp,
    fiscal_year_current:     row.fiscal_year_current      ?? DEFAULTS.fiscal_year_current,
  }
}

/**
 * Partial config update. Only persists known CompanyConfig fields.
 * Caller is responsible for authorization — do not call from untrusted context.
 */
export async function patchCompanyConfig(
  db:        D1Database,
  companyId: number,
  patch: Partial<Pick<CompanyConfig,
    | 'vat_pct' | 'vat_registered' | 'vat_number'
    | 'costing_method' | 'base_currency'
    | 'fiscal_year_start_month' | 'ar_locale'
    | 'enabled_modules' | 'approval_threshold_egp'
    | 'fiscal_year_current'
  >>,
): Promise<void> {
  const sets: string[] = []
  const vals: unknown[] = []

  if (patch.vat_pct                !== undefined) { sets.push('vat_pct = ?');                 vals.push(patch.vat_pct) }
  if (patch.vat_registered         !== undefined) { sets.push('vat_registered = ?');          vals.push(patch.vat_registered ? 1 : 0) }
  if ('vat_number'                  in patch)      { sets.push('vat_number = ?');              vals.push(patch.vat_number ?? null) }
  if (patch.costing_method         !== undefined) { sets.push('costing_method = ?');           vals.push(patch.costing_method) }
  if (patch.base_currency          !== undefined) { sets.push('base_currency_code = ?');       vals.push(patch.base_currency) }
  if (patch.fiscal_year_start_month !== undefined) { sets.push('fiscal_year_start_month = ?'); vals.push(patch.fiscal_year_start_month) }
  if (patch.ar_locale              !== undefined) { sets.push('ar_locale = ?');                vals.push(patch.ar_locale) }
  if ('enabled_modules'             in patch)      { sets.push('enabled_modules = ?');         vals.push(patch.enabled_modules ? JSON.stringify(patch.enabled_modules) : null) }
  if ('approval_threshold_egp'      in patch)      { sets.push('approval_threshold_egp = ?'); vals.push(patch.approval_threshold_egp ?? null) }
  if (patch.fiscal_year_current    !== undefined) { sets.push('fiscal_year_current = ?');      vals.push(patch.fiscal_year_current) }

  if (sets.length === 0) return

  vals.push(companyId)
  await db.prepare(
    `UPDATE companies SET ${sets.join(', ')} WHERE id = ?`,
  ).bind(...vals).run()
}

/**
 * Utility: format a number using the company's Arabic locale.
 * Used wherever EGP amounts are rendered server-side (e.g. PDF generation).
 */
export function formatAmount(amount: number, cfg: CompanyConfig): string {
  return new Intl.NumberFormat(cfg.ar_locale, {
    style:                 'currency',
    currency:              cfg.base_currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Returns fiscal year boundaries for a given calendar year,
 * respecting the company's fiscal_year_start_month.
 *
 * Example: fiscal_year_start_month=7 (July), year=2026
 *   → { start: '2026-07-01', end: '2027-06-30' }
 */
export function getFiscalYearBounds(
  cfg:          CompanyConfig,
  calendarYear: number,
): { start: string; end: string } {
  const m    = cfg.fiscal_year_start_month
  const start = `${calendarYear}-${String(m).padStart(2, '0')}-01`
  const endYear  = m === 1 ? calendarYear : calendarYear + 1
  const endMonth = m === 1 ? 12 : m - 1
  const endDay   = new Date(endYear, endMonth, 0).getDate()
  const end   = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
  return { start, end }
}
