import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'

const season = new Hono<{ Bindings: Env }>()

season.get('/season-summary', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  const seasonData = seasonId
    ? await c.env.DB.prepare(
        'SELECT id, name, season_type, start_date, end_date, status FROM seasons WHERE id = ? AND company_id = ?'
      ).bind(seasonId, company_id).first<{
        id: number; name: string; season_type: string
        start_date: string; end_date: string; status: string
      }>()
    : null

  const seasonWhere    = seasonId ? 'AND season_id = ?' : ''
  const jlSeasonWhere  = seasonId ? 'AND jl.season_id = ?' : ''
  const cashBinds:  unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const supBinds:   unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const invBinds:   unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const jlBinds:    unknown[] = seasonId ? [company_id, seasonId] : [company_id]

  const [
    // ── GL-primary: cost center breakdown from posted journal lines ────────
    glByCostCenter,
    // ── GL-primary: monthly expense timeline from journal lines ───────────
    glMonthlyTimeline,
    // ── GL totals by source_ledger (cash/supplier/inventory/manual) ───────
    glBySourceLedger,
    // ── Ops annotations (kept for coverage gap display, NOT the P&L truth) ─
    opsByExpenseType,
    opsBySupplier,
    opsByInventoryItem,
    // ── Ops raw totals to compute gl_coverage_pct per center ─────────────
    opsCenterTotals,
  ] = await Promise.all([

    // GL cost center breakdown — debit side of expense/asset accounts
    c.env.DB.prepare(`
      SELECT
        jl.center_code,
        COALESCE(cc.name_ar, cc.name_en, CAST(jl.center_code AS TEXT)) AS center_name,
        SUM(CASE WHEN coa.account_type = 'expense' THEN jl.debit - jl.credit ELSE 0 END) AS gl_expense,
        SUM(CASE WHEN coa.account_type = 'asset'   THEN jl.debit - jl.credit ELSE 0 END) AS gl_asset_movement,
        SUM(jl.debit - jl.credit)                                                          AS gl_net_debit,
        COUNT(DISTINCT jl.entry_id)                                                        AS entry_count,
        -- source breakdown
        SUM(CASE WHEN jl.source_ledger = 'cash'      THEN jl.debit - jl.credit ELSE 0 END) AS cash_gl,
        SUM(CASE WHEN jl.source_ledger = 'supplier'  THEN jl.debit - jl.credit ELSE 0 END) AS supplier_gl,
        SUM(CASE WHEN jl.source_ledger = 'inventory' THEN jl.debit - jl.credit ELSE 0 END) AS inventory_gl,
        SUM(CASE WHEN jl.source_ledger = 'manual'    THEN jl.debit - jl.credit ELSE 0 END) AS manual_gl
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
      JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa.company_id = jl.company_id
      LEFT JOIN cost_centers cc ON cc.code = jl.center_code AND cc.company_id = jl.company_id
      WHERE jl.company_id = ? ${jlSeasonWhere}
        AND jl.center_code IS NOT NULL
        AND coa.account_type IN ('expense', 'asset')
      GROUP BY jl.center_code
      ORDER BY gl_net_debit DESC
    `).bind(...jlBinds).all<{
      center_code: number; center_name: string
      gl_expense: number; gl_asset_movement: number; gl_net_debit: number; entry_count: number
      cash_gl: number; supplier_gl: number; inventory_gl: number; manual_gl: number
    }>(),

    // GL monthly timeline — expense debits per (year, month) from journal lines
    c.env.DB.prepare(`
      SELECT
        CAST(strftime('%Y', je.entry_date) AS INTEGER) AS year,
        CAST(strftime('%m', je.entry_date) AS INTEGER) AS month,
        SUM(CASE WHEN jl.source_ledger = 'cash'      THEN jl.debit ELSE 0 END) AS cash_gl,
        SUM(CASE WHEN jl.source_ledger = 'supplier'  THEN jl.debit ELSE 0 END) AS supplier_gl,
        SUM(CASE WHEN jl.source_ledger = 'inventory' THEN jl.debit ELSE 0 END) AS inventory_gl,
        SUM(CASE WHEN coa.account_type = 'expense'   THEN jl.debit ELSE 0 END) AS total_expense_gl
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
      JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa.company_id = jl.company_id
      WHERE jl.company_id = ? ${jlSeasonWhere}
        AND coa.account_type IN ('expense', 'asset')
      GROUP BY year, month
      ORDER BY year, month
    `).bind(...jlBinds).all<{
      year: number; month: number
      cash_gl: number; supplier_gl: number; inventory_gl: number; total_expense_gl: number
    }>(),

    // GL totals by source_ledger — gives total GL-posted amounts per module
    c.env.DB.prepare(`
      SELECT
        jl.source_ledger,
        SUM(jl.debit)  AS total_debit,
        SUM(jl.credit) AS total_credit,
        COUNT(DISTINCT jl.entry_id) AS entries
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
      WHERE jl.company_id = ? ${jlSeasonWhere}
      GROUP BY jl.source_ledger
    `).bind(...jlBinds).all<{
      source_ledger: string; total_debit: number; total_credit: number; entries: number
    }>(),

    // Ops: expense type breakdown from cash_transactions (annotation only)
    c.env.DB.prepare(`
      SELECT
        COALESCE(ct.expense_code, 0)    AS expense_code,
        COALESCE(et.name, 'أخرى')      AS expense_name,
        SUM(ct.amount)                  AS ops_total,
        COUNT(ct.id)                    AS cnt
      FROM cash_transactions ct
      LEFT JOIN expense_types et ON et.code = ct.expense_code AND et.company_id = ct.company_id
      WHERE ct.company_id = ? AND ct.direction = 'م' AND ct.status = 'posted' ${seasonWhere}
      GROUP BY ct.expense_code
      ORDER BY ops_total DESC
    `).bind(...cashBinds).all<{
      expense_code: number; expense_name: string; ops_total: number; cnt: number
    }>(),

    // Ops: supplier breakdown (annotation only)
    c.env.DB.prepare(`
      SELECT
        s.code                                    AS supplier_code,
        s.name                                    AS supplier_name,
        s.activity,
        COALESCE(SUM(st.credit), 0)               AS ops_credit,
        COALESCE(SUM(st.debit),  0)               AS ops_debit,
        COALESCE(SUM(st.credit) - SUM(st.debit), 0) AS ops_balance,
        COUNT(st.id)                              AS tx_count
      FROM suppliers s
      LEFT JOIN supplier_transactions st
        ON st.supplier_code = s.code AND st.company_id = s.company_id AND st.status = 'posted'
        ${seasonWhere ? 'AND ' + seasonWhere.slice(4) : ''}
      WHERE s.company_id = ?
      GROUP BY s.code
      HAVING ops_credit > 0 OR ops_debit > 0
      ORDER BY ops_credit DESC
    `).bind(...(seasonId ? [seasonId, company_id] : [company_id])).all<{
      supplier_code: number; supplier_name: string; activity: string | null
      ops_credit: number; ops_debit: number; ops_balance: number; tx_count: number
    }>(),

    // Ops: inventory consumed per item (annotation only)
    c.env.DB.prepare(`
      SELECT
        im.item_code,
        COALESCE(i.name, CAST(im.item_code AS TEXT)) AS item_name,
        i.unit,
        SUM(im.qty_out)   AS ops_qty_out,
        SUM(im.value_out) AS ops_value_out
      FROM inventory_movements im
      LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
      WHERE im.company_id = ? AND im.movement_type IN ('صرف', 'ISSUE') ${seasonWhere}
      GROUP BY im.item_code
      ORDER BY ops_value_out DESC
    `).bind(...invBinds).all<{
      item_code: number; item_name: string; unit: string | null
      ops_qty_out: number; ops_value_out: number
    }>(),

    // Ops center totals for coverage computation
    c.env.DB.prepare(`
      SELECT center_code,
        SUM(cash_amt) + SUM(sup_amt) + SUM(inv_amt) AS ops_total
      FROM (
        SELECT center_code, SUM(amount) AS cash_amt, 0 AS sup_amt, 0 AS inv_amt
        FROM cash_transactions
        WHERE company_id = ? AND direction = 'م' AND status = 'posted'
          AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
        UNION ALL
        SELECT center_code, 0, SUM(credit), 0
        FROM supplier_transactions
        WHERE company_id = ? AND status = 'posted'
          AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
        UNION ALL
        SELECT center_code, 0, 0, SUM(value_out)
        FROM inventory_movements
        WHERE company_id = ? AND movement_type IN ('صرف','ISSUE')
          AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
      )
      GROUP BY center_code
    `).bind(...cashBinds, ...supBinds, ...invBinds).all<{
      center_code: number; ops_total: number
    }>(),
  ])

  // Build ops coverage map
  const opsCoverageMap: Record<number, number> = {}
  for (const r of opsCenterTotals.results) opsCoverageMap[r.center_code] = r.ops_total

  // Merge GL centers with ops coverage annotation
  const byCostCenter = glByCostCenter.results.map(r => ({
    ...r,
    ops_total:      opsCoverageMap[r.center_code] ?? null,
    // How much of the ops total made it into GL (null if no ops data)
    gl_coverage_pct: opsCoverageMap[r.center_code]
      ? Math.round((r.gl_net_debit / opsCoverageMap[r.center_code]) * 100)
      : null,
    _note: opsCoverageMap[r.center_code] == null
      ? 'لا يوجد بيانات تشغيلية لهذا المركز — يُحدَّث عند ربط الحركات بمركز التكلفة'
      : null,
  }))

  // GL totals by source
  const glSourceMap: Record<string, { debit: number; credit: number; entries: number }> = {}
  for (const r of glBySourceLedger.results) {
    glSourceMap[r.source_ledger] = { debit: r.total_debit, credit: r.total_credit, entries: r.entries }
  }

  const glCashTotal     = glSourceMap['cash']?.debit     ?? 0
  const glSupTotal      = glSourceMap['supplier']?.debit  ?? 0
  const glInvTotal      = glSourceMap['inventory']?.debit ?? 0
  const glManualTotal   = glSourceMap['manual']?.debit    ?? 0
  const glGrandTotal    = glCashTotal + glSupTotal + glInvTotal + glManualTotal

  // Ops totals for gap annotation
  const opsCashTotal = (await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS t FROM cash_transactions WHERE company_id=? AND direction='م' AND status='posted' ${seasonWhere}`
  ).bind(...cashBinds).first<{ t: number }>())?.t ?? 0
  const opsSupTotal = (await c.env.DB.prepare(
    `SELECT COALESCE(SUM(credit),0) AS t FROM supplier_transactions WHERE company_id=? AND status='posted' ${seasonWhere}`
  ).bind(...supBinds).first<{ t: number }>())?.t ?? 0
  const opsInvTotal = (await c.env.DB.prepare(
    `SELECT COALESCE(SUM(value_out),0) AS t FROM inventory_movements WHERE company_id=? AND movement_type IN ('صرف','ISSUE') ${seasonWhere}`
  ).bind(...invBinds).first<{ t: number }>())?.t ?? 0

  return c.json({
    success: true,
    data: {
      season: seasonData,
      // ── Primary: GL-derived breakdowns ─────────────────────────────────
      by_cost_center:    byCostCenter,
      monthly_timeline:  glMonthlyTimeline.results,
      gl_totals: {
        cash:      glCashTotal,
        supplier:  glSupTotal,
        inventory: glInvTotal,
        manual:    glManualTotal,
        total:     glGrandTotal,
        by_source: glBySourceLedger.results,
      },
      // ── Annotations: ops data not yet in GL ────────────────────────────
      // These are informational. If ops_total >> gl_total for a module,
      // it means transactions exist that haven't been posted to GL yet.
      ops_annotations: {
        by_expense_type:  opsByExpenseType.results,
        by_supplier:      opsBySupplier.results,
        by_inventory_item: opsByInventoryItem.results,
        totals: {
          ops_cash:      opsCashTotal,
          ops_supplier:  opsSupTotal,
          ops_inventory: opsInvTotal,
          ops_total:     opsCashTotal + opsSupTotal + opsInvTotal,
        },
        // Gap = ops value not yet posted to GL
        gaps: {
          cash_gap:      Math.max(0, opsCashTotal - glCashTotal),
          supplier_gap:  Math.max(0, opsSupTotal  - glSupTotal),
          inventory_gap: Math.max(0, opsInvTotal  - glInvTotal),
          _note: 'الفجوة = قيمة موجودة في الجداول التشغيلية لكن لم تُرحَّل بعد إلى دفتر الأستاذ. راجع صندوق انتظار الترحيل.',
        },
      },
    },
  })
})

season.get('/season-pnl', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  if (!seasonId) {
    return c.json({ success: false, error: 'season_id مطلوب' }, 400)
  }

  const [
    seasonData,
    // ── GL primary: revenue from posted journal lines ──────────────────────
    glRevenueRows,
    // ── GL primary: expenses from posted journal lines by account ──────────
    glExpenseRows,
    // ── GL primary: expense total by source_ledger (for coverage breakdown) ─
    glBySource,
    // ── GL primary: per-field expense from journal lines ───────────────────
    glByField,
    // ── Area for per-feddan margin ─────────────────────────────────────────
    areaRow,
    // ── Ops revenue annotation: contracts (not yet all in GL) ─────────────
    opsRevenueRow,
    // ── Ops cost annotations (each labeled, used to show GL coverage gaps) ─
    opsInvCostRow,
    opsLaborCostRow,
    opsEquipmentCostRow,
    opsCashCostRow,
    opsSupCostRow,
    opsRentCostRow,
    opsPayrollCostRow,
    opsDepreciationRow,
    // ── Per-field detail (ops-enriched with GL where available) ───────────
    byField,
  ] = await Promise.all([

    c.env.DB.prepare(
      'SELECT id, name, season_type, start_date, end_date, status FROM seasons WHERE id = ? AND company_id = ?'
    ).bind(seasonId, company_id).first<{
      id: number; name: string; season_type: string
      start_date: string; end_date: string; status: string
    }>(),

    // GL Revenue: credit side of revenue accounts in this season
    c.env.DB.prepare(`
      SELECT
        coa.code                               AS account_code,
        coa.name                               AS account_name,
        coa.mapping                            AS mapping,
        COALESCE(SUM(jl.credit - jl.debit), 0) AS net_amount,
        COUNT(DISTINCT jl.entry_id)            AS entry_count
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
      JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa.company_id = jl.company_id
      WHERE jl.company_id = ? AND jl.season_id = ?
        AND coa.account_type = 'revenue'
      GROUP BY coa.code
      ORDER BY net_amount DESC
    `).bind(company_id, seasonId).all<{
      account_code: string; account_name: string; mapping: string | null
      net_amount: number; entry_count: number
    }>(),

    // GL Expenses: debit side of expense accounts in this season, grouped by account
    c.env.DB.prepare(`
      SELECT
        coa.code                               AS account_code,
        coa.name                               AS account_name,
        coa.mapping                            AS mapping,
        jl.source_ledger,
        COALESCE(SUM(jl.debit - jl.credit), 0) AS net_amount,
        COUNT(DISTINCT jl.entry_id)            AS entry_count
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
      JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa.company_id = jl.company_id
      WHERE jl.company_id = ? AND jl.season_id = ?
        AND coa.account_type = 'expense'
      GROUP BY coa.code, jl.source_ledger
      ORDER BY net_amount DESC
    `).bind(company_id, seasonId).all<{
      account_code: string; account_name: string; mapping: string | null
      source_ledger: string; net_amount: number; entry_count: number
    }>(),

    // GL by source_ledger — total expense debits per module
    c.env.DB.prepare(`
      SELECT
        jl.source_ledger,
        COALESCE(SUM(CASE WHEN coa.account_type='expense' THEN jl.debit - jl.credit ELSE 0 END), 0) AS expense_total,
        COALESCE(SUM(CASE WHEN coa.account_type='revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) AS revenue_total
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
      JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa.company_id = jl.company_id
      WHERE jl.company_id = ? AND jl.season_id = ?
      GROUP BY jl.source_ledger
    `).bind(company_id, seasonId).all<{
      source_ledger: string; expense_total: number; revenue_total: number
    }>(),

    // GL per-field expenses: join through journal lines → field_id
    c.env.DB.prepare(`
      SELECT
        jl.field_id,
        COALESCE(SUM(CASE WHEN coa.account_type='expense' THEN jl.debit - jl.credit ELSE 0 END), 0) AS gl_field_expense,
        COALESCE(SUM(CASE WHEN coa.account_type='revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) AS gl_field_revenue
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
      JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa.company_id = jl.company_id
      WHERE jl.company_id = ? AND jl.season_id = ? AND jl.field_id IS NOT NULL
      GROUP BY jl.field_id
    `).bind(company_id, seasonId).all<{
      field_id: number; gl_field_expense: number; gl_field_revenue: number
    }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(area_feddan), 0) AS total FROM fields WHERE company_id = ? AND season_id = ?
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Ops revenue annotation (contracts — source of truth for billing, GL covers posted advances)
    c.env.DB.prepare(`
      SELECT
        COUNT(*) AS contracts_count,
        COALESCE(SUM(quantity_ton * unit_price), 0) AS contracts_value,
        COALESCE(SUM(advance_paid), 0) AS advance_collected
      FROM sales_contracts
      WHERE company_id = ? AND season_id = ? AND status NOT IN ('cancelled','draft')
    `).bind(company_id, seasonId).first<{
      contracts_count: number; contracts_value: number; advance_collected: number
    }>(),

    // Ops cost annotations — these show what's in operational tables
    // The gap vs GL is the unposted amount
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(value_out),0) AS total FROM inventory_movements
      WHERE company_id=? AND season_id=? AND movement_type IN ('صرف','ISSUE')
    `).bind(company_id, seasonId).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(wt.quantity * wt.unit_cost),0) AS total
      FROM work_tasks wt JOIN work_orders wo ON wo.id=wt.work_order_id AND wo.company_id=wt.company_id
      WHERE wo.company_id=? AND wo.season_id=?
    `).bind(company_id, seasonId).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(woe.total_cost),0) AS total
      FROM work_order_equipment woe
      JOIN work_orders wo ON wo.id=woe.work_order_id AND wo.company_id=woe.company_id
      WHERE wo.company_id=? AND wo.season_id=?
    `).bind(company_id, seasonId).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(amount),0) AS total FROM cash_transactions
      WHERE company_id=? AND season_id=? AND direction='م' AND status='posted' AND supplier_code IS NULL
    `).bind(company_id, seasonId).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(credit),0) AS total FROM supplier_transactions
      WHERE company_id=? AND season_id=? AND status='posted'
        AND document_type NOT IN ('purchase_order','inventory_receive')
    `).bind(company_id, seasonId).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(rent_per_feddan * area_feddan),0) AS total
      FROM fields WHERE company_id=? AND season_id=? AND rent_per_feddan > 0
    `).bind(company_id, seasonId).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(total_net),0) AS total FROM payroll_runs
      WHERE company_id=? AND season_id=? AND status IN ('approved','paid')
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Depreciation allocated to this season (assets with season_id = seasonId)
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(ds.amount),0) AS total
      FROM depreciation_schedules ds
      JOIN fixed_assets fa ON fa.id = ds.asset_id AND fa.company_id = ds.company_id
      WHERE ds.company_id=? AND fa.season_id=? AND ds.status='posted'
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Per-field detail: ops revenue + GL cost where available, ops cost as fallback
    c.env.DB.prepare(`
      SELECT
        f.id, f.code, f.name AS field_name, f.area_feddan, f.crop_type,
        COALESCE(SUM(sc.quantity_ton * sc.unit_price), 0) AS ops_revenue,
        COALESCE(inv.inv_cost, 0)       AS ops_inv_cost,
        COALESCE(lab.labor_cost, 0)     AS ops_labor_cost,
        COALESCE(eq.equipment_cost, 0)  AS ops_equipment_cost,
        COALESCE(cash.cash_cost, 0)     AS ops_cash_cost
      FROM fields f
      LEFT JOIN sales_contracts sc
             ON sc.field_id=f.id AND sc.company_id=f.company_id AND sc.season_id=?
             AND sc.status NOT IN ('cancelled','draft')
      LEFT JOIN (
        SELECT field_id, SUM(value_out) AS inv_cost
        FROM inventory_movements
        WHERE company_id=? AND season_id=?
          AND movement_type IN ('ISSUE','TRANSFER_OUT','COGS_ADJUSTMENT','PRODUCTION_INPUT','ADJUSTMENT_LOSS')
          AND field_id IS NOT NULL
        GROUP BY field_id
      ) inv ON inv.field_id=f.id
      LEFT JOIN (
        SELECT wo.field_id, SUM(wt.quantity * wt.unit_cost) AS labor_cost
        FROM work_tasks wt JOIN work_orders wo ON wo.id=wt.work_order_id AND wo.company_id=wt.company_id
        WHERE wo.company_id=? AND wo.season_id=? AND wo.field_id IS NOT NULL
        GROUP BY wo.field_id
      ) lab ON lab.field_id=f.id
      LEFT JOIN (
        SELECT wo.field_id, SUM(woe.total_cost) AS equipment_cost
        FROM work_order_equipment woe
        JOIN work_orders wo ON wo.id=woe.work_order_id AND wo.company_id=woe.company_id
        WHERE wo.company_id=? AND wo.season_id=? AND wo.field_id IS NOT NULL
        GROUP BY wo.field_id
      ) eq ON eq.field_id=f.id
      LEFT JOIN (
        SELECT field_id, SUM(amount) AS cash_cost
        FROM cash_transactions
        WHERE company_id=? AND season_id=? AND direction='م' AND status='posted' AND field_id IS NOT NULL
        GROUP BY field_id
      ) cash ON cash.field_id=f.id
      WHERE f.company_id=? AND f.season_id=?
      GROUP BY f.id ORDER BY ops_revenue DESC
    `).bind(
      seasonId,
      company_id, seasonId,
      company_id, seasonId,
      company_id, seasonId,
      company_id, seasonId,
      company_id, seasonId,
    ).all<{
      id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
      ops_revenue: number; ops_inv_cost: number; ops_labor_cost: number
      ops_equipment_cost: number; ops_cash_cost: number
    }>(),
  ])

  // ── Aggregate GL numbers ──────────────────────────────────────────────────
  const glTotalRevenue  = glRevenueRows.results.reduce((s, r) => s + r.net_amount, 0)
  const glTotalExpense  = glExpenseRows.results.reduce((s, r) => s + r.net_amount, 0)
  const glNetIncome     = glTotalRevenue - glTotalExpense

  const glSourceMap: Record<string, { expense: number; revenue: number }> = {}
  for (const r of glBySource.results) {
    glSourceMap[r.source_ledger] = { expense: r.expense_total, revenue: r.revenue_total }
  }

  // ── Ops totals (annotation) ───────────────────────────────────────────────
  const opsInvCost       = opsInvCostRow?.total       ?? 0
  const opsLaborCost     = opsLaborCostRow?.total     ?? 0
  const opsEquipmentCost = opsEquipmentCostRow?.total ?? 0
  const opsCashCost      = opsCashCostRow?.total      ?? 0
  const opsSupCost       = opsSupCostRow?.total       ?? 0
  const opsRentCost      = opsRentCostRow?.total      ?? 0
  const opsPayroll       = opsPayrollCostRow?.total       ?? 0
  const opsDepreciation  = opsDepreciationRow?.total      ?? 0
  const opsTotalCost     = opsInvCost + opsLaborCost + opsEquipmentCost + opsCashCost + opsSupCost + opsRentCost + opsPayroll + opsDepreciation
  const opsRevenue    = opsRevenueRow?.contracts_value ?? 0

  // ── Per-field enrichment with GL data ────────────────────────────────────
  const glFieldMap: Record<number, { gl_field_expense: number; gl_field_revenue: number }> = {}
  for (const r of glByField.results) glFieldMap[r.field_id] = r

  const totalArea = areaRow?.total ?? 0
  const enrichedFields = byField.results.map(f => {
    const gl = glFieldMap[f.id]
    // Prefer GL cost if available; fall back to full ops cost (inv + labor + equipment + direct cash)
    const fieldExpense   = gl?.gl_field_expense ?? (f.ops_inv_cost + f.ops_labor_cost + f.ops_equipment_cost + f.ops_cash_cost)
    const fieldRevenue   = gl?.gl_field_revenue ?? f.ops_revenue
    const fieldMargin    = fieldRevenue - fieldExpense
    return {
      ...f,
      gl_field_expense:  gl?.gl_field_expense  ?? null,
      gl_field_revenue:  gl?.gl_field_revenue  ?? null,
      // ops fallback shown when GL has no lines for this field
      field_cost:        fieldExpense,
      field_revenue:     fieldRevenue,
      field_margin:      fieldMargin,
      margin_per_feddan: f.area_feddan > 0 ? fieldMargin / f.area_feddan : null,
      inv_cost:          f.ops_inv_cost,
      labor_cost:        f.ops_labor_cost,
      equipment_cost:    f.ops_equipment_cost,
      cash_cost:         f.ops_cash_cost,
      cost_source:       gl ? 'gl' : 'ops_fallback',
      _note:             !gl
        ? 'تكاليف الحقل مستخرجة من الجداول التشغيلية — لم تُرحَّل قيود GL للحقل بعد'
        : null,
    }
  })

  return c.json({
    success: true,
    data: {
      season: seasonData,

      // ── PRIMARY: GL-derived P&L ─────────────────────────────────────────
      gl_pnl: {
        revenue:    glTotalRevenue,
        expenses:   glTotalExpense,
        net_income: glNetIncome,
        margin_pct: glTotalRevenue > 0
          ? Math.round((glNetIncome / glTotalRevenue) * 1000) / 10
          : null,
        // Detailed GL lines — ready for a full account-level P&L statement
        revenue_lines:  glRevenueRows.results,
        expense_lines:  glExpenseRows.results,
        by_source: glBySource.results,
        _note: glTotalExpense === 0 && glTotalRevenue === 0
          ? 'لا توجد قيود GL مرحَّلة لهذا الموسم بعد — تظهر الأرقام التشغيلية في ops_annotations'
          : null,
      },

      // ── ANNOTATION: ops-derived P&L (what's in system, not yet all in GL) ─
      ops_annotations: {
        revenue: {
          contracts_value:   opsRevenue,
          advance_collected: opsRevenueRow?.advance_collected ?? 0,
          contracts_count:   opsRevenueRow?.contracts_count   ?? 0,
        },
        costs: {
          inventory:       opsInvCost,
          labor:           opsLaborCost,
          equipment:       opsEquipmentCost,
          cash_out:        opsCashCost,
          supplier_credit: opsSupCost,
          land_rent:       opsRentCost,
          payroll:         opsPayroll,
          depreciation:    opsDepreciation,
          total:           opsTotalCost,
        },
        net_margin:    opsRevenue - opsTotalCost,
        margin_pct:    opsRevenue > 0
          ? Math.round(((opsRevenue - opsTotalCost) / opsRevenue) * 1000) / 10
          : null,
        // Gap = ops amount not yet visible in GL
        gl_coverage: {
          revenue_gap:  Math.max(0, opsRevenue   - glTotalRevenue),
          expense_gap:  Math.max(0, opsTotalCost - glTotalExpense),
          _note: 'الفجوة = قيمة في الجداول التشغيلية لم تُرحَّل إلى دفتر الأستاذ بعد. صفر يعني تغطية كاملة.',
        },
      },

      // ── Per-field breakdown ─────────────────────────────────────────────
      by_field:         enrichedFields,
      total_area:       totalArea,
      margin_per_feddan: totalArea > 0 ? glNetIncome / totalArea : null,
    },
  })
})

season.get('/season-readiness', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null
  if (!seasonId) return c.json({ success: false, error: 'season_id مطلوب' }, 400)

  const [
    seasonData,
    openWORow,
    draftPayrollRow,
    draftSupTxRow,
    uncostedHRow,
    fieldsNoHRow,
    activeConRow,
    totalFieldsRow,
    totalHarvestsRow,
  ] = await Promise.all([

    c.env.DB.prepare(
      'SELECT id, name, season_type, start_date, end_date, status FROM seasons WHERE id = ? AND company_id = ?'
    ).bind(seasonId, company_id).first<{
      id: number; name: string; season_type: string
      start_date: string; end_date: string; status: string
    }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM work_orders WHERE company_id = ? AND season_id = ?
       AND status NOT IN ('costed','cancelled')`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM payroll_runs WHERE company_id = ? AND season_id = ? AND status = 'draft'`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM supplier_transactions WHERE company_id = ? AND season_id = ? AND status != 'posted'`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM harvest_records WHERE company_id = ? AND season_id = ?
       AND (actual_cost IS NULL OR actual_cost = 0) AND qty_tons > 0`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM fields f
       WHERE f.company_id = ? AND f.season_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM harvest_records hr
           WHERE hr.field_id = f.id AND hr.company_id = f.company_id AND hr.season_id = f.season_id
         )`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sales_contracts WHERE company_id = ? AND season_id = ?
       AND status IN ('draft','active','partial')`
    ).bind(company_id, seasonId).first<{ n: number }>(),

    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM fields WHERE company_id = ? AND season_id = ?`)
      .bind(company_id, seasonId).first<{ n: number }>(),

    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM harvest_records WHERE company_id = ? AND season_id = ?`)
      .bind(company_id, seasonId).first<{ n: number }>(),
  ])

  if (!seasonData) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  const totalFields   = totalFieldsRow?.n   ?? 0
  const totalHarvests = totalHarvestsRow?.n ?? 0

  const checks = [
    {
      key:         'open_work_orders',
      label:       'أوامر العمل المفتوحة',
      description: 'أوامر عمل لم تُكلَّف أو تُلغَ بعد لهذا الموسم',
      count:       openWORow?.n ?? 0,
      ok:          (openWORow?.n ?? 0) === 0,
      blocker:     true,
      action_url:  '/operations',
    },
    {
      key:         'draft_payroll',
      label:       'مسيرات رواتب مسودة',
      description: 'مسيرات مُسندة لهذا الموسم ولم تُعتمد أو تُدفع بعد',
      count:       draftPayrollRow?.n ?? 0,
      ok:          (draftPayrollRow?.n ?? 0) === 0,
      blocker:     true,
      action_url:  '/hr/payroll',
    },
    {
      key:         'draft_supplier_tx',
      label:       'معاملات موردين غير مُرحَّلة',
      description: 'فواتير أو حركات موردين بحالة مسودة مرتبطة بهذا الموسم',
      count:       draftSupTxRow?.n ?? 0,
      ok:          (draftSupTxRow?.n ?? 0) === 0,
      blocker:     true,
      action_url:  '/suppliers',
    },
    {
      key:         'uncosted_harvests',
      label:       'حصادات غير مُكلَّفة',
      description: 'سجلات حصاد بتكلفة فعلية صفر أو غير محددة مع وجود كميات',
      count:       uncostedHRow?.n ?? 0,
      ok:          (uncostedHRow?.n ?? 0) === 0,
      blocker:     false,
      action_url:  '/fields/harvest',
    },
    {
      key:         'fields_without_harvest',
      label:       'حقول بدون سجل حصاد',
      description: `${totalFields} حقل في الموسم — ${totalFields - (fieldsNoHRow?.n ?? 0)} مسجَّل`,
      count:       fieldsNoHRow?.n ?? 0,
      ok:          (fieldsNoHRow?.n ?? 0) === 0,
      blocker:     false,
      action_url:  '/fields/harvest',
    },
    {
      key:         'active_contracts',
      label:       'عقود بيع غير مُكتملة',
      description: 'عقود نشطة أو جزئية لم تُحدَّث إلى "مكتمل" بعد',
      count:       activeConRow?.n ?? 0,
      ok:          (activeConRow?.n ?? 0) === 0,
      blocker:     false,
      action_url:  '/contracts',
    },
  ]

  const blockersFailed = checks.filter(ch => ch.blocker && !ch.ok).length
  const warningsFailed = checks.filter(ch => !ch.blocker && !ch.ok).length
  const passing        = checks.filter(ch => ch.ok).length
  const score          = Math.round((passing / checks.length) * 100)
  const ready          = blockersFailed === 0

  return c.json({
    success: true,
    data: {
      season: seasonData,
      checks,
      summary: {
        blockers_failed: blockersFailed,
        warnings_failed: warningsFailed,
        passing,
        total:           checks.length,
        score,
        ready,
        total_fields:    totalFields,
        total_harvests:  totalHarvests,
      },
    },
  })
})

// ── GET /reports/pivot-costs?season_id= ──────────────────────────────────────
// Cost matrix: rows = cost centers (pivots), columns = service type groups
season.get('/pivot-costs', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  if (!seasonId) return c.json({ success: false, error: 'season_id مطلوب' }, 400)

  const seasonRow = await c.env.DB.prepare(
    'SELECT id, name, start_date, end_date FROM seasons WHERE id = ? AND company_id = ?'
  ).bind(seasonId, company_id).first<{ id: number; name: string; start_date: string; end_date: string }>()

  if (!seasonRow) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  const { start_date, end_date } = seasonRow

  const [supRows, cashRows, invRows, centerRows, metaRows] = await Promise.all([
    c.env.DB.prepare(`
      SELECT st.center_code,
             COALESCE(sv.service_group, 'OTHER') AS service_group,
             SUM(st.credit) AS total
      FROM supplier_transactions st
      LEFT JOIN service_types sv ON sv.company_id = st.company_id AND sv.code = st.service_type_code
      WHERE st.company_id = ? AND st.status = 'posted' AND st.season_id = ?
        AND st.center_code IS NOT NULL
      GROUP BY st.center_code, service_group
    `).bind(company_id, seasonId).all<{ center_code: number; service_group: string; total: number }>(),

    c.env.DB.prepare(`
      SELECT ct.center_code,
             COALESCE(sv.service_group, 'OTHER') AS service_group,
             SUM(ct.amount) AS total
      FROM cash_transactions ct
      LEFT JOIN service_types sv ON sv.company_id = ct.company_id AND sv.code = ct.service_type_code
      WHERE ct.company_id = ? AND ct.status = 'posted'
        AND ct.transaction_date BETWEEN ? AND ?
        AND ct.center_code IS NOT NULL
      GROUP BY ct.center_code, service_group
    `).bind(company_id, start_date, end_date).all<{ center_code: number; service_group: string; total: number }>(),

    c.env.DB.prepare(`
      SELECT im.center_code, 'SUPPLY' AS service_group, SUM(im.value_out) AS total
      FROM inventory_movements im
      WHERE im.company_id = ? AND im.movement_type = 'ISSUE'
        AND im.movement_date BETWEEN ? AND ?
        AND im.center_code IS NOT NULL
      GROUP BY im.center_code
    `).bind(company_id, start_date, end_date).all<{ center_code: number; service_group: string; total: number }>(),

    c.env.DB.prepare(
      `SELECT code, name_ar, name_en FROM cost_centers WHERE company_id = ? ORDER BY code`
    ).bind(company_id).all<{ code: number; name_ar: string; name_en: string }>(),

    c.env.DB.prepare(`
      SELECT 
        COUNT(*) AS total_movements,
        SUM(CASE WHEN center_code IS NULL THEN 1 ELSE 0 END) AS null_center_code,
        SUM(CASE WHEN service_type_code IS NULL THEN 1 ELSE 0 END) AS null_service_type_code,
        SUM(CASE WHEN season_id IS NULL AND (movement_date < ? OR movement_date > ?) THEN 1 ELSE 0 END) AS null_season_id,
        SUM(CASE WHEN movement_date > date('now') THEN 1 ELSE 0 END) AS future_blocked
      FROM inventory_movements
      WHERE company_id = ? AND movement_type = 'ISSUE'
        AND movement_date BETWEEN ? AND ?
    `).bind(start_date, end_date, company_id, start_date, end_date).first<{
      total_movements: number;
      null_center_code: number;
      null_service_type_code: number;
      null_season_id: number;
      future_blocked: number;
    }>(),
  ])

  const centerMap: Record<number, string> = {}
  for (const cc of centerRows.results) {
    centerMap[cc.code] = cc.name_ar || cc.name_en || String(cc.code)
  }

  const matrix: Record<number, Record<string, number>> = {}
  const serviceGroups = new Set<string>()

  for (const row of [...supRows.results, ...cashRows.results, ...invRows.results]) {
    if (!matrix[row.center_code]) matrix[row.center_code] = {}
    matrix[row.center_code][row.service_group] = (matrix[row.center_code][row.service_group] ?? 0) + (row.total ?? 0)
    serviceGroups.add(row.service_group)
  }

  const groups = Array.from(serviceGroups).sort()
  const rows = Object.entries(matrix).map(([code, byGroup]) => {
    const centerCode = Number(code)
    return {
      center_code:      centerCode,
      center_name:      centerMap[centerCode] ?? String(centerCode),
      by_service_group: byGroup,
      total:            Object.values(byGroup).reduce((s, v) => s + v, 0),
    }
  }).sort((a, b) => b.total - a.total)

  const columnTotals: Record<string, number> = {}
  for (const g of groups) columnTotals[g] = rows.reduce((s, r) => s + (r.by_service_group[g] ?? 0), 0)

  const totalMovements = metaRows?.total_movements ?? 0
  const excludedCenter = metaRows?.null_center_code ?? 0
  const includedMovements = totalMovements - excludedCenter

  return c.json({
    success: true,
    data: {
      season: seasonRow,
      service_groups: groups,
      rows,
      column_totals: columnTotals,
      grand_total: rows.reduce((s, r) => s + r.total, 0),
    },
    meta: {
      total_movements: totalMovements,
      included_movements: includedMovements,
      excluded_movements: excludedCenter,
      excluded_reasons: {
        null_season_id: metaRows?.null_season_id ?? 0,
        null_service_type_code: metaRows?.null_service_type_code ?? 0,
        null_center_code: excludedCenter,
        future_blocked: metaRows?.future_blocked ?? 0
      },
      coverage_pct: totalMovements > 0 ? ((includedMovements / totalMovements) * 100).toFixed(1) : '100.0'
    }
  })
})

// ── GET /reports/service-type-summary?season_id= ─────────────────────────────
// Total cost by service type with GL vs ops reconciliation gap
season.get('/service-type-summary', async (c) => {
  const { company_id } = getUser(c)
  const seasonId = c.req.query('season_id') ? Number(c.req.query('season_id')) : null

  if (!seasonId) return c.json({ success: false, error: 'season_id مطلوب' }, 400)

  const seasonRow = await c.env.DB.prepare(
    'SELECT id, name, start_date, end_date FROM seasons WHERE id = ? AND company_id = ?'
  ).bind(seasonId, company_id).first<{ id: number; name: string; start_date: string; end_date: string }>()

  if (!seasonRow) return c.json({ success: false, error: 'الموسم غير موجود' }, 404)

  const { start_date, end_date } = seasonRow

  const [supSvc, cashSvc, invIssue, glExpense, serviceTypeRows] = await Promise.all([
    c.env.DB.prepare(`
      SELECT COALESCE(st.service_type_code, 'UNCLASSIFIED') AS service_type_code,
             SUM(st.credit) AS ops_total, COUNT(*) AS txn_count
      FROM supplier_transactions st
      WHERE st.company_id = ? AND st.status = 'posted' AND st.season_id = ?
      GROUP BY service_type_code
    `).bind(company_id, seasonId).all<{ service_type_code: string; ops_total: number; txn_count: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(ct.service_type_code, 'UNCLASSIFIED') AS service_type_code,
             SUM(ct.amount) AS ops_total, COUNT(*) AS txn_count
      FROM cash_transactions ct
      WHERE ct.company_id = ? AND ct.status = 'posted'
        AND ct.transaction_date BETWEEN ? AND ?
      GROUP BY service_type_code
    `).bind(company_id, start_date, end_date).all<{ service_type_code: string; ops_total: number; txn_count: number }>(),

    c.env.DB.prepare(`
      SELECT 'SRV_SUPPLY' AS service_type_code,
             SUM(value_out) AS ops_total, COUNT(*) AS txn_count
      FROM inventory_movements
      WHERE company_id = ? AND movement_type = 'ISSUE'
        AND movement_date BETWEEN ? AND ?
    `).bind(company_id, start_date, end_date).first<{ service_type_code: string; ops_total: number; txn_count: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(jl.service_type_code, 'UNCLASSIFIED') AS service_type_code,
             SUM(jl.debit) AS gl_total
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id AND je.is_posted = 1
      JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa.company_id = jl.company_id
      WHERE jl.company_id = ? AND jl.season_id = ?
        AND coa.account_type IN ('expense', 'asset') AND jl.debit > 0
      GROUP BY jl.service_type_code
    `).bind(company_id, seasonId).all<{ service_type_code: string; gl_total: number }>(),

    c.env.DB.prepare(
      `SELECT code, name_ar, service_group FROM service_types WHERE company_id = ? AND is_active = 1`
    ).bind(company_id).all<{ code: string; name_ar: string; service_group: string }>(),
  ])

  const svcNameMap: Record<string, { name_ar: string; service_group: string }> = {}
  for (const s of serviceTypeRows.results) svcNameMap[s.code] = { name_ar: s.name_ar, service_group: s.service_group }

  const opsMap: Record<string, { ops_total: number; txn_count: number }> = {}
  const addOps = (k: string, total: number, count: number) => {
    opsMap[k] = { ops_total: (opsMap[k]?.ops_total ?? 0) + total, txn_count: (opsMap[k]?.txn_count ?? 0) + count }
  }
  for (const r of supSvc.results)  addOps(r.service_type_code, r.ops_total, r.txn_count)
  for (const r of cashSvc.results) addOps(r.service_type_code, r.ops_total, r.txn_count)
  if (invIssue?.ops_total) addOps('SRV_SUPPLY', invIssue.ops_total, invIssue.txn_count)

  const glMap: Record<string, number> = {}
  for (const r of glExpense.results) glMap[r.service_type_code] = r.gl_total

  const allKeys = Array.from(new Set([...Object.keys(opsMap), ...Object.keys(glMap)]))
  const rows = allKeys.map(k => {
    const ops = opsMap[k]?.ops_total ?? 0
    const gl  = glMap[k] ?? 0
    return {
      service_type_code: k,
      name_ar:           svcNameMap[k]?.name_ar       ?? k,
      service_group:     svcNameMap[k]?.service_group ?? 'OTHER',
      ops_total:         ops,
      gl_total:          gl,
      gap:               ops - gl,
      gap_pct:           ops > 0 ? Math.round(((ops - gl) / ops) * 10000) / 100 : 0,
      txn_count:         opsMap[k]?.txn_count ?? 0,
    }
  }).sort((a, b) => b.ops_total - a.ops_total)

  const totals = rows.reduce(
    (acc, r) => ({ ops_total: acc.ops_total + r.ops_total, gl_total: acc.gl_total + r.gl_total }),
    { ops_total: 0, gl_total: 0 }
  )

  return c.json({
    success: true,
    data: {
      season: seasonRow,
      rows,
      totals: { ...totals, gap: totals.ops_total - totals.gl_total },
    },
  })
})

export default season
