// GL fiscal period helpers — shared across all reporting pages.
// Period data comes from glApi.periods(); never derive reporting windows from system time.

export interface GlPeriod {
  id:          number
  name:        string
  period_type: string   // 'monthly' | 'annual' | ...
  start_date:  string   // ISO date 'YYYY-MM-DD'
  end_date:    string
  is_closed:   number   // 0 = open, 1 = closed
  closed_at?:  string | null
}

/** Period whose date range contains today and is still open. */
export function findActivePeriod(periods: GlPeriod[]): GlPeriod | undefined {
  const today = new Date().toISOString().slice(0, 10)
  return periods
    .filter(p => !p.is_closed && p.start_date <= today && today <= p.end_date)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0]
}

/**
 * Earliest start_date among open periods — used as the default P&L / Trial Balance
 * reporting window start.  Falls back to the earliest period ever if all are closed,
 * and to the current calendar year if no periods exist at all.
 */
export function fiscalYearStart(periods: GlPeriod[]): string {
  const open = periods.filter(p => !p.is_closed).sort((a, b) => a.start_date.localeCompare(b.start_date))
  if (open.length) return open[0].start_date
  const all = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date))
  return all[0]?.start_date ?? `${new Date().getFullYear()}-01-01`
}

/** Latest end_date among open periods — default P&L window end. */
export function fiscalYearEnd(periods: GlPeriod[]): string {
  const today = new Date().toISOString().slice(0, 10)
  const open = periods.filter(p => !p.is_closed).sort((a, b) => b.end_date.localeCompare(a.end_date))
  if (open.length) return open[0].end_date > today ? today : open[0].end_date
  return today
}

/** Human-readable label for a period dropdown option. */
export function periodLabel(p: GlPeriod): string {
  return `${p.name}  (${p.start_date} → ${p.end_date})`
}
