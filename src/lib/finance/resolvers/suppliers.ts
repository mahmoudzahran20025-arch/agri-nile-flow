import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveSupplierInvoice as peResolveSupplierInvoice,
  resolveSupplierPayment as peResolveSupplierPayment,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'
import { resolveSupplierPayableAccount } from './supplier_payable_account'

async function resolveBpgFromServiceType(
  db: D1Database,
  company_id: number,
  service_type_code: string | null | undefined,
): Promise<string | null> {
  if (!service_type_code) return null
  const row = await db
    .prepare('SELECT bus_posting_group_code FROM service_types WHERE company_id = ? AND code = ? LIMIT 1')
    .bind(company_id, service_type_code)
    .first<{ bus_posting_group_code: string | null }>()
  return row?.bus_posting_group_code ?? null
}

export async function resolveSupplierInvoice(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    supplier_code: number | null
    amount: number
    date: string
    description: string
    expense_category?: string | null
    service_type_code?: string | null
    created_by?: number
  },
): Promise<number | null> {
  const [apCode, bpgCode] = await Promise.all([
    resolveSupplierPayableAccount(db, opts.company_id, opts.supplier_code, opts.expense_category, opts.service_type_code),
    resolveBpgFromServiceType(db, opts.company_id, opts.service_type_code),
  ])
  const blueprint = await peResolveSupplierInvoice(
    db,
    opts.company_id,
    bpgCode,
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
    expense_category?: string | null
    service_type_code?: string | null
    financial_account_id?: number | null
  },
): Promise<number | null> {
  const [cashAccRow, apCode] = await Promise.all([
    opts.financial_account_id
      ? db.prepare('SELECT gl_account_code FROM bank_accounts WHERE id = ? AND company_id = ?').bind(opts.financial_account_id, opts.company_id).first<{ gl_account_code: string }>()
      : Promise.resolve(null),
    resolveSupplierPayableAccount(db, opts.company_id, opts.supplier_code, opts.expense_category, opts.service_type_code),
  ])
  const cashAcc = cashAccRow?.gl_account_code ?? ''
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
