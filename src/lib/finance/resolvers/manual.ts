import type { D1Database } from '@cloudflare/workers-types'
import { postFromBusinessEvent } from '../business_events'

export async function postManualEntry(
  db: D1Database,
  opts: {
    company_id: number
    ref_id?: number // Optional for direct manual calls
    amount?: number // Derivable from lines if missing
    date: string
    description: string
    created_by?: number
    lines: Array<{ account_code: string; debit: number; credit: number; description?: string; center_code?: number; season_id?: number; field_id?: number }>
  },
): Promise<number | null> {
  const refId = opts.ref_id ?? 0
  const amount = opts.amount ?? opts.lines.reduce((s, l) => s + (l.debit || 0), 0)

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'manual_entry',
    source_module: 'manual',
    source_id:     refId,
    source_link_id: refId,
    event_date:    opts.date,
    description:   opts.description,
    created_by:    opts.created_by,
    payload:       { amount },
    lines:         opts.lines.map(l => ({ ...l, source_ledger: 'manual', source_record_id: refId })),
  })
}

export async function postManualReversal(
  db: D1Database,
  opts: {
    company_id: number
    ref_id?: number
    original_entry_id: number
    date: string
    description: string
    created_by?: number
    lines: Array<{ account_code: string; debit: number; credit: number; description?: string; center_code?: number; season_id?: number; field_id?: number }>
  },
): Promise<number | null> {
  const refId = opts.ref_id ?? opts.original_entry_id

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'manual_reversal',
    source_module: 'manual',
    source_id:     refId,
    source_link_id: refId,
    event_date:    opts.date,
    description:   opts.description,
    created_by:    opts.created_by,
    payload:       { original_entry_id: opts.original_entry_id },
    lines:         opts.lines.map(l => ({ ...l, source_ledger: 'manual', source_record_id: refId })),
  })
}
