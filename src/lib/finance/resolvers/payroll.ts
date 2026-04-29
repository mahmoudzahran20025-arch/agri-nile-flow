import type { D1Database } from '@cloudflare/workers-types'
import {
  resolvePayrollPosting as peResolvePayroll,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'

export async function resolvePayrollPosting(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    amount: number
    date: string
    description: string
    created_by?: number
    center_code?: number
    season_id?: number | null
    field_id?: number | null
  },
): Promise<number | null> {
  const wagesAcc = '5100' // Default wages expense account
  const wagesPayableAcc = '2101' // Default wages payable account
  const blueprint = await peResolvePayroll(
    db,
    opts.company_id,
    wagesAcc,
    wagesPayableAcc,
    opts.amount,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`PAYROLL_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'payroll_run',
    source_module: 'hr',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `رواتب | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount, season_id: opts.season_id, field_id: opts.field_id },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `رواتب | ${opts.description}`,
      center_code:   opts.center_code,
      season_id:     opts.season_id ?? undefined,
      field_id:      opts.field_id ?? undefined,
      rule_slot:     l.rule_slot,
      source_ledger: 'payroll' as const,
      source_record_id: opts.ref_id,
    })),
  })
}

export async function resolvePayrollPayment(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    amount: number
    date: string
    description: string
    created_by?: number
  },
): Promise<number | null> {
  // Payroll payment: DR Wages Payable / CR Cash
  const wagesPayableAcc = '2101' // Wages Payable - should come from posting setup
  const cashAcc = '1001' // Cash - should come from posting setup

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'payroll_payment',
    source_module: 'hr',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `صرف رواتب | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount },
    lines:         [
      { account_code: wagesPayableAcc, debit: opts.amount, credit: 0, description: `صرف رواتب | ${opts.description}`, rule_slot: 'wages_payable' },
      { account_code: cashAcc, debit: 0, credit: opts.amount, description: `صرف رواتب | ${opts.description}`, rule_slot: 'cash' },
    ],
  })
}
