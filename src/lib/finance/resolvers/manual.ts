import type { D1Database } from '@cloudflare/workers-types'
import { postFromBusinessEvent } from '../business_events'

export async function postManualEntry(
  db: D1Database,
  opts: {
    company_id: number
    date: string
    description: string
    lines: Array<{
      account_code: string
      debit: number
      credit: number
      description?: string
      center_code?: number
      season_id?: number
      field_id?: number
      rule_slot?: string
    }>
    created_by?: number
  },
): Promise<number | null> {
  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'manual_journal',
    source_module: 'gl',
    source_id:     0,
    event_date:    opts.date,
    description:   opts.description,
    created_by:    opts.created_by,
    payload:       { manual_entry: true, line_count: opts.lines.length },
    lines:         opts.lines.map((l) => ({
      account_code: l.account_code,
      debit:        l.debit,
      credit:       l.credit,
      description:  l.description ?? opts.description,
      center_code:  l.center_code,
      season_id:    l.season_id,
      field_id:     l.field_id,
      rule_slot:    l.rule_slot ?? 'manual_line',
    })),
  })
}

export async function postManualReversal(
  db: D1Database,
  opts: {
    company_id: number
    original_entry_id: number
    date: string
    reason: string
    lines: Array<{
      account_code: string
      debit: number
      credit: number
      description?: string
      center_code?: number
      season_id?: number
      field_id?: number
      rule_slot?: string
    }>
    created_by?: number
  },
): Promise<number | null> {
  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'reversal',
    source_module: 'gl',
    source_id:     opts.original_entry_id,
    event_date:    opts.date,
    description:   `عكس قيد #${opts.original_entry_id}: ${opts.reason}`,
    created_by:    opts.created_by,
    payload:       { original_entry_id: opts.original_entry_id, reason: opts.reason, reversal: true },
    lines:         opts.lines.map((l) => ({
      account_code: l.account_code,
      debit:        l.debit,
      credit:       l.credit,
      description:  l.description ?? `عكس قيد #${opts.original_entry_id}`,
      center_code:  l.center_code,
      season_id:    l.season_id,
      field_id:     l.field_id,
      rule_slot:    l.rule_slot ?? 'reversal_line',
    })),
  })
}
