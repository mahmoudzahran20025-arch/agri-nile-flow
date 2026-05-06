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
    contra_account?: string | null
  },
): Promise<number | null> {
  const cashAcc = opts.financial_account_id
    ? (await db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ?').bind(opts.financial_account_id).first<{ gl_account_code: string }>())?.gl_account_code || ''
    : (await resolveControlAccount(db, opts.company_id, 'cash')) || ''

  // Determine contra account — explicit resolution chain with audit trail
  let contraAcc = opts.contra_account || ''
  let contraResolution = opts.contra_account ? `explicit:${opts.contra_account}` : ''  // tracks how contra was resolved, stored in payload

  if (!contraAcc && opts.expense_code) {
    const et = await db.prepare('SELECT gl_account_code, name FROM expense_types WHERE code = ? AND company_id = ?')
      .bind(opts.expense_code, opts.company_id).first<{ gl_account_code: string; name: string }>()
    if (et?.gl_account_code) {
      contraAcc = et.gl_account_code
      contraResolution = `expense_code:${opts.expense_code}(${et.name})`
    } else {
      // expense_code exists in request but not found in expense_types — warn, don't silently skip
      console.warn(`[cash.ts] expense_code=${opts.expense_code} not found in expense_types for company_id=${opts.company_id} — falling to control account`)
      contraResolution = `expense_code:${opts.expense_code}:MISSING→fallback`
    }
  }

  if (!contraAcc) {
    const key = opts.partner_id
      ? 'partner_current_account'
      : opts.supplier_code
        ? 'accounts_payable'
        : opts.direction === 'د' ? 'revenue_default' : 'expense_default'
    contraAcc = (await resolveControlAccount(db, opts.company_id, key)) || ''
    contraResolution = contraResolution || `control:${key}`
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
    payload:       { direction: opts.direction, amount: opts.amount, financial_account_id: opts.financial_account_id, contra_resolution: contraResolution },
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
    // Explicit expense account overrides the control-account fallback.
    // Pass the GL account code resolved from expense_types or a posting rule.
    expense_account?: string | null
    // Optional posting group codes — when provided, the cascade may find a
    // more specific expense account from the posting rules matrix.
    bus_posting_group_code?: string | null
    prod_posting_group_code?: string | null
  },
): Promise<number | null> {
  const cashAcc = await resolveControlAccount(db, opts.company_id, 'cash')

  // Resolve the expense (debit) account: explicit > posting-group cascade > default
  let expAcc: string | null = opts.expense_account || null

  if (!expAcc && (opts.bus_posting_group_code || opts.prod_posting_group_code)) {
    // Try the posting-group cascade when group codes are available
    const blueprint = await peResolveExpense(
      db,
      opts.company_id,
      opts.bus_posting_group_code ?? null,
      opts.prod_posting_group_code ?? null,
      cashAcc || '',
      opts.amount,
    )
    if (!blueprint.isBlocked && blueprint.lines.length) {
      const expLine = blueprint.lines.find((l) => l.rule_slot?.includes('expense'))
      if (expLine?.account_code) expAcc = expLine.account_code
    }
  }

  // Final fallback: expense_default control account
  if (!expAcc) {
    expAcc = await resolveControlAccount(db, opts.company_id, 'expense_default')
  }

  if (!expAcc || !cashAcc) {
    throw new Error('EXPENSE_POSTING_BLOCKED: لا يوجد حساب مصروف أو حساب نقدية محدد')
  }

  // Build the two-line entry directly — no engine ambiguity
  const lines = [
    {
      account_code:     expAcc,
      debit:            opts.amount,
      credit:           0,
      description:      `مصروفات | ${opts.description}`,
      center_code:      opts.center_code,
      rule_slot:        'expense',
      source_ledger:    'cash' as const,
      source_record_id: opts.ref_id,
    },
    {
      account_code:     cashAcc,
      debit:            0,
      credit:           opts.amount,
      description:      `مصروفات | ${opts.description}`,
      center_code:      opts.center_code,
      rule_slot:        'cash',
      source_ledger:    'cash' as const,
      source_record_id: opts.ref_id,
    },
  ]

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'expense',
    source_module: 'treasury',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `مصروفات | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount, expense_account: expAcc, cash_account: cashAcc },
    trace:         null,
    lines,
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
    // Optional posting group codes for cascade-based revenue account resolution
    bus_posting_group_code?: string | null
    prod_posting_group_code?: string | null
    // Explicit revenue account overrides cascade
    revenue_account?: string | null
  },
): Promise<number | null> {
  const cashAcc = await resolveControlAccount(db, opts.company_id, 'cash')

  // Resolve revenue (credit) account: explicit > posting-group cascade > default
  let revAcc: string | null = opts.revenue_account || null

  if (!revAcc && (opts.bus_posting_group_code || opts.prod_posting_group_code)) {
    const blueprint = await peResolveSalesRevenue(
      db,
      opts.company_id,
      opts.bus_posting_group_code ?? null,
      opts.prod_posting_group_code ?? null,
      cashAcc || '',
      opts.amount,
    )
    if (!blueprint.isBlocked && blueprint.lines.length) {
      const revLine = blueprint.lines.find((l) => l.rule_slot?.includes('sales') || l.rule_slot?.includes('revenue'))
      if (revLine?.account_code) revAcc = revLine.account_code
    }
  }

  if (!revAcc) {
    revAcc = await resolveControlAccount(db, opts.company_id, 'revenue_default')
  }

  if (!revAcc || !cashAcc) {
    throw new Error('SALES_REVENUE_POSTING_BLOCKED: لا يوجد حساب إيرادات أو حساب نقدية محدد')
  }

  // Build the two-line entry directly
  const lines = [
    {
      account_code:     cashAcc,
      debit:            opts.amount,
      credit:           0,
      description:      `إيرادات | ${opts.description}`,
      center_code:      opts.center_code,
      season_id:        opts.season_id,
      field_id:         opts.field_id,
      rule_slot:        'cash',
      source_ledger:    'cash' as const,
      source_record_id: opts.ref_id,
    },
    {
      account_code:     revAcc,
      debit:            0,
      credit:           opts.amount,
      description:      `إيرادات | ${opts.description}`,
      center_code:      opts.center_code,
      season_id:        opts.season_id,
      field_id:         opts.field_id,
      rule_slot:        'sales',
      source_ledger:    'cash' as const,
      source_record_id: opts.ref_id,
    },
  ]

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'revenue',
    source_module: 'operations',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `إيرادات | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount, revenue_account: revAcc, season_id: opts.season_id, field_id: opts.field_id },
    trace:         null,
    lines,
  })
}
