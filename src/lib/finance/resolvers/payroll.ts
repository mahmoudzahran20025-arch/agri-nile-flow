import type { D1Database } from '@cloudflare/workers-types'
import {
  resolvePayrollPosting as peResolvePayrollPosting,
  resolveControlAccount,
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
  },
): Promise<number | null> {
  const [wagesAcc, wagesPayableAcc] = await Promise.all([
    resolveControlAccount(db, opts.company_id, 'wages_expense'),
    resolveControlAccount(db, opts.company_id, 'wages_payable'),
  ])

  const blueprint = await peResolvePayrollPosting(
    db, 
    opts.company_id, 
    wagesAcc || '', 
    wagesPayableAcc || '', 
    opts.amount,
    opts.description
  )

  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`PAYROLL_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'payroll_accrual',
    source_module: 'payroll',
    source_id:     opts.ref_id,
    source_link_id: opts.ref_id,
    event_date:    opts.date,
    description:   `استحقاق رواتب | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l: any) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `استحقاق رواتب | ${opts.description}`,
      rule_slot:     l.rule_slot,
      source_ledger: 'payroll',
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
    financial_account_id?: number | null
    created_by?: number
  },
): Promise<number | null> {
  const [cashAccRow, wagesPayableAcc] = await Promise.all([
    opts.financial_account_id
      ? db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ? AND company_id = ?').bind(opts.financial_account_id, opts.company_id).first<{ gl_account_code: string }>()
      : Promise.resolve(null),
    resolveControlAccount(db, opts.company_id, 'wages_payable'),
  ])

  const cashAcc = cashAccRow?.gl_account_code || (await resolveControlAccount(db, opts.company_id, 'cash')) || ''
  
  // Payroll payment is a cash transaction: Debit Wages Payable, Credit Cash
  const blueprint = await peResolvePayrollPosting(
    db,
    opts.company_id,
    wagesPayableAcc || '',
    cashAcc,
    opts.amount,
    opts.description
  )

  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`PAYROLL_PAYMENT_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'payroll_payment',
    source_module: 'payroll',
    source_id:     opts.ref_id,
    source_link_id: opts.ref_id,
    event_date:    opts.date,
    description:   `صرف رواتب | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount, financial_account_id: opts.financial_account_id },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l: any) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `صرف رواتب | ${opts.description}`,
      rule_slot:     l.rule_slot,
      source_ledger: 'cash',
      source_record_id: opts.ref_id,
    })),
  })
}
