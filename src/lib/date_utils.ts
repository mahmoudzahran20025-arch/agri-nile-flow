// Re-export from the canonical location (src/lib/utils/date.ts).
// This shim satisfies the TARGET_ARCHITECTURE.md Phase C path contract
// without breaking existing imports that already reference utils/date directly.
export {
  normalizeIsoDate,
  isFutureIsoDate,
  getTodayIsoDate,
  getNowIsoTimestamp,
  yearMonthParts,
} from './utils/date'
