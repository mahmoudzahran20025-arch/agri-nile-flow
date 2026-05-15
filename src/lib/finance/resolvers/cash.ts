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
    season_id?: number
    field_id?: number
    expense_code?: string | null
    supplier_code?: number | null
    partner_id?: number | null
    contra_account?: string | null
  },
): Promise<number | null> {
  const cashAcc = opts.financial_account_id
    ? (await db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ?').bind(opts.financial_account_id).first<{ gl_account_code: string }>())?.gl_account_code || ''
    : (await resolveControlAccount(db, opts.company_id, 'cash')) || ''

  let contraAcc = opts.contra_account || ''
  let contraResolution = opts.contra_account ? `explicit:${opts.contra_account}` : ''

  if (!contraAcc && opts.expense_code) {
    const et = await db.prepare('SELECT gl_account_code, name FROM expense_types WHERE code = ? AND company_id = ?')
      .bind(opts.expense_code, opts.company_id).first<{ gl_account_code: string; name: string }>()
    if (et?.gl_account_code) {
      contraAcc = et.gl_account_code
      contraResolution = `expense_code:${opts.expense_code}(${et.name})`
    } else {
      throw new Error(`CASH_EXPENSE_ACCOUNT_MISSING: expense_code="${opts.expense_code}" not found.`)
    }
  }

  if (!contraAcc) {
    const key = opts.partner_id && opts.direction === 'د'
      ? 'equity'
      : opts.partner_id
        ? 'partner_current_account'
        : opts.supplier_code
          ? 'accounts_payable'
          : opts.direction === 'د' ? 'revenue_default' : 'expense_default'
    contraAcc = (await resolveControlAccount(db, opts.company_id, key)) || ''
    if (!contraAcc && opts.partner_id) {
      contraAcc = (await resolveControlAccount(db, opts.company_id, 'equity')) || ''
      contraResolution = `control:equity(${key}:missing)`
    } else {
      contraResolution = contraResolution || `control:${key}`
    }
  }

  const dims = {
    center_code: opts.center_code,
    season_id:   opts.season_id,
    field_id:    opts.field_id,
  }

  const blueprint = await peResolveCash(
    db, 
    opts.company_id, 
    cashAcc, 
    contraAcc, 
    opts.amount, 
    opts.direction === 'د',
    opts.description,
    dims
  )
  
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`CASH_LEDGER_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'cash_transaction',
    source_module: 'treasury',
    source_id:     opts.ref_id,
    source_link_id: opts.ref_id,
    event_date:    opts.date,
    description:   `${opts.direction === 'د' ? 'قبض' : 'صرف'} | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { direction: opts.direction, amount: opts.amount, financial_account_id: opts.financial_account_id, contra_resolution: contraResolution },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l: any) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `${opts.direction === 'د' ? 'قبض' : 'صرف'} | ${opts.description}`,
      center_code:   opts.center_code,
      season_id:     opts.season_id,
      field_id:      opts.field_id,
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
    financial_account_id?: number
    center_code?: number
    season_id?: number
    field_id?: number
    created_by?: number
    bpg_code?: string | null
    ppg_code?: string | null
  },
): Promise<number | null> {
  const [cashAccRow] = await Promise.all([
    opts.financial_account_id
      ? db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ? AND company_id = ?').bind(opts.financial_account_id, opts.company_id).first<{ gl_account_code: string }>()
      : Promise.resolve(null),
  ])

  const cashAcc = cashAccRow?.gl_account_code || (await resolveControlAccount(db, opts.company_id, 'cash')) || ''
  
  const dims = {
    center_code: opts.center_code,
    season_id:   opts.season_id,
    field_id:    opts.field_id,
  }

  // Resolve from posting engine using BPG/PPG
  const blueprint = await peResolveExpense(
    db, 
    opts.company_id, 
    opts.bpg_code ?? null, 
    opts.ppg_code ?? null, 
    cashAcc, 
    opts.amount,
    undefined, 
    opts.description,
    dims
  )

  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`EXPENSE_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'expense',
    source_module: 'treasury',
    source_id:     opts.ref_id,
    source_link_id: opts.ref_id,
    event_date:    opts.date,
    description:   `مصروف | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount, financial_account_id: opts.financial_account_id },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l: any) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `مصروف | ${opts.description}`,
      center_code:   opts.center_code,
      season_id:     opts.season_id,
      field_id:      opts.field_id,
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
    financial_account_id?: number
    center_code?: number
    season_id?: number
    field_id?: number
    created_by?: number
    bpg_code?: string | null
    ppg_code?: string | null
  },
): Promise<number | null> {
  const [cashAccRow] = await Promise.all([
    opts.financial_account_id
      ? db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ? AND company_id = ?').bind(opts.financial_account_id, opts.company_id).first<{ gl_account_code: string }>()
      : Promise.resolve(null),
  ])

  const cashAcc = cashAccRow?.gl_account_code || (await resolveControlAccount(db, opts.company_id, 'cash')) || ''
  
  const dims = {
    center_code: opts.center_code,
    season_id:   opts.season_id,
    field_id:    opts.field_id,
  }

  // Resolve from posting engine
  const blueprint = await peResolveSalesRevenue(
    db, 
    opts.company_id, 
    opts.bpg_code ?? null, 
    opts.ppg_code ?? null, 
    cashAcc, 
    opts.amount,
    opts.description,
    dims
  )

  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`REVENUE_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'revenue',
    source_module: 'treasury',
    source_id:     opts.ref_id,
    source_link_id: opts.ref_id,
    event_date:    opts.date,
    description:   `إيراد | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount, financial_account_id: opts.financial_account_id },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l: any) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `إيراد | ${opts.description}`,
      center_code:   opts.center_code,
      season_id:     opts.season_id,
      field_id:      opts.field_id,
      rule_slot:     l.rule_slot,
      source_ledger: 'cash' as const,
      source_record_id: opts.ref_id,
    })),
  })
}
