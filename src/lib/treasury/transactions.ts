import type { D1Database } from '@cloudflare/workers-types'

export interface TransactionFilters {
  direction?:    string
  seasonId?:     string
  status?:       string
  month?:        number
  year?:         number
  accountId?:    number
  partnerId?:    number
  supplierCode?: number
  search?:       string
}

export interface TransactionListOptions {
  page:      number
  size:      number
  filters:   TransactionFilters
}

export interface TransactionListResult {
  rows:  unknown[]
  total: number
}

export async function queryTransactionLedger(
  db: D1Database,
  companyId: number,
  opts: TransactionListOptions,
): Promise<TransactionListResult> {
  const { page, size, filters } = opts
  const offset = (page - 1) * size

  let filterSql = ''
  const filterBinds: unknown[] = []

  if (filters.direction)    { filterSql += ' AND ct.direction = ?';             filterBinds.push(filters.direction) }
  if (filters.seasonId)     { filterSql += ' AND ct.season_id = ?';             filterBinds.push(filters.seasonId) }
  if (filters.status)       { filterSql += ' AND ct.status = ?';                filterBinds.push(filters.status) }
  if (filters.month != null){ filterSql += ' AND ct.month = ?';                 filterBinds.push(filters.month) }
  if (filters.year  != null){ filterSql += ' AND ct.year = ?';                  filterBinds.push(filters.year) }
  if (filters.accountId)    { filterSql += ' AND ct.financial_account_id = ?';  filterBinds.push(filters.accountId) }
  if (filters.partnerId)    { filterSql += ' AND ct.partner_id = ?';            filterBinds.push(filters.partnerId) }
  if (filters.supplierCode) { filterSql += ' AND ct.supplier_code = ?';         filterBinds.push(filters.supplierCode) }
  if (filters.search) {
    filterSql += ' AND (ct.narration LIKE ? OR ct.recipient_name LIKE ? OR s.name LIKE ?)'
    const like = `%${filters.search}%`
    filterBinds.push(like, like, like)
  }

  const [rows, cnt] = await Promise.all([
    db.prepare(
      `WITH ledger AS (
         SELECT ct0.id,
                CASE
                  WHEN ct0.status = 'posted' THEN
                    SUM(
                      CASE
                        WHEN ct0.status = 'posted' AND ct0.direction = 'د' THEN ct0.amount
                        WHEN ct0.status = 'posted' AND ct0.direction = 'م' THEN -ct0.amount
                        ELSE 0
                      END
                    ) OVER (
                      PARTITION BY COALESCE(ct0.financial_account_id, -1)
                      ORDER BY ct0.transaction_date ASC, ct0.id ASC
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    )
                  ELSE NULL
                END AS derived_running_balance
         FROM cash_transactions ct0
         WHERE ct0.company_id = ?
       )
       SELECT ct.id, ct.transaction_date, ct.direction, ct.document_number, ct.recipient_name,
              ct.narration, ct.amount, ct.debit, ct.credit,
              COALESCE(ct.running_balance, ledger.derived_running_balance) AS running_balance,
              ct.year, ct.month,
              ct.notes, ct.status, ct.field_id, ct.center_code, ct.season_id, ct.document_type,
              ct.financial_account_id, ct.partner_id, ct.journal_entry_id,
              ct.supplier_code, ct.expense_code,
              s.name  AS supplier_name,
              et.name AS expense_name
       FROM cash_transactions ct
       LEFT JOIN ledger         ON ledger.id = ct.id
       LEFT JOIN suppliers     s  ON s.code  = ct.supplier_code AND s.company_id = ct.company_id
       LEFT JOIN expense_types et ON et.code = ct.expense_code  AND et.company_id = ct.company_id AND et.is_deprecated = 0
       WHERE ct.company_id = ? ${filterSql}
       ORDER BY ct.transaction_date ASC, ct.id ASC LIMIT ? OFFSET ?`
    ).bind(companyId, companyId, ...filterBinds, size, offset).all(),

    db.prepare(
      `SELECT COUNT(*) AS n FROM cash_transactions ct
       LEFT JOIN suppliers s ON s.code = ct.supplier_code AND s.company_id = ct.company_id
       WHERE ct.company_id = ? ${filterSql}`
    ).bind(companyId, ...filterBinds).first<{ n: number }>(),
  ])

  return { rows: rows.results, total: cnt?.n ?? 0 }
}
