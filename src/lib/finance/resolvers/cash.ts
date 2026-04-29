import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveCashTransaction as peResolveCash,
  resolveExpensePosting as peResolveExpense,
  resolveSalesRevenue as peResolveSalesRevenue,
  resolveControlAccount,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'

export async function resolveCashLedger(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    financial_account_id?: number | null
    direction: 'د' | 'م'
    amount: number
    date: string
    description: string
    created_by?: number
    center_code?: number
    expense_code?: string | null
    supplier_code?: number | null
    partner_id?: number | null
  },
): Promise<number | null> {
  const cashAcc = opts.financial_account_id
    ? (await db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ?').bind(opts.financial_account_id).first<{ gl_account_code: string }>())?.gl_account_code || ''
    : (await resolveControlAccount(db, opts.company_id, 'cash')) || ''

  // Determine contra account
  let contraAcc = ''
  if (opts.expense_code) {
    const et = await db.prepare('SELECT gl_account_code FROM expense_types WHERE code = ? AND company_id = ?')
      .bind(opts.expense_code, opts.company_id).first<{ gl_account_code: string }>()
    if (et?.gl_account_code) contraAcc = et.gl_account_code
  }
  if (!contraAcc) {
    const key = opts.partner_id ? 'partner_current_account' : opts.supplier_code ? 'accounts_payable' : (opts.direction === 'د' ? 'revenue_default' : 'expense_default')
    contraAcc = (await resolveControlAccount(db, opts.company_id, key)) || ''
  }

  const blueprint = await peResolveCash(
    db,
    opts.company_id,
    cashAcc,
    contraAcc,
    opts.amount,
    opts.direction === 'د', // isReceipt
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`CASH_LEDGER_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  const lines = blueprint.lines

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'cash_transaction',
    source_module: 'treasury',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `${opts.direction === 'د' ? 'قبض' : 'صرف'} | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { direction: opts.direction, amount: opts.amount, financial_account_id: opts.financial_account_id },
    trace:         blueprint.trace ?? null,
    lines:         lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `${opts.direction === 'د' ? 'قبض' : 'صرف'} | ${opts.description}`,
      center_code:   opts.center_code,
      rule_slot:     l.rule_slot,
      source_ledger: 'cash' as const,
      source_record_id: opts.ref_id,
    })),
  })
}

export async function resolveExpensePosting(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    amount: number
    date: string
    description: string
    created_by?: number
    center_code?: number
    expense_account?: string
  },
): Promise<number | null> {
  const cashAcc = await resolveControlAccount(db, opts.company_id, 'cash')
  const expAcc = opts.expense_account || (await resolveControlAccount(db, opts.company_id, 'expense_default'))

  const blueprint = await peResolveExpense(
    db,
    opts.company_id,
    null,
    null,
    cashAcc || '',
    opts.amount,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`EXPENSE_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  const lines = blueprint.lines.map((l) => {
    if (l.rule_slot?.includes('expense') && expAcc) {
      return { ...l, account_code: expAcc }
    }
    return l
  })

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'expense',
    source_module: 'treasury',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `مصروفات | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount, expense_account: expAcc },
    trace:         blueprint.trace ?? null,
    lines:         lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `مصروفات | ${opts.description}`,
      center_code:   opts.center_code,
      rule_slot:     l.rule_slot,
      source_ledger: 'cash' as const,
      source_record_id: opts.ref_id,
    })),
  })
}

export async function resolveSalesRevenue(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    amount: number
    date: string
    description: string
    created_by?: number
    center_code?: number
    season_id?: number
    field_id?: number
  },
): Promise<number | null> {
  const arAcc = await resolveControlAccount(db, opts.company_id, 'accounts_receivable')

  const blueprint = await peResolveSalesRevenue(
    db,
    opts.company_id,
    null,
    null,
    arAcc || '',
    opts.amount,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`SALES_REVENUE_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'revenue',
    source_module: 'operations',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `إيرادات | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount, season_id: opts.season_id, field_id: opts.field_id },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `إيرادات | ${opts.description}`,
      center_code:   opts.center_code,
      season_id:     opts.season_id,
      field_id:      opts.field_id,
      rule_slot:     l.rule_slot,
      source_ledger: 'cash' as const,
      source_record_id: opts.ref_id,
    })),
  })
}
