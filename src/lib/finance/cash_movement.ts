import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { getOpenPeriod } from '../gl'
import { resolveCashLedger } from './resolvers/cash'

interface CashMovementInput {
  company_id: number
  userId: number
  transaction_date: string
  direction: 'د' | 'م'
  amount: number
  narration: string
  recipient_name?: string | null
  document_number?: number | null
  supplier_code?: number | null
  center_code?: number | null
  field_id?: number | null
  expense_code?: string | null
  season_id?: number | null
  notes?: string | null
  document_type?: string | null
  contraAccount?: string | null
  partner_id?: number | null
  financial_account_id?: number | null
  status?: 'draft' | 'posted'
  skipSupplierMirror?: boolean
  skipGlPosting?: boolean
}

interface CashDraftRow {
  id: number
  transaction_date: string
  direction: 'د' | 'م'
  amount: number
  narration: string
  supplier_code: number | null
  center_code: number | null
  partner_id: number | null
  financial_account_id: number | null
  expense_code?: string | null
}

export async function prepareCashMovement(
  db: D1Database,
  opts: CashMovementInput,
) {
  const status = opts.status ?? 'posted'
  const isPosted = status === 'posted'
  const batchKey = `cash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const stmts: D1PreparedStatement[] = []

  let periodId: number | null = null
  let newBalance: number | null = null
  let delta = 0

  if (isPosted) {
    periodId = await getOpenPeriod(db, opts.company_id, opts.transaction_date)
    if (!periodId) throw new Error(`PERIOD_CLOSED: No open period for ${opts.transaction_date}`)

    const accountId = opts.financial_account_id ?? null

    if (accountId !== null) {
      const lastRow = await db
        .prepare(`SELECT running_balance FROM cash_transactions
                  WHERE company_id = ? AND financial_account_id = ? 
                    AND transaction_date <= ? AND status = 'posted'
                  ORDER BY transaction_date DESC, id DESC LIMIT 1`)
        .bind(opts.company_id, accountId, opts.transaction_date).first<{ running_balance: number }>()

      const prevBalance = lastRow?.running_balance ?? 0
      delta = opts.direction === 'د' ? opts.amount : -opts.amount
      newBalance = prevBalance + delta

      stmts.push(db.prepare(
        `UPDATE cash_transactions SET running_balance = running_balance + ?
         WHERE company_id = ? AND financial_account_id = ? AND status = 'posted'
           AND (transaction_date > ? OR (transaction_date = ? AND (local_id IS NULL OR local_id != ?)))`
      ).bind(delta, opts.company_id, accountId, opts.transaction_date, opts.transaction_date, batchKey))
    } else {
      // No specific cash account — record without running balance tracking
      delta = opts.direction === 'د' ? opts.amount : -opts.amount
      newBalance = null
    }
  }

  stmts.push(db.prepare(
    `INSERT INTO cash_transactions
     (company_id, season_id, supplier_code, partner_id, financial_account_id, transaction_date,
      direction, document_number, recipient_name, narration, amount,
      debit, credit, running_balance, year, month, created_by_user_id, status, center_code, field_id, expense_code, local_id,
      document_type, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    opts.company_id, opts.season_id ?? null, opts.supplier_code ?? null, opts.partner_id ?? null, opts.financial_account_id ?? null,
    opts.transaction_date, opts.direction, opts.document_number ?? null,
    opts.recipient_name ?? null, opts.narration, opts.amount,
    opts.direction === 'م' ? opts.amount : 0,
    opts.direction === 'د' ? opts.amount : 0,
    newBalance, new Date(opts.transaction_date).getFullYear(), new Date(opts.transaction_date).getMonth() + 1,
    opts.userId, status, opts.center_code ?? null, opts.field_id ?? null, opts.expense_code ?? null, batchKey,
    opts.document_type ?? null, opts.notes ?? null
  ))

  if (isPosted) {
    if (opts.supplier_code && !opts.skipSupplierMirror) {
      const supKey = `st_${batchKey}`

      // Find the last supplier_transaction at or before this date to anchor the balance
      const lastSupRow = await db
        .prepare(`SELECT id, balance_with_checks, balance_no_checks FROM supplier_transactions
                  WHERE company_id = ? AND supplier_code = ?
                    AND transaction_date <= ?
                  ORDER BY transaction_date DESC, id DESC LIMIT 1`)
        .bind(opts.company_id, opts.supplier_code, opts.transaction_date)
        .first<{ id: number; balance_with_checks: number; balance_no_checks: number }>()

      const prevBalNoChecks   = lastSupRow?.balance_no_checks   ?? 0
      const prevBalWithChecks = lastSupRow?.balance_with_checks ?? 0
      // 'م' direction = we pay supplier = debit on supplier = reduces what we owe
      const supCredit = opts.direction === 'د' ? opts.amount : 0
      const supDebit  = opts.direction === 'م' ? opts.amount : 0
      const supDelta  = supCredit - supDebit
      const newSupBalNoChecks   = prevBalNoChecks   + supDelta
      const newSupBalWithChecks = prevBalWithChecks + supDelta

      // Shift all subsequent supplier_transactions forward by delta
      stmts.push(db.prepare(
        `UPDATE supplier_transactions
         SET balance_no_checks = balance_no_checks + ?,
             balance_with_checks = balance_with_checks + ?
         WHERE company_id = ? AND supplier_code = ?
           AND (transaction_date > ? OR (transaction_date = ? AND local_id IS NOT NULL AND local_id != ?))`
      ).bind(supDelta, supDelta, opts.company_id, opts.supplier_code,
             opts.transaction_date, opts.transaction_date, supKey))

      stmts.push(db.prepare(
        `INSERT INTO supplier_transactions
         (company_id, season_id, supplier_code, transaction_date, entry_type, document_type,
          notes, amount, credit, debit, balance_no_checks, balance_with_checks,
          status, created_by_user_id, local_id, center_code)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        opts.company_id, opts.season_id ?? null, opts.supplier_code,
        opts.transaction_date, opts.direction, 'cash_payment',
        opts.narration, opts.amount,
        supCredit, supDebit,
        newSupBalNoChecks, newSupBalWithChecks,
        status, opts.userId, supKey, opts.center_code ?? null
      ))
    }
  }

  await db.batch(stmts)

  const inserted = await db.prepare(
    'SELECT id FROM cash_transactions WHERE local_id = ? AND company_id = ?'
  ).bind(batchKey, opts.company_id).first<{ id: number }>()

  let journalEntryId: number | null = null

  if (isPosted && inserted?.id && !opts.skipGlPosting) {
    journalEntryId = await resolveCashLedger(db, {
      company_id: opts.company_id,
      ref_id: inserted.id,
      financial_account_id: opts.financial_account_id ?? undefined,
      direction: opts.direction,
      amount: opts.amount,
      date: opts.transaction_date,
      description: opts.narration,
      created_by: opts.userId,
      center_code: opts.center_code ?? undefined,
      expense_code: opts.expense_code,
      supplier_code: opts.supplier_code,
      partner_id: opts.partner_id,
      contra_account: opts.contraAccount,
    })

    if (journalEntryId) {
      await db.prepare('UPDATE cash_transactions SET journal_entry_id = ? WHERE id = ?')
        .bind(journalEntryId, inserted.id).run()
    }
  }

  return { 
    id: inserted?.id ?? null, 
    status, 
    batchKey, 
    periodId,
    // Backward compatibility aliases
    txnId: inserted?.id ?? null,
    balance: newBalance,
    journalEntryId,
  }
}

export async function commitCashDrafts(
  db: D1Database,
  opts: {
    company_id: number
    userId: number
    draftIds: number[]
  },
): Promise<{ committed: number; failed: number; errors: string[] }> {
  const result = { committed: 0, failed: 0, errors: [] as string[] }

  for (const draftId of opts.draftIds) {
    try {
      const draft = await db.prepare(
        `SELECT id, transaction_date, direction, amount, narration,
                supplier_code, center_code, partner_id, financial_account_id, expense_code,
                season_id, field_id, notes, document_type, document_number, recipient_name
         FROM cash_transactions WHERE id = ? AND company_id = ? AND status = 'draft'`
      ).bind(draftId, opts.company_id).first<CashDraftRow & {
        season_id: number | null; field_id: number | null; notes: string | null
        document_type: string | null; document_number: number | null; recipient_name: string | null
      }>()

      if (!draft) {
        result.failed++
        result.errors.push(`Draft ${draftId} not found or not in draft status`)
        continue
      }

      const periodId = await getOpenPeriod(db, opts.company_id, draft.transaction_date)
      if (!periodId) {
        result.failed++
        result.errors.push(`Draft ${draftId}: no open period for ${draft.transaction_date}`)
        continue
      }

      // Compute running balance at the draft's date position
      const lastPostedRow = await db.prepare(
        `SELECT running_balance FROM cash_transactions
         WHERE company_id = ? AND financial_account_id IS NOT DISTINCT FROM ?
           AND status = 'posted' AND transaction_date <= ? AND id != ?
         ORDER BY transaction_date DESC, id DESC LIMIT 1`
      ).bind(opts.company_id, draft.financial_account_id ?? null, draft.transaction_date, draftId)
        .first<{ running_balance: number }>()

      const prevBalance = lastPostedRow?.running_balance ?? 0
      const delta       = draft.direction === 'د' ? draft.amount : -draft.amount
      const newBalance  = prevBalance + delta

      // Promote in-place: no delete/recreate — audit trail preserved, same ID
      await db.prepare(
        `UPDATE cash_transactions SET status = 'posted', running_balance = ?
         WHERE id = ? AND company_id = ?`
      ).bind(newBalance, draftId, opts.company_id).run()

      // Shift all later rows in the same account forward by delta
      if (draft.financial_account_id != null && Math.abs(delta) > 0) {
        await db.prepare(
          `UPDATE cash_transactions SET running_balance = running_balance + ?
           WHERE company_id = ? AND financial_account_id = ? AND status = 'posted'
             AND (transaction_date > ? OR (transaction_date = ? AND id > ?))`
        ).bind(delta, opts.company_id, draft.financial_account_id,
               draft.transaction_date, draft.transaction_date, draftId).run()
      }

      // Create GL entry if not already present
      const existing = await db.prepare(
        'SELECT journal_entry_id FROM cash_transactions WHERE id = ?'
      ).bind(draftId).first<{ journal_entry_id: number | null }>()

      if (!existing?.journal_entry_id) {
        const jeId = await resolveCashLedger(db, {
          company_id:           opts.company_id,
          ref_id:               draftId,
          financial_account_id: draft.financial_account_id,
          direction:            draft.direction,
          amount:               draft.amount,
          date:                 draft.transaction_date,
          description:          draft.narration,
          created_by:           opts.userId,
          center_code:          draft.center_code ?? undefined,
          expense_code:         draft.expense_code,
          supplier_code:        draft.supplier_code,
          partner_id:           draft.partner_id,
        })
        if (jeId) {
          await db.prepare('UPDATE cash_transactions SET journal_entry_id = ? WHERE id = ?')
            .bind(jeId, draftId).run()
        }
      }

      result.committed++
    } catch (err: any) {
      result.failed++
      result.errors.push(`Failed to commit draft ${draftId}: ${err?.message ?? String(err)}`)
    }
  }

  return result
}

// Backward compatibility wrapper
export async function postCashMovement(
  db: D1Database,
  company_id: number,
  draftId: number,
  userId: number,
): Promise<{ success: boolean; error?: string }> {
  const result = await commitCashDrafts(db, { company_id, userId, draftIds: [draftId] })
  return {
    success: result.committed === 1,
    error: result.errors[0],
  }
}
