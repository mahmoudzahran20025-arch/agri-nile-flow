/**
 * gl/preview.ts
 * ==============
 * Dry-run GL preview — resolves account codes and constructs journal lines
 * for a given business event WITHOUT writing anything to the database.
 *
 * Used by the frontend GL Previewer so operators can see the accounting
 * impact of a transaction before committing.
 *
 * POST /api/gl/preview
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser } from '../../middleware/auth'
import { resolveControlAccount } from '../../lib/posting_engine'

const preview = new Hono<{ Bindings: Env }>()
preview.use('*', authMiddleware)

type PreviewLine = {
  account_code: string
  account_label?: string
  debit: number
  credit: number
  description: string
  rule_slot: string
}

type PreviewRequest = {
  event_type: string
  amount: number
  description?: string
  // Optional dimension context — forwarded to line labels for display only
  season_id?: number
  center_code?: number
  field_id?: number
  // Allow caller to supply explicit account overrides (for manual entries)
  debit_account?: string
  credit_account?: string
}

/** Resolve a control account and optionally look up its label */
async function resolveWithLabel(
  db: Env['DB'],
  company_id: number,
  key: string,
): Promise<{ code: string | null; label: string | null }> {
  const code = await resolveControlAccount(db, company_id, key)
  if (!code) return { code: null, label: null }

  const row = await db
    .prepare('SELECT name FROM chart_of_accounts WHERE account_code = ? AND company_id = ?')
    .bind(code, company_id)
    .first<{ name: string }>()

  return { code, label: row?.name ?? null }
}

/** Map event_type → DR/CR control account keys */
const EVENT_ACCOUNT_MAP: Record<string, { dr: string; cr: string }> = {
  supplier_invoice:   { dr: 'inventory_asset',   cr: 'accounts_payable' },
  supplier_payment:   { dr: 'accounts_payable',  cr: 'cash' },
  cash_transaction:   { dr: 'cash',              cr: 'cash_expense' },
  cash_receipt:       { dr: 'cash',              cr: 'revenue' },
  work_order_labor:   { dr: 'labor_expense',     cr: 'wages_payable' },
  inventory_issue:    { dr: 'cogs',              cr: 'inventory_asset' },
  harvest_cost:       { dr: 'cogs',              cr: 'inventory_asset' },
  partner_capital:    { dr: 'cash',              cr: 'equity' },
}

// POST /api/gl/preview
preview.post('/preview', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<PreviewRequest>()

  if (!b.event_type || !b.amount || b.amount <= 0) {
    return c.json({ success: false, error: 'event_type وamount مطلوبان' }, 400)
  }

  const desc = b.description ?? b.event_type
  const lines: PreviewLine[] = []
  let balanced = false
  let warning: string | null = null

  // Manual override path — caller provides explicit account codes
  if (b.debit_account && b.credit_account) {
    const [drRow, crRow] = await Promise.all([
      c.env.DB
        .prepare('SELECT name FROM chart_of_accounts WHERE account_code = ? AND company_id = ?')
        .bind(b.debit_account, company_id)
        .first<{ name: string }>(),
      c.env.DB
        .prepare('SELECT name FROM chart_of_accounts WHERE account_code = ? AND company_id = ?')
        .bind(b.credit_account, company_id)
        .first<{ name: string }>(),
    ])

    lines.push(
      { account_code: b.debit_account,  account_label: drRow?.name, debit: b.amount, credit: 0,        description: desc, rule_slot: 'debit' },
      { account_code: b.credit_account, account_label: crRow?.name, debit: 0,        credit: b.amount, description: desc, rule_slot: 'credit' },
    )
    balanced = true
  } else {
    // Automatic resolution via control account mapping
    const mapping = EVENT_ACCOUNT_MAP[b.event_type]
    if (!mapping) {
      return c.json({
        success: false,
        error: `نوع الحدث غير مدعوم في المعاينة: ${b.event_type}`,
        supported: Object.keys(EVENT_ACCOUNT_MAP),
      }, 422)
    }

    const [dr, cr] = await Promise.all([
      resolveWithLabel(c.env.DB, company_id, mapping.dr),
      resolveWithLabel(c.env.DB, company_id, mapping.cr),
    ])

    if (!dr.code || !cr.code) {
      const missing = [
        !dr.code ? mapping.dr : null,
        !cr.code ? mapping.cr : null,
      ].filter(Boolean).join(', ')
      warning = `تعذّر حل الحسابات التالية: ${missing} — تحقق من ربط الحسابات الضابطة`
    } else {
      lines.push(
        { account_code: dr.code, account_label: dr.label ?? undefined, debit: b.amount, credit: 0,        description: desc, rule_slot: mapping.dr },
        { account_code: cr.code, account_label: cr.label ?? undefined, debit: 0,        credit: b.amount, description: desc, rule_slot: mapping.cr },
      )
      balanced = true
    }
  }

  const totalDebit  = lines.reduce((s, l) => s + l.debit,  0)
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)

  return c.json({
    success: true,
    data: {
      event_type: b.event_type,
      amount:     b.amount,
      lines,
      balanced,
      total_debit:  totalDebit,
      total_credit: totalCredit,
      warning,
    },
  })
})

export default preview
