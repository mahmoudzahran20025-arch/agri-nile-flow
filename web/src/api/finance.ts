// ── Finance API Client ────────────────────────────────────────
import { api, unwrap } from './core'

// ── Types ─────────────────────────────────────────────────────

export interface BankAccount {
  id: number; company_id: number
  bank_name: string; account_name: string; account_number: string
  iban?: string; currency: string; gl_account_code?: string
  opening_balance: number; current_balance?: number
  is_active: number; notes?: string; created_at: string
}

export interface BankStatement {
  id: number; company_id: number; bank_account_id: number
  statement_date: string; value_date?: string; description: string
  ref_number?: string; amount_in: number; amount_out: number
  bank_balance?: number; is_matched: number
  matched_tx_id?: number; matched_at?: string; matched_by_name?: string
  import_batch_id?: string; created_at: string
}

export interface BankReconciliation {
  id: number; company_id: number; bank_account_id: number
  period_start: string; period_end: string
  bank_closing_bal: number; book_closing_bal: number
  outstanding_checks: number; deposits_in_transit: number
  bank_errors: number; book_errors: number
  adjusted_bank_bal: number; adjusted_book_bal: number; difference: number
  status: 'draft' | 'reconciled' | 'closed'
  notes?: string; created_by_name?: string; closed_by_name?: string
  closed_at?: string; created_at: string
}

export interface PurchaseOrder {
  id: number; company_id: number; po_number: string
  supplier_code?: number; supplier_name?: string; supplier_name_resolved?: string
  order_date: string; expected_date?: string
  status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled' | 'closed'
  total_amount: number; notes?: string
  requested_by?: number; requested_by_name?: string
  approved_by?: number; approved_by_name?: string; approved_at?: string
  received_by?: number; received_at?: string
  item_count?: number; created_at: string; updated_at: string
}

export interface POItem {
  id: number; po_id: number; company_id: number
  item_code?: string; item_name: string; unit?: string
  qty_ordered: number; qty_received: number
  unit_price: number; total_price: number; notes?: string
  warehouse?: string
}

export type MatchStatus = 'matched' | 'price_variance' | 'qty_variance' | 'over_invoiced' | 'pending_invoice' | 'no_gr'

export interface POMatchRow {
  po_item_id:     number
  item_name:      string
  unit:           string | null
  qty_ordered:    number
  qty_received:   number
  qty_invoiced:   number
  po_unit_price:  number
  inv_unit_price: number
  match_status:   MatchStatus
  invoice_id:     number | null
  invoice_number: string | null
}

export interface POInvoiceSummary {
  id: number; number: string; date: string; total: number
}

export interface APAgingRow {
  id: number; invoice_number: string; invoice_date: string
  due_date: string; due_date_days: number
  total_amount: number; paid_amount: number; outstanding: number
  payment_date?: string; payment_ref?: string
  po_number?: string; supplier_name?: string; supplier_code?: number
  days_overdue: number
}

export interface CashTxSearchResult {
  id: number
  transaction_date: string
  direction: string
  narration: string
  recipient_name?: string
  amount: number
  document_number?: string
  running_balance?: number
}

// ── API client ────────────────────────────────────────────────
export const financeApi = {
  // Bank Accounts
  getBankAccounts:   () => unwrap(api.get<BankAccount[]>('/finance/bank-accounts')),
  createBankAccount: (b: Partial<BankAccount>) => unwrap(api.post<{id:number}>('/finance/bank-accounts', b)),
  updateBankAccount: (id: number, b: Partial<BankAccount>) =>
    unwrap(api.patch<null>(`/finance/bank-accounts/${id}`, b)),

  // Bank Statements
  getStatements: (accountId: number, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return unwrap(api.get<BankStatement[]>(`/finance/bank-statements/${accountId}${qs}`))
  },
  importStatements: (accountId: number, lines: Partial<BankStatement>[], batch_id?: string) =>
    unwrap(api.post<{imported: number; batch_id: string}>(`/finance/bank-statements/${accountId}`, { lines, batch_id })),
  matchStatement: (stmtId: number, cash_tx_id: number | null) =>
    unwrap(api.patch<null>(`/finance/bank-statements/${stmtId}/match`, { cash_tx_id })),

  // Bank Reconciliation
  getReconciliations: (accountId: number) =>
    unwrap(api.get<BankReconciliation[]>(`/finance/bank-recon/${accountId}`)),
  createReconciliation: (accountId: number, b: Partial<BankReconciliation>) =>
    unwrap(api.post<{id:number}>(`/finance/bank-recon/${accountId}`, b)),
  closeReconciliation: (id: number) =>
    unwrap(api.patch<null>(`/finance/bank-recon/${id}/close`, {})),

  // Purchase Orders
  getPurchaseOrders: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return unwrap(api.get<PurchaseOrder[]>(`/finance/purchase-orders${qs}`))
  },
  getPurchaseOrder: (id: number) =>
    unwrap(api.get<PurchaseOrder & { items: POItem[] }>(`/finance/purchase-orders/${id}`)),
  createPurchaseOrder: (b: {
    order_date: string; po_number?: string
    supplier_code?: number; supplier_name?: string
    expected_date?: string; notes?: string
    items: Array<{ item_code?: string; item_name: string; unit?: string; qty_ordered: number; unit_price: number; center_code?: number; notes?: string }>
  }) => unwrap(api.post<{id:number; po_number:string}>('/finance/purchase-orders', b)),
  updatePOStatus: (id: number, status: string, notes?: string) =>
    unwrap(api.patch<null>(`/finance/purchase-orders/${id}/status`, { status, notes })),
  
  // Realignment: PO Receipt moves to /inventory
  receivePO: (id: number, b: { received_date: string; season_id?: number; items: Array<{ po_item_id: number; qty_received: number; warehouse: string }> }) =>
    unwrap(api.post<{status:string}>(`/inventory/receive-po/${id}`, b)),

  // Realignment: PO matching and Invoicing moves to /suppliers (Modular Context)
  getPOMatch: (id: number) =>
    unwrap(api.get<{ po: PurchaseOrder; match_rows: POMatchRow[]; invoices: POInvoiceSummary[] }>(
      `/suppliers/purchase-orders/${id}/match`
    )),
  createInvoice: (poId: number, body: {
    invoice_number: string; invoice_date: string; notes?: string
    items: Array<{ po_item_id: number; qty_invoiced: number; unit_price: number }>
  }) => unwrap(api.post<{id:number}>(`/suppliers/purchase-orders/${poId}/invoices`, body)),

  // Realignment: AP Aging moves to /suppliers
  getAPAging: () =>
    unwrap(api.get<APAgingRow[]>('/suppliers/aging-summary')),

  payInvoice: (id: number, body: { paid_amount: number; payment_date?: string; payment_ref?: string }) =>
    unwrap(api.patch<null>(`/finance/supplier-invoices/${id}/pay`, body)),

  // Cash Transaction Search (for bank statement matching)
  searchCashTransactions: (params: { q?: string; direction?: string }) => {
    const qs = '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string>
    ).toString()
    return unwrap(api.get<CashTxSearchResult[]>(`/finance/cash-tx-search${qs}`))
  },

  // Smart matching suggestions — returns candidate cash_tx per unmatched statement line
  suggestStatementMatches: (accountId: number, params?: { start?: string; end?: string }) => {
    const qs = new URLSearchParams()
    if (params?.start) qs.set('start', params.start)
    if (params?.end)   qs.set('end',   params.end)
    const q = qs.toString()
    return unwrap(api.get<Array<{
      statement_line_id: number
      statement_date: string
      description: string
      amount_in: number
      amount_out: number
      candidates: { id: number; transaction_date: string; amount: number; narration: string; direction: string; document_number: string | null }[]
    }>>(`/finance/bank-statements/${accountId}/suggest-matches${q ? `?${q}` : ''}`))
  },
}
