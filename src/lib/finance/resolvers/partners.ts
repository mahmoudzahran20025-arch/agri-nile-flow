import type { D1Database } from '@cloudflare/workers-types'
import {
  resolvePartnerCapital as peResolveCapital,
  resolvePartnerCurrent as peResolveCurrent,
  resolveControlAccount,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'

export async function resolvePartnerCapital(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    amount: number
    date: string
    description: string
    partner_id: number
    created_by?: number
    direction?: 'injection' | 'withdrawal'
    financial_account_id?: number
  },
): Promise<number | null> {
  const [cashAccRow, equityAcc] = await Promise.all([
    opts.financial_account_id
      ? db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ?').bind(opts.financial_account_id).first<{ gl_account_code: string }>()
      : Promise.resolve(null),
    resolveControlAccount(db, opts.company_id, 'equity'),
  ])

  const cashAcc = cashAccRow?.gl_account_code || (await resolveControlAccount(db, opts.company_id, 'cash')) || ''
  const isReceipt = opts.direction !== 'withdrawal'

  const blueprint = await peResolveCapital(
    db, 
    opts.company_id, 
    cashAcc, 
    equityAcc || '', 
    opts.amount, 
    isReceipt,
    opts.description
  )

  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`PARTNER_CAPITAL_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'partner_capital',
    source_module: 'treasury',
    source_id:     opts.ref_id,
    source_link_id: opts.ref_id,
    event_date:    opts.date,
    description:   `رأس مال شريك | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { partner_id: opts.partner_id, amount: opts.amount },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l: any) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `رأس مال شريك | ${opts.description}`,
      rule_slot:     l.rule_slot,
      source_ledger: 'cash',
      source_record_id: opts.ref_id,
    })),
  })
}

export async function resolvePartnerCurrent(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    amount: number
    date: string
    description: string
    partner_id: number
    created_by?: number
    direction?: 'deposit' | 'withdrawal'
    financial_account_id?: number
  },
): Promise<number | null> {
  const [cashAccRow, currentAcc] = await Promise.all([
    opts.financial_account_id
      ? db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ?').bind(opts.financial_account_id).first<{ gl_account_code: string }>()
      : Promise.resolve(null),
    resolveControlAccount(db, opts.company_id, 'partner_current_account'),
  ])

  const cashAcc = cashAccRow?.gl_account_code || (await resolveControlAccount(db, opts.company_id, 'cash')) || ''
  const isReceipt = opts.direction === 'deposit'

  const blueprint = await peResolveCurrent(
    db, 
    opts.company_id, 
    cashAcc, 
    currentAcc || '', 
    opts.amount, 
    isReceipt,
    opts.description
  )

  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`PARTNER_CURRENT_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'partner_current',
    source_module: 'treasury',
    source_id:     opts.ref_id,
    source_link_id: opts.ref_id,
    event_date:    opts.date,
    description:   `جاري شريك | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { partner_id: opts.partner_id, amount: opts.amount },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l: any) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `جاري شريك | ${opts.description}`,
      rule_slot:     l.rule_slot,
      source_ledger: 'cash',
      source_record_id: opts.ref_id,
    })),
  })
}
