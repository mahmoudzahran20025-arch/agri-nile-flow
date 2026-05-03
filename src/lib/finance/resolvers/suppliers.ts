import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveSupplierInvoice as peResolveSupplierInvoice,
  resolveSupplierPayment as peResolveSupplierPayment,
  resolveControlAccount,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'

export async function resolveSupplierInvoice(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    supplier_code: number | null
    amount: number
    date: string
    description: string
    created_by?: number
  },
): Promise<number | null> {
  const apCode = await resolveControlAccount(db, opts.company_id, 'accounts_payable') ?? '212000010'
  const blueprint = await peResolveSupplierInvoice(
    db,
    opts.company_id,
    null,
    null,
    apCode,
    opts.amount,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`SUPPLIER_INVOICE_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'supplier_invoice',
    source_module: 'suppliers',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `فاتورة مورد | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { supplier_code: opts.supplier_code, amount: opts.amount, description: opts.description },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `فاتورة مورد | ${opts.description}`,
      rule_slot:     l.rule_slot,
      source_ledger: 'supplier' as const,
      source_record_id: opts.ref_id,
    })),
  })
}

export async function resolveSupplierPayment(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    amount: number
    date: string
    description: string
    created_by?: number
    center_code?: number
    supplier_code?: number | null
    financial_account_id?: number | null
  },
): Promise<number | null> {
  const cashAcc = opts.financial_account_id
    ? (await db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ?').bind(opts.financial_account_id).first<{ gl_account_code: string }>())?.gl_account_code || ''
    : ''

  const apCode = await resolveControlAccount(db, opts.company_id, 'accounts_payable') ?? '212000010'
  const blueprint = await peResolveSupplierPayment(
    db,
    opts.company_id,
    apCode,
    cashAcc,
    opts.amount,
  )
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`SUPPLIER_PAYMENT_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'supplier_payment',
    source_module: 'suppliers',
    source_id:     opts.ref_id,
    event_date:    opts.date,
    description:   `دفع لمورد | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { supplier_code: opts.supplier_code, amount: opts.amount, financial_account_id: opts.financial_account_id },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `دفع لمورد | ${opts.description}`,
      center_code:   opts.center_code,
      rule_slot:     l.rule_slot,
      source_ledger: 'supplier' as const,
      source_record_id: opts.ref_id,
    })),
  })
}
