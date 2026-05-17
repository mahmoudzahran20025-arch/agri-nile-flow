/**
 * Shared API-layer helpers.
 * Thin DB utilities used by multiple domain routers (suppliers, treasury, etc.).
 * No business logic here — only generic guards and lookups.
 */
import type { D1Database } from '@cloudflare/workers-types'

export async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
  ).bind(tableName).first<{ ok: number }>()
  return !!row?.ok
}

export async function tableColumnExists(
  db: D1Database,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const { results } = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>()
  return (results ?? []).some((r) => r.name === columnName)
}

/**
 * Validates that a service_type_code is active in service_types.
 * Falls back to the legacy expense_types table during the deprecation window.
 */
export async function isKnownServiceTypeCode(
  db: D1Database,
  company_id: number,
  code: string,
): Promise<boolean> {
  const normalized = code.trim()
  if (!normalized) return false

  if (await tableExists(db, 'service_types')) {
    const row = await db.prepare(
      'SELECT 1 AS ok FROM service_types WHERE company_id = ? AND code = ? AND is_active = 1 LIMIT 1'
    ).bind(company_id, normalized).first<{ ok: number }>()
    if (row?.ok) return true
  }

  // Legacy fallback — expense_types is deprecated; new callers should not reach this path.
  const legacyByCode = await db.prepare(
    'SELECT 1 AS ok FROM expense_types WHERE company_id = ? AND CAST(code AS TEXT) = ? LIMIT 1'
  ).bind(company_id, normalized).first<{ ok: number }>()
  if (legacyByCode?.ok) return true

  const legacyByName = await db.prepare(
    'SELECT 1 AS ok FROM expense_types WHERE company_id = ? AND TRIM(name) = ? LIMIT 1'
  ).bind(company_id, normalized).first<{ ok: number }>()
  return !!legacyByName?.ok
}

/** Returns true if the text contains a governance tag that must not appear in user-facing narrations. */
export function hasTechnicalGovernanceTag(text?: string | null): boolean {
  if (!text) return false
  return /\b(NEEDS_DIMENSION|NEEDS_POSTING_LINK|MISSING_DIMENSION|MISSING_POSTING_LINK)\b/i.test(text)
}
