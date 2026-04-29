import type { D1Database } from '@cloudflare/workers-types'
import { postFromBusinessEvent } from '../business_events'
import { resolveControlAccount } from '../../posting_engine'

export async function resolvePartnerCapital(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    partner_id: number
    amount: number
    date: string
    description: string
    direction: 'injection' | 'withdrawal'
    created_by?: number
  },
): Promise<number | null> {
  const cashAcc = await resolveControlAccount(db, opts.company_id, 'cash')
  const equityAcc = await resolveControlAccount(db, opts.company_id, 'partner_capital')

  if (!cashAcc || !equityAcc) {
    throw new Error('PARTNER_CAPITAL_POSTING_BLOCKED: Missing cash or equity account mapping')
  }

  const isInjection = opts.direction === 'injection'

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'partner_capital',
    source_module: 'partners',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `${isInjection ? 'تمويل' : 'سحب'} رأس مال | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { partner_id: opts.partner_id, amount: opts.amount, direction: opts.direction },
    lines:         [
      { account_code: isInjection ? cashAcc : equityAcc, debit: opts.amount, credit: 0, description: `${isInjection ? 'تمويل' : 'سحب'} رأس مال | ${opts.description}`, rule_slot: isInjection ? 'cash' : 'equity' },
      { account_code: isInjection ? equityAcc : cashAcc, debit: 0, credit: opts.amount, description: `${isInjection ? 'تمويل' : 'سحب'} رأس مال | ${opts.description}`, rule_slot: isInjection ? 'equity' : 'cash' },
    ],
  })
}

export async function resolvePartnerCurrent(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    partner_id: number
    amount: number
    date: string
    description: string
    direction: 'deposit' | 'withdrawal'
    created_by?: number
  },
): Promise<number | null> {
  const cashAcc = await resolveControlAccount(db, opts.company_id, 'cash')
  const currentAcc = await resolveControlAccount(db, opts.company_id, 'partner_current_account')

  if (!cashAcc || !currentAcc) {
    throw new Error('PARTNER_CURRENT_POSTING_BLOCKED: Missing cash or current account mapping')
  }

  const isDeposit = opts.direction === 'deposit'

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'partner_current',
    source_module: 'partners',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `${isDeposit ? 'إيداع' : 'سحب'} حساب جاري | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { partner_id: opts.partner_id, amount: opts.amount, direction: opts.direction },
    lines:         [
      { account_code: isDeposit ? cashAcc : currentAcc, debit: opts.amount, credit: 0, description: `${isDeposit ? 'إيداع' : 'سحب'} حساب جاري | ${opts.description}`, rule_slot: isDeposit ? 'cash' : 'current' },
      { account_code: isDeposit ? currentAcc : cashAcc, debit: 0, credit: opts.amount, description: `${isDeposit ? 'إيداع' : 'سحب'} حساب جاري | ${opts.description}`, rule_slot: isDeposit ? 'current' : 'cash' },
    ],
  })
}
