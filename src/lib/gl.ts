import type { D1Database } from '@cloudflare/workers-types'

interface GLLine {
  account_code: string
  debit:        number
  credit:       number
  description?: string
  center_code?: number
}

interface PostEntryOpts {
  company_id:  number
  entry_date:  string
  description: string
  ref_type:    string
  ref_id:      number
  lines:       GLLine[]
  created_by?: number
}

async function getMapping(db: D1Database, company_id: number, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = ?')
    .bind(company_id, key).first<{ account_code: string }>()
  return row?.account_code ?? null
}

export async function getOpenPeriod(db: D1Database, company_id: number, date: string): Promise<number | null> {
  const row = await db
    .prepare(`SELECT id FROM financial_periods
              WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND is_closed = 0
              ORDER BY start_date DESC LIMIT 1`)
    .bind(company_id, date, date).first<{ id: number }>()
  return row?.id ?? null
}

export async function postAutoEntry(db: D1Database, opts: PostEntryOpts): Promise<number | null> {
  const totalDebit  = opts.lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = opts.lines.reduce((s, l) => s + l.credit, 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) return null  // unbalanced — skip silently

  try {
    const periodId = await getOpenPeriod(db, opts.company_id, opts.entry_date)

    // Step 1: Insert the header to get the entry ID
    const entry = await db
      .prepare(`INSERT INTO journal_entries
                (company_id, period_id, entry_date, description, ref_type, ref_id, is_posted, created_by)
                VALUES (?,?,?,?,?,?,1,?)`)
      .bind(opts.company_id, periodId, opts.entry_date, opts.description,
            opts.ref_type, opts.ref_id, opts.created_by ?? null).run()

    const entryId = entry.meta.last_row_id

    // Step 2: Insert ALL lines atomically using db.batch()
    const lineStmts = opts.lines.map(l =>
      db.prepare(
        `INSERT INTO journal_entry_lines
         (entry_id, company_id, account_code, debit, credit, description, center_code)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(
        entryId, opts.company_id, l.account_code,
        l.debit, l.credit, l.description ?? null, l.center_code ?? null
      )
    )
    await db.batch(lineStmts)

    return entryId
  } catch {
    // GL failure must never break the source transaction
    return null
  }
}

// ── Auto-entry builders ────────────────────────────────────────

export async function glCashTransaction(
  db: D1Database,
  company_id: number,
  ref_id: number,
  direction: string,
  amount: number,
  date: string,
  narration: string,
  created_by?: number,
): Promise<number | null> {
  const cashAcc    = await getMapping(db, company_id, 'cash')
  const contraAcc  = direction === 'د'
    ? await getMapping(db, company_id, 'revenue_default')
    : await getMapping(db, company_id, 'expense_default')

  if (!cashAcc || !contraAcc) return null

  const lines: GLLine[] = direction === 'د'
    ? [
        { account_code: cashAcc,   debit: amount, credit: 0,      description: narration },
        { account_code: contraAcc, debit: 0,       credit: amount, description: narration },
      ]
    : [
        { account_code: contraAcc, debit: amount, credit: 0,      description: narration },
        { account_code: cashAcc,   debit: 0,       credit: amount, description: narration },
      ]

  return await postAutoEntry(db, { company_id, entry_date: date, description: narration,
    ref_type: 'cash_transaction', ref_id, lines, created_by })
}

export async function glSupplierTransaction(
  db: D1Database,
  company_id: number,
  ref_id: number,
  entry_type: string,
  amount: number,
  date: string,
  description: string,
  created_by?: number,
): Promise<number | null> {
  const apAcc      = await getMapping(db, company_id, 'accounts_payable')
  const expenseAcc = await getMapping(db, company_id, 'expense_default')

  if (!apAcc || !expenseAcc) return null

  // 'د' = credit entry (دائن) = المورد أعطانا خدمة/بضاعة → DR Expense / CR AP
  // 'م' = debit entry (مدين)  = دفعنا للمورد → DR AP / CR Cash (but cash handled separately)
  const lines: GLLine[] = entry_type === 'د'
    ? [
        { account_code: expenseAcc, debit: amount, credit: 0,      description },
        { account_code: apAcc,      debit: 0,       credit: amount, description },
      ]
    : [
        { account_code: apAcc,      debit: amount, credit: 0,      description },
        { account_code: expenseAcc, debit: 0,       credit: amount, description },
      ]

  return await postAutoEntry(db, { company_id, entry_date: date, description,
    ref_type: 'supplier_transaction', ref_id, lines, created_by })
}

// Supplier invoice (3-way match): DR Purchases / CR Accounts Payable
export async function glSupplierInvoice(
  db: D1Database,
  company_id: number,
  ref_id: number,
  amount: number,
  date: string,
  description: string,
  created_by?: number,
): Promise<number | null> {
  const purchasesAcc = await getMapping(db, company_id, 'purchases')
                    ?? await getMapping(db, company_id, 'expense_default')
  const apAcc        = await getMapping(db, company_id, 'accounts_payable')
  if (!purchasesAcc || !apAcc || amount <= 0) return null

  return await postAutoEntry(db, {
    company_id, entry_date: date, description,
    ref_type: 'supplier_invoice', ref_id,
    lines: [
      { account_code: purchasesAcc, debit: amount, credit: 0,      description },
      { account_code: apAcc,        debit: 0,      credit: amount, description },
    ],
    created_by,
  })
}

export async function glInventoryMovement(
  db: D1Database,
  company_id: number,
  ref_id: number,
  movement_type: string,
  value: number,
  date: string,
  item_name: string,
  created_by?: number,
): Promise<number | null> {
  const invAcc     = await getMapping(db, company_id, 'inventory')
  const apAcc      = await getMapping(db, company_id, 'accounts_payable')
  const expenseAcc = await getMapping(db, company_id, 'expense_default')

  if (!invAcc) return null
  if (value <= 0) return null

  const desc = movement_type === 'اضافة'
    ? `إضافة مخزون: ${item_name}`
    : `صرف مخزون: ${item_name}`

  // Addition: DR Inventory / CR AP (assumed purchased on credit)
  // Withdrawal: DR Expense / CR Inventory
  const lines: GLLine[] = movement_type === 'اضافة'
    ? [
        { account_code: invAcc,   debit: value, credit: 0,     description: desc },
        { account_code: apAcc ?? invAcc, debit: 0, credit: value, description: desc },
      ]
    : [
        { account_code: expenseAcc ?? invAcc, debit: value, credit: 0,     description: desc },
        { account_code: invAcc,               debit: 0,     credit: value, description: desc },
      ]

  if (movement_type === 'اضافة' && !apAcc) return null

  return await postAutoEntry(db, { company_id, entry_date: date, description: desc,
    ref_type: 'inventory_movement', ref_id, lines, created_by })
}


// Payroll: DR Wages / CR Cash (uses mapping table, replaces hardcoded account codes)
export async function glPayroll(
  db: D1Database,
  company_id: number,
  ref_id: number,
  amount: number,
  date: string,
  description: string,
  created_by?: number,
): Promise<number | null> {
  const wagesAcc = await getMapping(db, company_id, 'wages')
                ?? await getMapping(db, company_id, 'expense_default')
  const cashAcc  = await getMapping(db, company_id, 'cash')
  if (!wagesAcc || !cashAcc || amount <= 0) return null

  return await postAutoEntry(db, {
    company_id, entry_date: date, description,
    ref_type: 'payroll_run', ref_id,
    lines: [
      { account_code: wagesAcc, debit: amount, credit: 0,      description },
      { account_code: cashAcc,  debit: 0,      credit: amount, description },
    ],
    created_by,
  })
}
