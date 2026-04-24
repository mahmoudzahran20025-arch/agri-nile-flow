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
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error('GL_UNBALANCED: The journal entry is unbalanced.')
  }

  const periodId = await getOpenPeriod(db, opts.company_id, opts.entry_date)
  if (!periodId) {
    throw new Error(`GL_CLOSED_PERIOD: No open financial period found for date ${opts.entry_date}.`)
  }

  try {

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
  } catch (e: any) {
    try {
      await db.prepare(`
        INSERT INTO system_error_logs 
        (company_id, user_id, endpoint, method, error_message, stack_trace, request_payload) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        opts.company_id, 
        opts.created_by ?? null, 
        'GL_ENGINE', 
        opts.ref_type, 
        e.message || String(e), 
        e.stack ?? null, 
        JSON.stringify({ ref_id: opts.ref_id, lines_count: opts.lines.length })
      ).run()
    } catch (logErr) {
      // Ignore error logging failure
    }
    throw new Error(`GL posting failed: ${e.message}`)
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
  center_code?: number,
  contraAccountOverride?: string,
): Promise<number | null> {
  const cashAcc    = await getMapping(db, company_id, 'cash')
  const contraAcc  = contraAccountOverride 
    ? contraAccountOverride
    : (direction === 'د'
        ? await getMapping(db, company_id, 'revenue_default')
        : await getMapping(db, company_id, 'expense_default'))

  if (!cashAcc || !contraAcc) {
    throw new Error('GL_MAPPING_MISSING: Missing default accounts for Cash or Revenue/Expense.')
  }

  const lines: GLLine[] = direction === 'د'
    ? [
        { account_code: cashAcc,   debit: amount, credit: 0,      description: narration, center_code },
        { account_code: contraAcc, debit: 0,       credit: amount, description: narration, center_code },
      ]
    : [
        { account_code: contraAcc, debit: amount, credit: 0,      description: narration, center_code },
        { account_code: cashAcc,   debit: 0,       credit: amount, description: narration, center_code },
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
  center_code?: number,
): Promise<number | null> {
  const apAcc      = await getMapping(db, company_id, 'accounts_payable')
  const expenseAcc = await getMapping(db, company_id, 'expense_default')
  // For 'م' (payment): DR AP / CR Cash — not DR AP / CR Expense
  const cashAcc    = await getMapping(db, company_id, 'cash')

  if (!apAcc || !expenseAcc) {
    throw new Error('GL_MAPPING_MISSING: Missing default accounts for AP or Expense.')
  }

  // 'د' = purchase on credit  → DR Expense / CR AP
  // 'م' = payment to supplier → DR AP / CR Cash
  const lines: GLLine[] = entry_type === 'د'
    ? [
        { account_code: expenseAcc,           debit: amount, credit: 0,      description, center_code },
        { account_code: apAcc,                debit: 0,      credit: amount, description, center_code },
      ]
    : [
        { account_code: apAcc,                debit: amount, credit: 0,      description, center_code },
        { account_code: cashAcc ?? expenseAcc, debit: 0,     credit: amount, description, center_code },
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
  
  if (!purchasesAcc || !apAcc) {
    throw new Error('GL_MAPPING_MISSING: Missing default accounts for Purchases or AP.')
  }
  if (amount <= 0) return null

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
  center_code?: number,
  payment_method?: 'cash' | 'credit',
  work_order_id?: number,
): Promise<number | null> {
  const invAcc     = await getMapping(db, company_id, 'inventory')
  const apAcc      = await getMapping(db, company_id, 'accounts_payable')
  const cashAcc    = await getMapping(db, company_id, 'cash')
  // For withdrawals: use COGS account if linked to a work order, fall back to expense_default
  const cogsAcc    = work_order_id
    ? (await getMapping(db, company_id, 'cogs') ?? await getMapping(db, company_id, 'expense_default'))
    : await getMapping(db, company_id, 'expense_default')

  if (!invAcc) {
    throw new Error('GL_MAPPING_MISSING: Missing default account for Inventory.')
  }

  if (movement_type === 'اضافة') {
    const method = payment_method ?? 'credit'
    if (method === 'cash' && !cashAcc) {
      throw new Error('GL_MAPPING_MISSING: Missing Cash account (needed for cash purchases).')
    }
    if (method === 'credit' && !apAcc) {
      throw new Error('GL_MAPPING_MISSING: Missing AP account (needed for credit purchases).')
    }
  }

  if (value <= 0) return null

  const desc = movement_type === 'اضافة'
    ? `إضافة مخزون [${payment_method === 'cash' ? 'نقدي' : 'آجل'}]: ${item_name}`
    : `صرف مخزون [${work_order_id ? 'تكلفة إنتاج' : 'مصروف'}]: ${item_name}`

  let lines: GLLine[]

  if (movement_type === 'اضافة') {
    // Addition: DR Inventory / CR Cash  (cash purchase)
    //           DR Inventory / CR AP    (credit purchase — default)
    const method     = payment_method ?? 'credit'
    const contraAcc  = method === 'cash' ? cashAcc! : apAcc!
    lines = [
      { account_code: invAcc,    debit: value, credit: 0,     description: desc, center_code },
      { account_code: contraAcc, debit: 0,     credit: value, description: desc, center_code },
    ]
  } else {
    // Withdrawal: DR COGS / CR Inventory  (work-order linked → production cost)
    //             DR Expense / CR Inventory (standalone → operating expense)
    const expAcc = cogsAcc ?? invAcc
    lines = [
      { account_code: expAcc, debit: value, credit: 0,     description: desc, center_code },
      { account_code: invAcc, debit: 0,     credit: value, description: desc, center_code },
    ]
  }

  return await postAutoEntry(db, { company_id, entry_date: date, description: desc,
    ref_type: 'inventory_movement', ref_id, lines, created_by })
}


// Work-order labor: DR Production Cost / CR Accrued Labor (field piece-rate)
export async function glWorkOrderLabor(
  db: D1Database,
  company_id: number,
  ref_id: number,
  amount: number,
  date: string,
  description: string,
  created_by?: number,
  center_code?: number,
): Promise<number | null> {
  const cogsAcc    = await getMapping(db, company_id, 'cogs')
                  ?? await getMapping(db, company_id, 'expense_default')
  const payableAcc = await getMapping(db, company_id, 'wages_payable')
                  ?? await getMapping(db, company_id, 'accounts_payable')

  if (!cogsAcc || !payableAcc) {
    throw new Error('GL_MAPPING_MISSING: Missing default accounts for COGS or Wages Payable.')
  }
  if (amount <= 0) return null

  return await postAutoEntry(db, {
    company_id, entry_date: date, description,
    ref_type: 'work_order', ref_id,
    lines: [
      { account_code: cogsAcc,    debit: amount, credit: 0,      description, center_code },
      { account_code: payableAcc, debit: 0,      credit: amount, description, center_code },
    ],
    created_by,
  })
}

// Salary disbursement: DR Wages Payable / CR Cash (actual bank transfer to employees)
export async function glWagesPayment(
  db: D1Database,
  company_id: number,
  ref_id: number,
  amount: number,
  date: string,
  description: string,
  created_by?: number,
): Promise<number | null> {
  const payableAcc = await getMapping(db, company_id, 'wages_payable')
                  ?? await getMapping(db, company_id, 'accounts_payable')
  const cashAcc    = await getMapping(db, company_id, 'cash')

  if (!payableAcc || !cashAcc) {
    throw new Error('GL_MAPPING_MISSING: Missing default accounts for Wages Payable or Cash.')
  }
  if (amount <= 0) return null

  return await postAutoEntry(db, {
    company_id, entry_date: date, description,
    ref_type: 'payroll_payment', ref_id,
    lines: [
      { account_code: payableAcc, debit: amount, credit: 0,      description },
      { account_code: cashAcc,    debit: 0,      credit: amount, description },
    ],
    created_by,
  })
}

// Contract advance from customer: DR Cash / CR Deferred Revenue (liability)
export async function glContractAdvance(
  db: D1Database,
  company_id: number,
  ref_id: number,
  amount: number,
  date: string,
  description: string,
  created_by?: number,
): Promise<number | null> {
  const cashAcc     = await getMapping(db, company_id, 'cash')
  const deferredAcc = await getMapping(db, company_id, 'deferred_revenue')
                   ?? await getMapping(db, company_id, 'accounts_payable')

  if (!cashAcc || !deferredAcc) {
    throw new Error('GL_MAPPING_MISSING: Missing default accounts for Cash or Deferred Revenue.')
  }
  if (amount <= 0) return null

  return await postAutoEntry(db, {
    company_id, entry_date: date, description,
    ref_type: 'contract_advance', ref_id,
    lines: [
      { account_code: cashAcc,     debit: amount, credit: 0,      description },
      { account_code: deferredAcc, debit: 0,      credit: amount, description },
    ],
    created_by,
  })
}

// Payroll: DR Wages / CR Wages Payable (recognize liability)
export async function glPayroll(
  db: D1Database,
  company_id: number,
  ref_id: number,
  amount: number,
  date: string,
  description: string,
  created_by?: number,
  center_code?: number,
): Promise<number | null> {
  const wagesAcc = await getMapping(db, company_id, 'wages')
                ?? await getMapping(db, company_id, 'expense_default')
  const payableAcc = await getMapping(db, company_id, 'wages_payable')
                  ?? await getMapping(db, company_id, 'accounts_payable')
  
  if (!wagesAcc || !payableAcc) {
    throw new Error('GL_MAPPING_MISSING: Missing default accounts for Wages or Wages Payable.')
  }
  if (amount <= 0) return null

  return await postAutoEntry(db, {
    company_id, entry_date: date, description,
    ref_type: 'payroll_run', ref_id,
    lines: [
      { account_code: wagesAcc,   debit: amount, credit: 0,      description, center_code },
      { account_code: payableAcc, debit: 0,      credit: amount, description, center_code },
    ],
    created_by,
  })
}
