import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'
import { FinanceCore } from '../../lib/finance_core'

const payroll = new Hono<{ Bindings: Env }>()

payroll.get('/payroll', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT pr.*, u.full_name AS approved_by_name
              FROM payroll_runs pr
              LEFT JOIN users u ON u.id = pr.approved_by
              WHERE pr.company_id = ?
              ORDER BY pr.period_year DESC, pr.period_month DESC LIMIT 24`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

payroll.get('/payroll/:id', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const [run, items] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(id, company_id).first(),
    c.env.DB.prepare(
      `SELECT pi.*, COALESCE(e.name, '[موظف محذوف]') AS employee_name, e.national_id
       FROM payroll_items pi
       LEFT JOIN employees e ON e.id = pi.employee_id AND e.company_id = pi.company_id
       WHERE pi.payroll_run_id = ? AND pi.company_id = ?
       ORDER BY employee_name`
    ).bind(id, company_id).all(),
  ])
  if (!run) return c.json({ success: false, error: 'المسيرة غير موجودة' }, 404)
  return c.json({ success: true, data: { ...run, items: items.results } })
})

payroll.post('/payroll/run', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{ year: number; month: number; season_id?: number | null }>()
  if (!b.year || !b.month || b.month < 1 || b.month > 12) {
    return c.json({ success: false, error: 'السنة والشهر مطلوبان (1-12)' }, 400)
  }

  const existing = await c.env.DB
    .prepare('SELECT id FROM payroll_runs WHERE company_id = ? AND period_year = ? AND period_month = ?')
    .bind(company_id, b.year, b.month).first<{id:number}>()
  if (existing) {
    return c.json({ success: false, error: 'مسيرة هذا الشهر موجودة بالفعل' }, 409)
  }

  const monthStr  = String(b.month).padStart(2, '0')
  const fromDate  = `${b.year}-${monthStr}-01`
  const toDate    = `${b.year}-${monthStr}-31`

  const { results: employees } = await c.env.DB.prepare(
    `SELECT e.id, e.name, e.daily_wage,
            ejd.base_salary, ejd.housing_allow, ejd.transport_allow,
            ejd.other_allows, ejd.social_insur, ejd.income_tax_pct
     FROM employees e
     LEFT JOIN employee_job_details ejd ON ejd.employee_id = e.id AND ejd.company_id = e.company_id
     WHERE e.company_id = ? AND e.is_active = 1`
  ).bind(company_id).all<{
    id: number; name: string; daily_wage: number
    base_salary: number | null; housing_allow: number | null
    transport_allow: number | null; other_allows: number | null
    social_insur: number | null; income_tax_pct: number | null
  }>()

  if (!employees.length) {
    return c.json({ success: false, error: 'لا يوجد موظفون نشطون' }, 400)
  }

  const { results: attendance } = await c.env.DB.prepare(
    `SELECT employee_id,
            COUNT(CASE WHEN status = 'present' OR status = 'late' THEN 1 END) AS working_days,
            COUNT(CASE WHEN status = 'absent'  THEN 1 END) AS absent_days,
            COALESCE(SUM(overtime_hours), 0)               AS overtime_hours
     FROM attendance_records
     WHERE company_id = ? AND work_date BETWEEN ? AND ?
     GROUP BY employee_id`
  ).bind(company_id, fromDate, toDate).all<{
    employee_id: number; working_days: number; absent_days: number; overtime_hours: number
  }>()

  const { results: advances } = await c.env.DB.prepare(
    `SELECT sa.employee_id,
            SUM(sa.amount / sa.repay_months) AS monthly_deduct
     FROM salary_advances sa
     WHERE sa.company_id = ? AND sa.status = 'approved'
       AND (
         SELECT COUNT(*) FROM payroll_runs pr
         WHERE pr.company_id = sa.company_id
           AND pr.status IN ('approved','paid')
           AND pr.period_year * 12 + pr.period_month
               > (strftime('%Y', sa.approved_at) * 12 + strftime('%m', sa.approved_at))
       ) < sa.repay_months
     GROUP BY sa.employee_id`
  ).bind(company_id).all<{ employee_id: number; monthly_deduct: number }>()

  const attMap = new Map(attendance.map(a => [a.employee_id, a]))
  const advMap = new Map(advances.map(a => [a.employee_id, a.monthly_deduct]))

  const runResult = await c.env.DB.prepare(
    `INSERT INTO payroll_runs (company_id, period_year, period_month, run_date, status, created_by, season_id)
     VALUES (?,?,?,date('now'),'draft',?,?)`
  ).bind(company_id, b.year, b.month, userId, b.season_id ?? null).run()
  const runId = runResult.meta.last_row_id

  let totalGross = 0, totalDeductions = 0, totalNet = 0

  const itemStmts = employees.map(emp => {
    const att   = attMap.get(emp.id)
    const adv   = advMap.get(emp.id) ?? 0
    const baseSalary = emp.base_salary ?? emp.daily_wage * 26

    const workingDays  = att?.working_days  ?? 0
    const absentDays   = att?.absent_days   ?? 0
    const overtimeHrs  = att?.overtime_hours ?? 0

    const dailyRate    = baseSalary / 26
    const earnedBase   = workingDays > 0 ? baseSalary - (absentDays * dailyRate) : 0
    const housing      = emp.housing_allow    ?? 0
    const transport    = emp.transport_allow  ?? 0
    const otherAllows  = emp.other_allows     ?? 0
    const overtimePay  = overtimeHrs * (dailyRate / 8) * 1.5
    const gross        = Math.max(0, earnedBase + housing + transport + otherAllows + overtimePay)

    const socialInsur  = emp.social_insur ?? 0
    const incomeTax    = gross * ((emp.income_tax_pct ?? 0) / 100)
    const totalDeduct  = socialInsur + incomeTax + adv
    const net          = Math.max(0, gross - totalDeduct)

    totalGross      += gross
    totalDeductions += totalDeduct
    totalNet        += net

    return c.env.DB.prepare(
      `INSERT INTO payroll_items
       (payroll_run_id, employee_id, company_id, working_days, absent_days, overtime_hours,
        base_salary, housing_allow, transport_allow, other_allows, gross_salary,
        advance_deduct, social_insur, income_tax, other_deductions, net_salary)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      runId, emp.id, company_id, workingDays, absentDays, overtimeHrs,
      earnedBase, housing, transport, otherAllows, gross,
      adv, socialInsur, incomeTax, 0, net
    )
  })

  await c.env.DB.batch(itemStmts)

  await c.env.DB.prepare(
    `UPDATE payroll_runs SET total_gross = ?, total_deductions = ?, total_net = ? WHERE id = ?`
  ).bind(totalGross, totalDeductions, totalNet, runId).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE', table_name: 'payroll_runs', record_id: runId,
    new_value: { year: b.year, month: b.month, season_id: b.season_id ?? null, total_net: totalNet, employees: employees.length },
  })

  return c.json({
    success: true,
    data: { id: runId, total_gross: totalGross, total_deductions: totalDeductions, total_net: totalNet },
  }, 201)
})

payroll.patch('/payroll/:id/approve', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string; total_net: number; period_year: number; period_month: number; season_id: number | null }>()
  if (!run) return c.json({ success: false, error: 'المسيرة غير موجودة' }, 404)
  if (run.status !== 'draft') return c.json({ success: false, error: 'المسيرة ليست في حالة مسودة' }, 400)

  const runDate = `${run.period_year}-${String(run.period_month).padStart(2,'0')}-28`
  let glId: number | null = null
  try {
    glId = await FinanceCore.resolvePayrollPosting(c.env.DB, {
      company_id,
      ref_id:      id,
      amount:      run.total_net,
      date:        runDate,
      description: `مسيرة رواتب ${run.period_year}/${run.period_month}`,
      created_by:  userId,
      season_id:   run.season_id,
    })
  } catch (e: any) {
    return c.json({ success: false, error: `فشل إنشاء القيد المحاسبي للمسيرة: ${e.message}` }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE payroll_runs SET status = 'approved', approved_by = ?, journal_entry_id = ? WHERE id = ?`
  ).bind(userId, glId, id).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'APPROVE', table_name: 'payroll_runs', record_id: id,
    new_value: { total_net: run.total_net, gl_entry_id: glId } })
  return c.json({ success: true, data: null })
})

payroll.patch('/payroll/:id/pay', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { payment_date } = await c.req.json<{ payment_date?: string }>()

  const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string; total_net: number; period_year: number; period_month: number }>()
  if (!run) return c.json({ success: false, error: 'المسيرة غير موجودة' }, 404)
  if (run.status !== 'approved') return c.json({ success: false, error: 'يجب اعتماد المسيرة أولاً قبل الصرف' }, 400)

  const payDate = payment_date ?? new Date().toISOString().slice(0, 10)

  let glId: number | null = null
  try {
    glId = await FinanceCore.resolvePayrollPayment(c.env.DB, {
      company_id, ref_id: id, amount: run.total_net, date: payDate,
      description: `صرف رواتب ${run.period_year}/${run.period_month}`,
      created_by: userId,
    })
  } catch (e: any) {
    return c.json({ success: false, error: `فشل قيد صرف الرواتب: ${e.message}` }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE payroll_runs SET status = 'paid', payment_date = ?, payment_gl_entry_id = ? WHERE id = ?`
  ).bind(payDate, glId, id).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'payroll_runs', record_id: id,
    new_value: { status: 'paid', payment_date: payDate, gl_entry_id: glId } })
  return c.json({ success: true, data: null })
})

export default payroll
