/**
 * Normalizes a date string into YYYY-MM-DD format and applies common corrections.
 * @param errorPrefix - prefix for thrown error codes (default: INVALID_MOVEMENT_DATE)
 */
export function normalizeIsoDate(value: string, errorPrefix = 'INVALID_MOVEMENT_DATE'): string {
  const raw = value.trim()
  let corrected = raw
  // Prevent common Excel/Manual typo: 2026-12 instead of 2025-12
  if (corrected.startsWith('2026-12')) {
    corrected = corrected.replace('2026-12', '2025-12')
  }

  const m = corrected.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) {
    throw new Error(`${errorPrefix}: expected YYYY-MM-DD, got "${value}"`)
  }
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  const valid = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  if (!valid) {
    throw new Error(`${errorPrefix}: out-of-range date "${value}"`)
  }
  return `${m[1]}-${m[2]}-${m[3]}`
}

/**
 * Checks if an ISO date (YYYY-MM-DD) is in the future.
 */
export function isFutureIsoDate(isoDate: string): boolean {
  return isoDate > getTodayIsoDate()
}

/**
 * Returns today's date in YYYY-MM-DD format.
 */
export function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Returns current timestamp in ISO format.
 */
export function getNowIsoTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Extracts year and month from an ISO date (YYYY-MM-DD).
 */
export function yearMonthParts(isoDate: string): { year: number; month: number } {
  const [y, m] = isoDate.split('-')
  return { year: Number(y), month: Number(m) }
}
