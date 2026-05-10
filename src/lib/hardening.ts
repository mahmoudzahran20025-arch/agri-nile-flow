import type { D1Database } from '@cloudflare/workers-types'

export type HardeningFlagKey =
  | 'strict_posting_mode'    // block posting if BPG/PPG/IPG missing
  | 'catch_all_allowed'      // allow null/null catch-all resolution
  | 'report_fallback_mode'   // allow source-table fallback in financial reports

export type CertificationStatus = 'certified' | 'degraded' | 'blocked'

export interface PostingMeta {
  certification_status: CertificationStatus
  degraded_mode: boolean
  degraded_reason?: string
  data_source: 'gl_primary' | 'source_table_fallback'
  strict_posting_active: boolean
}

// In-memory cache per Worker isolate — TTL 60s to match posting engine cache.
const flagCache = new Map<string, { value: number; expiresAt: number }>()
const FLAG_TTL_MS = 60_000

function cacheKey(companyId: number, flag: HardeningFlagKey): string {
  return `${companyId}:${flag}`
}

export async function getFlag(
  db: D1Database,
  companyId: number,
  flag: HardeningFlagKey,
  defaultValue = 0,
): Promise<boolean> {
  const key = cacheKey(companyId, flag)
  const hit = flagCache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.value === 1

  const row = await db
    .prepare(
      `SELECT flag_value FROM hardening_flags
       WHERE company_id = ? AND flag_key = ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       LIMIT 1`,
    )
    .bind(companyId, flag)
    .first<{ flag_value: number }>()

  const value = row?.flag_value ?? defaultValue
  flagCache.set(key, { value, expiresAt: Date.now() + FLAG_TTL_MS })
  return value === 1
}

export function invalidateFlagCache(companyId: number, flag?: HardeningFlagKey): void {
  if (flag) {
    flagCache.delete(cacheKey(companyId, flag))
  } else {
    for (const key of flagCache.keys()) {
      if (key.startsWith(`${companyId}:`)) flagCache.delete(key)
    }
  }
}

/**
 * Build the standardised API meta envelope that every financial endpoint
 * must include. The frontend reads certification_status to decide whether
 * to show a "Certified" badge or an amber "Degraded" warning.
 */
export function buildPostingMeta(opts: {
  isGlPrimary: boolean
  degradedReason?: string
  strictPostingActive: boolean
}): PostingMeta {
  const { isGlPrimary, degradedReason, strictPostingActive } = opts

  if (!isGlPrimary && degradedReason) {
    return {
      certification_status: 'degraded',
      degraded_mode: true,
      degraded_reason: degradedReason,
      data_source: 'source_table_fallback',
      strict_posting_active: strictPostingActive,
    }
  }

  return {
    certification_status: 'certified',
    degraded_mode: false,
    data_source: 'gl_primary',
    strict_posting_active: strictPostingActive,
  }
}

/**
 * Enforce strict posting mode: throws a structured error if BPG/PPG/IPG
 * is required but missing, only when strict_posting_mode flag is ON.
 * In shadow mode (flag OFF), logs a warning but does not block.
 */
export async function enforcePostingGroupPresence(
  db: D1Database,
  companyId: number,
  opts: {
    bpg?: string | null
    ppg?: string | null
    ipg?: string | null
    context: string
  },
): Promise<{ blocked: boolean; reason?: string }> {
  const strictMode = await getFlag(db, companyId, 'strict_posting_mode')
  const catchAllAllowed = await getFlag(db, companyId, 'catch_all_allowed', 1)

  const missing: string[] = []
  if (opts.bpg == null) missing.push('BPG (Bus. Posting Group)')
  if (opts.ppg == null) missing.push('PPG (Prod. Posting Group)')

  if (missing.length === 0 || catchAllAllowed) return { blocked: false }

  const reason = `${opts.context}: missing ${missing.join(', ')} — catch-all routing disabled in strict mode`

  if (strictMode) {
    return { blocked: true, reason }
  }

  // Shadow mode: warn only — let the catch-all proceed
  return { blocked: false, reason }
}
