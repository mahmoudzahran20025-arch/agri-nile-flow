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
      ).bind(seasonId, company_id).first()
    : null

  const seasonWhere = seasonId ? 'AND season_id = ?' : ''
  const cashBinds:  unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const supBinds:   unknown[] = seasonId ? [company_id, seasonId] : [company_id]
  const invBinds:   unknown[] = seasonId ? [company_id, seasonId] : [company_id]

  const [
    byCostCenter,
    byExpenseType,
    bySupplier,
    byInventoryItem,
    cashTotal,
    supplierTotal,
    inventoryConsumed,
    monthlyTimeline,
  ] = await Promise.all([

    c.env.DB.prepare(`
      SELECT
        cc.code                        AS center_code,
        COALESCE(cc.name_ar, cc.name_en) AS center_name,
        COALESCE(cash.cash_total, 0)   AS cash_total,
        COALESCE(sup.sup_total, 0)     AS supplier_total,
        COALESCE(inv.inv_total, 0)     AS inventory_total,
        COALESCE(cash.cash_total, 0) + COALESCE(sup.sup_total, 0) + COALESCE(inv.inv_total, 0) AS grand_total
      FROM cost_centers cc
      LEFT JOIN (
        SELECT center_code, SUM(amount) AS cash_total
        FROM cash_transactions
        WHERE company_id = ? AND direction = 'م' AND status = 'posted' AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
      ) cash ON cash.center_code = cc.code
      LEFT JOIN (
        SELECT center_code, SUM(credit) AS sup_total
        FROM supplier_transactions
        WHERE company_id = ? AND status = 'posted' AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
      ) sup ON sup.center_code = cc.code
      LEFT JOIN (
        SELECT center_code, SUM(value_out) AS inv_total
        FROM inventory_movements
        WHERE company_id = ? AND movement_type = 'صرف' AND center_code IS NOT NULL ${seasonWhere}
        GROUP BY center_code
      ) inv ON inv.center_code = cc.code
      WHERE cc.company_id = ?
        AND (cash.cash_total IS NOT NULL OR sup.sup_total IS NOT NULL OR inv.inv_total IS NOT NULL)
      ORDER BY grand_total DESC
    `).bind(...cashBinds, ...supBinds, ...invBinds, company_id).all<{
      center_code: number; center_name: string
      cash_total: number; supplier_total: number; inventory_total: number; grand_total: number
    }>(),

    c.env.DB.prepare(`
      SELECT
        COALESCE(ct.expense_code, 0)         AS expense_code,
        COALESCE(et.name, 'أخرى')           AS expense_name,
        SUM(ct.amount)                       AS total,
        COUNT(ct.id)                         AS cnt
      FROM cash_transactions ct
      LEFT JOIN expense_types et ON et.code = ct.expense_code AND et.company_id = ct.company_id
      WHERE ct.company_id = ? AND ct.direction = 'م' AND ct.status = 'posted' ${seasonWhere}
      GROUP BY ct.expense_code
      ORDER BY total DESC
    `).bind(...cashBinds).all<{
      expense_code: number; expense_name: string; total: number; cnt: number
    }>(),

    c.env.DB.prepare(`
      SELECT
        s.code                                 AS supplier_code,
        s.name                                 AS supplier_name,
        s.activity,
        COALESCE(SUM(st.credit), 0)            AS total_credit,
        COALESCE(SUM(st.debit),  0)            AS total_debit,
        COALESCE(SUM(st.credit)-SUM(st.debit), 0) AS balance,
        COUNT(st.id)                           AS tx_count
      FROM suppliers s
      LEFT JOIN supplier_transactions st
        ON st.supplier_code = s.code AND st.company_id = s.company_id AND st.status = 'posted'
        ${seasonWhere ? 'AND ' + seasonWhere.slice(4) : ''}
      WHERE s.company_id = ?
      GROUP BY s.code
      HAVING total_credit > 0 OR total_debit > 0
      ORDER BY total_credit DESC
    `).bind(...(seasonId ? [seasonId, company_id] : [company_id])).all<{
      supplier_code: number; supplier_name: string; activity: string | null
      total_credit: number; total_debit: number; balance: number; tx_count: number
    }>(),

    c.env.DB.prepare(`
      SELECT
        im.item_code,
        COALESCE(i.name, CAST(im.item_code AS TEXT)) AS item_name,
        i.unit,
        SUM(im.qty_out)    AS total_qty_out,
        SUM(im.value_out)  AS total_value_out
      FROM inventory_movements im
      LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
      WHERE im.company_id = ? AND im.movement_type = 'صرف' ${seasonWhere}
      GROUP BY im.item_code
      ORDER BY total_value_out DESC
    `).bind(...invBinds).all<{
      item_code: number; item_name: string; unit: string | null
      total_qty_out: number; total_value_out: number
    }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM cash_transactions WHERE company_id = ? AND direction = 'م' AND status = 'posted' ${seasonWhere}
    `).bind(...cashBinds).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(credit), 0) AS credit, COALESCE(SUM(debit), 0) AS debit
      FROM supplier_transactions WHERE company_id = ? AND status = 'posted' ${seasonWhere}
    `).bind(...supBinds).first<{ credit: number; debit: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(value_out), 0) AS total
      FROM inventory_movements WHERE company_id = ? AND movement_type = 'صرف' ${seasonWhere}
    `).bind(...invBinds).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT year, month,
        SUM(CASE WHEN src='cash' THEN amount ELSE 0 END) AS cash_out,
        SUM(CASE WHEN src='sup'  THEN amount ELSE 0 END) AS supplier_credit
      FROM (
        SELECT year, month, amount, 'cash' AS src
        FROM cash_transactions WHERE company_id = ? AND direction = 'م' AND status = 'posted' ${seasonWhere}
        UNION ALL
        SELECT year, month, credit AS amount, 'sup' AS src
        FROM supplier_transactions WHERE company_id = ? AND status = 'posted' ${seasonWhere}
      )
      GROUP BY year, month
      ORDER BY year, month
    `).bind(...cashBinds, ...supBinds).all<{
      year: number; month: number; cash_out: number; supplier_credit: number
    }>(),
  ])

  const cashSum     = cashTotal?.total ?? 0
  const supCredit   = supplierTotal?.credit ?? 0
  const supDebit    = supplierTotal?.debit ?? 0
  const invConsumed = inventoryConsumed?.total ?? 0
  const grandTotal  = cashSum + supCredit + invConsumed

  return c.json({
    success: true,
    data: {
      season: seasonData,
      by_cost_center:     byCostCenter.results,
      by_expense_type:    byExpenseType.results,
      by_supplier:        bySupplier.results,
      by_inventory_item:  byInventoryItem.results,
      monthly_timeline:   monthlyTimeline.results,
      totals: {
        cash_out:          cashSum,
        supplier_credit:   supCredit,
        supplier_debit:    supDebit,
        inventory_consumed: invConsumed,
        grand_total:       grandTotal,
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
    revenueRow,
    invCostRow,
    laborCostRow,
    cashCostRow,
    supCostRow,
    rentCostRow,
    payrollCostRow,
    depreciatioRow,
    wipCostRow,
    areaRow,
    byField,
    glActualsRow,
  ] = await Promise.all([

    c.env.DB.prepare(
      'SELECT id, name, season_type, start_date, end_date, status FROM seasons WHERE id = ? AND company_id = ?'
    ).bind(seasonId, company_id).first<{
      id: number; name: string; season_type: string
      start_date: string; end_date: string; status: string
    }>(),

    // Revenue — excludes cancelled/draft contracts
    c.env.DB.prepare(`
      SELECT
        COUNT(*)                              AS contracts_count,
        COALESCE(SUM(quantity_ton * unit_price), 0) AS contracts_value,
        COALESCE(SUM(advance_paid), 0)        AS advance_collected
      FROM sales_contracts
      WHERE company_id = ? AND season_id = ?
        AND status NOT IN ('cancelled', 'draft')
    `).bind(company_id, seasonId).first<{
      contracts_count: number; contracts_value: number; advance_collected: number
    }>(),

    // Cost 1: Inventory consumed
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(value_out), 0) AS total
      FROM inventory_movements
      WHERE company_id = ? AND season_id = ? AND movement_type = 'صرف'
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 2: Labor
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(wt.quantity * wt.unit_cost), 0) AS total
      FROM work_tasks wt
      JOIN work_orders wo ON wo.id = wt.work_order_id AND wo.company_id = wt.company_id
      WHERE wo.company_id = ? AND wo.season_id = ?
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 3: Cash out — excluding supplier-linked transactions to avoid double counting
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(ct.amount), 0) AS total
      FROM cash_transactions ct
      WHERE ct.company_id = ? AND ct.season_id = ? AND ct.direction = 'م' AND ct.status = 'posted'
        AND (ct.supplier_code IS NULL)
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 4: Supplier — non-inventory expenses only
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(credit), 0) AS total
      FROM supplier_transactions
      WHERE company_id = ? AND season_id = ? AND status = 'posted'
        AND document_type NOT IN ('purchase_order', 'inventory_receive')
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 5: Land rent
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(rent_per_feddan * area_feddan), 0) AS total
      FROM fields
      WHERE company_id = ? AND season_id = ? AND rent_per_feddan > 0
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 6: Payroll
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(total_net), 0) AS total
      FROM payroll_runs
      WHERE company_id = ? AND season_id = ? AND status IN ('approved', 'paid')
    `).bind(company_id, seasonId).first<{ total: number }>(),

    // Cost 7: Depreciation
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM depreciation_schedules ds
      JOIN financial_periods fp ON fp.company_id = ?
        AND fp.start_date <= (ds.period_year || '-' || PRINTF('%02d', ds.period_month) || '-01')
        AND fp.end_date >= (ds.period_year || '-' || PRINTF('%02d', ds.period_month) || '-01')
      WHERE fp.company_id = ? AND fp.season_id = ? AND ds.status = 'posted'
    `).bind(company_id, company_id, seasonId).first<{ total: number }>(),

    // Cost 8: WIP Carry-forward
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(cost_balance), 0) AS total
      FROM wip_balances
      WHERE company_id = ? AND from_season_id = ? AND status IN ('pending', 'carried')
    `).bind(company_id, seasonId).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT COALESCE(SUM(area_feddan), 0) AS total
      FROM fields WHERE company_id = ? AND season_id = ?
    `).bind(company_id, seasonId).first<{ total: number }>(),

    c.env.DB.prepare(`
      SELECT
        f.id, f.code, f.name AS field_name, f.area_feddan, f.crop_type,
        COALESCE(SUM(sc.quantity_ton * sc.unit_price), 0) AS field_revenue,
        COALESCE(inv.inv_cost, 0)                        AS inv_cost,
        COALESCE(lab.labor_cost, 0)                      AS labor_cost,
        COALESCE(inv.inv_cost, 0) + COALESCE(lab.labor_cost, 0) AS field_cost,
        COALESCE(SUM(sc.quantity_ton * sc.unit_price), 0)
          - COALESCE(inv.inv_cost, 0)
          - COALESCE(lab.labor_cost, 0)                  AS field_margin,
        CASE WHEN f.area_feddan > 0
          THEN (COALESCE(SUM(sc.quantity_ton * sc.unit_price), 0)
                - COALESCE(inv.inv_cost, 0)
                - COALESCE(lab.labor_cost, 0)) / f.area_feddan
          ELSE NULL END                                  AS margin_per_feddan
      FROM fields f
      LEFT JOIN sales_contracts sc
             ON sc.field_id = f.id AND sc.company_id = f.company_id AND sc.season_id = ?
             AND sc.status NOT IN ('cancelled', 'draft')
      LEFT JOIN (
        SELECT field_id, SUM(value_out) AS inv_cost
        FROM inventory_movements
        WHERE company_id = ? AND season_id = ? AND movement_type = 'صرف'
          AND field_id IS NOT NULL
        GROUP BY field_id
      ) inv ON inv.field_id = f.id
      LEFT JOIN (
        SELECT wo.field_id, SUM(wt.quantity * wt.unit_cost) AS labor_cost
        FROM work_tasks wt
        JOIN work_orders wo ON wo.id = wt.work_order_id AND wo.company_id = wt.company_id
        WHERE wo.company_id = ? AND wo.season_id = ? AND wo.field_id IS NOT NULL
        GROUP BY wo.field_id
      ) lab ON lab.field_id = f.id
      WHERE f.company_id = ? AND f.season_id = ?
      GROUP BY f.id
      ORDER BY field_margin DESC
    `).bind(seasonId, company_id, seasonId, company_id, seasonId, company_id, seasonId).all<{
      id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
      field_revenue: number; inv_cost: number; labor_cost: number
      field_cost: number; field_margin: number; margin_per_feddan: number | null
    }>(),

    // GL actuals by account_type — source of truth from posted journal lines
    c.env.DB.prepare(`
      SELECT
        coa.account_type,
        COALESCE(SUM(jl.credit - jl.debit), 0) AS net_credit
      FROM journal_entry_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id AND je.company_id = jl.company_id
      JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa.company_id = jl.company_id
      WHERE jl.company_id = ? AND jl.season_id = ? AND je.is_posted = 1
      GROUP BY coa.account_type
    `).bind(company_id, seasonId).all<{ account_type: string; net_credit: number }>(),
  ])

  const revenue      = revenueRow?.contracts_value ?? 0
  const invCost      = invCostRow?.total ?? 0
  const laborCost    = laborCostRow?.total ?? 0
  const cashCost     = cashCostRow?.total ?? 0
  const supCost      = supCostRow?.total ?? 0
  const rentCost     = rentCostRow?.total ?? 0
  const payrollCost  = payrollCostRow?.total ?? 0
  const depreciationCost = depreciatioRow?.total ?? 0
  const wipCost      = wipCostRow?.total ?? 0
  const totalCosts   = invCost + laborCost + cashCost + supCost + rentCost + payrollCost + depreciationCost + wipCost
  const netMargin    = revenue - totalCosts
  const totalArea    = areaRow?.total ?? 0
  const marginPF     = totalArea > 0 ? netMargin / totalArea : null

  const glActualMap: Record<string, number> = {}
  for (const row of (glActualsRow?.results ?? [])) {
    glActualMap[row.account_type] = row.net_credit
  }
  const glRevenue   = glActualMap['revenue']  ?? 0
  const glExpense   = -(glActualMap['expense'] ?? 0)
  const glNetIncome = glRevenue - glExpense

  return c.json({
    success: true,
    data: {
      season: seasonData,
      revenue: {
        contracts_value:    revenue,
        advance_collected:  revenueRow?.advance_collected ?? 0,
        contracts_count:    revenueRow?.contracts_count   ?? 0,
      },
      costs: {
        inventory:        invCost,
        labor:            laborCost,
        cash_out:         cashCost,
        supplier_credit:  supCost,
        land_rent:        rentCost,
        payroll:          payrollCost,
        depreciation:     depreciationCost,
        wip_carryforward: wipCost,
        total:            totalCosts,
      },
      net_margin:          netMargin,
      total_area:          totalArea,
      margin_per_feddan:   marginPF,
      margin_pct:          revenue > 0 ? Math.round((netMargin / revenue) * 1000) / 10 : null,
      by_field:            byField.results,
      gl_actuals: {
        revenue:    glRevenue,
        expenses:   glExpense,
        net_income: glNetIncome,
        by_type:    glActualsRow?.results ?? [],
      },
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

export default season
