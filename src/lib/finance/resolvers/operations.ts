import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveWorkOrderLabor as peResolveWorkOrderLabor,
  resolveControlAccount,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'

export async function resolveWorkOrderLabor(
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
  const cogsAcc = '5101' // Default COGS account
  const wagesPayableAcc = '2101' // Default wages payable account
  const blueprint = await peResolveWorkOrderLabor(
    db,
    opts.company_id,
    cogsAcc,
    wagesPayableAcc,
    opts.amount,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`WORK_ORDER_LABOR_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'work_order_labor',
    source_module: 'operations',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `عمليات إنتاج | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount, season_id: opts.season_id, field_id: opts.field_id },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `عمليات إنتاج | ${opts.description}`,
      center_code:   opts.center_code,
      season_id:     opts.season_id ?? undefined,
      field_id:      opts.field_id ?? undefined,
      rule_slot:     l.rule_slot,
      source_ledger: 'payroll' as const,
      source_record_id: opts.ref_id,
    })),
  })
}

export async function resolveContractAdvance(
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
  // Contract advance: DR Contract Advances (Asset) / CR Cash
  const contractAdvanceAcc = await resolveControlAccount(db, opts.company_id, 'contract_advances') || '1205'
  const cashAcc = await resolveControlAccount(db, opts.company_id, 'cash') || '1001'

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'contract_advance',
    source_module: 'contracts',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `سلفة عقد | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount },
    lines:         [
      { account_code: contractAdvanceAcc, debit: opts.amount, credit: 0, description: `سلفة عقد | ${opts.description}`, rule_slot: 'contract_advance' },
      { account_code: cashAcc, debit: 0, credit: opts.amount, description: `سلفة عقد | ${opts.description}`, rule_slot: 'cash' },
    ],
  })
}
