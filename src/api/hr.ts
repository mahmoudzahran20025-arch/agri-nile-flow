import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, permissionGuard } from '../middleware/auth'
import { logAudit } from '../lib/audit'
import { glPayroll, glWagesPayment } from '../lib/gl'

const hr = new Hono<{ Bindings: Env }>()
hr.use('*', authMiddleware)

// ═══════════════════════════════════════════════════════════
// BRANCHES
// ═══════════════════════════════════════════════════════════

hr.get('/branches', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT b.*, e.name AS manager_name
              FROM branches b
              LEFT JOIN employees e ON e.id = b.manager_id AND e.company_id = b.company_id
              WHERE b.company_id = ? ORDER BY b.code`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

hr.post('/branches', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    code: string; name: string; address?: string; city?: string
    phone?: string; manager_id?: number; lat?: number; lng?: number
    geofence_radius_m?: number
  }>()
  if (!b.code || !b.name) return c.json({ success: false, error: 'الكود والاسم مطلوبان' }, 400)
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO branches (company_id, code, name, address, city, phone, manager_id, lat, lng, geofence_radius_m)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(company_id, b.code, b.name, b.address ?? null, b.city ?? null,
           b.phone ?? null, b.manager_id ?? null, b.lat ?? null, b.lng ?? null,
           b.geofence_radius_m ?? 200).run()
    void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'branches', record_id: r.meta.last_row_id })
    return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
  } catch {
    return c.json({ success: false, error: 'الكود موجود مسبقاً' }, 409)
  }
})

hr.patch('/branches/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b  = await c.req.json<Record<string, unknown>>()
  const allowed = ['code','name','address','city','phone','manager_id','lat','lng','geofence_radius_m','is_active']
  const cols = Object.keys(b).filter(k => allowed.includes(k))
  if (!cols.length) return c.json({ success: false, error: 'لا توجد حقول' }, 400)
  await c.env.DB.prepare(
    `UPDATE branches SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND company_id = ?`
  ).bind(...cols.map(f => b[f]), id, company_id).run()
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// EMPLOYEE JOB DETAILS
// ═══════════════════════════════════════════════════════════

// GET all job details for org chart
hr.get('/job-details', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare(`SELECT ejd.*, b.name AS branch_name
              FROM employee_job_details ejd
              LEFT JOIN branches b ON b.id = ejd.branch_id
              WHERE ejd.company_id = ?
              ORDER BY ejd.employee_id`)
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

hr.get('/job-details/:employee_id', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const empId = Number(c.req.param('employee_id'))
  const row = await c.env.DB
    .prepare(`SELECT ejd.*, b.name AS branch_name
              FROM employee_job_details ejd
              LEFT JOIN branches b ON b.id = ejd.branch_id
              WHERE ejd.employee_id = ? AND ejd.company_id = ?`)
    .bind(empId, company_id).first()
  return c.json({ success: true, data: row ?? null })
})

hr.put('/job-details/:employee_id', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const empId = Number(c.req.param('employee_id'))
  const b = await c.req.json<{
    department?: string; branch_id?: number; position_level?: string
    contract_type?: string; shift_type?: string; base_salary?: number
    housing_allow?: number; transport_allow?: number; other_allows?: number
    social_insur?: number; income_tax_pct?: number; bank_name?: string
    bank_iban?: string; start_date?: string; end_date?: string; notes?: string
  }>()

  // Verify employee belongs to company
  const emp = await c.env.DB.prepare('SELECT id FROM employees WHERE id = ? AND company_id = ?')
    .bind(empId, company_id).first()
  if (!emp) return c.json({ success: false, error: 'الموظف غير موجود' }, 404)

  await c.env.DB.prepare(
    `INSERT INTO employee_job_details
     (employee_id, company_id, department, branch_id, position_level, contract_type, shift_type,
      base_salary, housing_allow, transport_allow, other_allows, social_insur, income_tax_pct,
      bank_name, bank_iban, start_date, end_date, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(employee_id) DO UPDATE SET
       department      = excluded.department,
       branch_id       = excluded.branch_id,
       position_level  = excluded.position_level,
       contract_type   = excluded.contract_type,
       shift_type      = excluded.shift_type,
       base_salary     = excluded.base_salary,
       housing_allow   = excluded.housing_allow,
       transport_allow = excluded.transport_allow,
       other_allows    = excluded.other_allows,
       social_insur    = excluded.social_insur,
       income_tax_pct  = excluded.income_tax_pct,
       bank_name       = excluded.bank_name,
       bank_iban       = excluded.bank_iban,
       start_date      = excluded.start_date,
       end_date        = excluded.end_date,
       notes           = excluded.notes`
  ).bind(
    empId, company_id, b.department ?? null, b.branch_id ?? null,
    b.position_level ?? 'junior', b.contract_type ?? 'full_time', b.shift_type ?? 'morning',
    b.base_salary ?? 0, b.housing_allow ?? 0, b.transport_allow ?? 0, b.other_allows ?? 0,
    b.social_insur ?? 0, b.income_tax_pct ?? 0, b.bank_name ?? null, b.bank_iban ?? null,
    b.start_date ?? new Date().toISOString().slice(0,10), b.end_date ?? null, b.notes ?? null
  ).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPSERT', table_name: 'employee_job_details', record_id: empId })
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════════════════

hr.get('/attendance', async (c) => {
  const { company_id } = getUser(c)
  const empId = c.req.query('employee_id')
  const from  = c.req.query('from')
  const to    = c.req.query('to')
  const page  = Math.max(1, Number(c.req.query('page') ?? 1))
  const size  = Math.min(200, Number(c.req.query('size') ?? 31))
  const offset = (page - 1) * size

  let where = 'WHERE a.company_id = ?'
  const p: unknown[] = [company_id]
  if (empId) { where += ' AND a.employee_id = ?'; p.push(Number(empId)) }
  if (from)  { where += ' AND a.work_date >= ?'; p.push(from) }
  if (to)    { where += ' AND a.work_date <= ?'; p.push(to) }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT a.*, e.name AS employee_name
       FROM attendance_records a
       JOIN employees e ON e.id = a.employee_id
       ${where}
       ORDER BY a.work_date DESC, e.name LIMIT ? OFFSET ?`
    ).bind(...p, size, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM attendance_records a ${where}`)
      .bind(...p).first<{n:number}>(),
  ])

  return c.json({ success: true, data: rows.results, total: cnt?.n ?? 0, page, page_size: size })
})

// POST bulk attendance (تسجيل حضور يومي للجميع)
hr.post('/attendance/bulk', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    work_date: string
    records: {
      employee_id: number; status: string; check_in?: string; check_out?: string
      late_minutes?: number; overtime_hours?: number; notes?: string
      check_in_lat?: number; check_in_lng?: number
    }[]
  }>()

  if (!b.work_date || !Array.isArray(b.records) || !b.records.length) {
    return c.json({ success: false, error: 'التاريخ والسجلات مطلوبة' }, 400)
  }

  let inserted = 0
  for (const rec of b.records) {
    await c.env.DB.prepare(
      `INSERT INTO attendance_records
       (employee_id, company_id, work_date, check_in, check_out, check_in_lat, check_in_lng,
        status, late_minutes, overtime_hours, notes, recorded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         check_in       = excluded.check_in,
         check_out      = excluded.check_out,
         check_in_lat   = excluded.check_in_lat,
         check_in_lng   = excluded.check_in_lng,
         status         = excluded.status,
         late_minutes   = excluded.late_minutes,
         overtime_hours = excluded.overtime_hours,
         notes          = excluded.notes,
         recorded_by    = excluded.recorded_by`
    ).bind(
      rec.employee_id, company_id, b.work_date,
      rec.check_in ?? null, rec.check_out ?? null,
      rec.check_in_lat ?? null, rec.check_in_lng ?? null,
      rec.status ?? 'present', rec.late_minutes ?? 0, rec.overtime_hours ?? 0,
      rec.notes ?? null, userId
    ).run()
    inserted++
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'BULK_ATTENDANCE',
    table_name: 'attendance_records', new_value: { work_date: b.work_date, count: inserted },
  })
  return c.json({ success: true, data: { saved: inserted } }, 201)
})

// GET attendance summary for a month
hr.get('/attendance/summary', async (c) => {
  const { company_id } = getUser(c)
  const year  = Number(c.req.query('year')  ?? new Date().getFullYear())
  const month = Number(c.req.query('month') ?? new Date().getMonth() + 1)
  const from  = `${year}-${String(month).padStart(2,'0')}-01`
  const to    = `${year}-${String(month).padStart(2,'0')}-31`

  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.name,
            COUNT(CASE WHEN a.status = 'present' THEN 1 END) AS present_days,
            COUNT(CASE WHEN a.status = 'absent'  THEN 1 END) AS absent_days,
            COUNT(CASE WHEN a.status = 'late'    THEN 1 END) AS late_days,
            COUNT(CASE WHEN a.status = 'sick'    THEN 1 END) AS sick_days,
            COUNT(CASE WHEN a.status = 'leave'   THEN 1 END) AS leave_days,
            COALESCE(SUM(a.overtime_hours), 0)               AS total_overtime,
            COALESCE(SUM(a.late_minutes), 0)                 AS total_late_min
     FROM employees e
     LEFT JOIN attendance_records a ON a.employee_id = e.id
       AND a.work_date BETWEEN ? AND ?
     WHERE e.company_id = ? AND e.is_active = 1
     GROUP BY e.id, e.name
     ORDER BY e.name`
  ).bind(from, to, company_id).all()

  return c.json({ success: true, data: results, year, month })
})

// ═══════════════════════════════════════════════════════════
// LEAVE TYPES + REQUESTS
// ═══════════════════════════════════════════════════════════

hr.get('/leave-types', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB
    .prepare('SELECT * FROM leave_types WHERE company_id = ? AND is_active = 1 ORDER BY name')
    .bind(company_id).all()
  return c.json({ success: true, data: results })
})

hr.post('/leave-types', async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{ name: string; days_per_year?: number; is_paid?: number }>()
  if (!b.name) return c.json({ success: false, error: 'الاسم مطلوب' }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO leave_types (company_id, name, days_per_year, is_paid) VALUES (?,?,?,?)'
  ).bind(company_id, b.name, b.days_per_year ?? 0, b.is_paid ?? 1).run()
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

hr.get('/leave-requests', async (c) => {
  const { company_id } = getUser(c)
  const status = c.req.query('status')
  const empId  = c.req.query('employee_id')

  let where = 'WHERE lr.company_id = ?'
  const p: unknown[] = [company_id]
  if (status) { where += ' AND lr.status = ?'; p.push(status) }
  if (empId)  { where += ' AND lr.employee_id = ?'; p.push(Number(empId)) }

  const { results } = await c.env.DB.prepare(
    `SELECT lr.*, e.name AS employee_name, lt.name AS leave_type_name,
            lt.is_paid, u.full_name AS approved_by_name
     FROM leave_requests lr
     JOIN employees  e  ON e.id  = lr.employee_id
     JOIN leave_types lt ON lt.id = lr.leave_type_id
     LEFT JOIN users u  ON u.id  = lr.approved_by
     ${where}
     ORDER BY lr.created_at DESC LIMIT 200`
  ).bind(...p).all()
  return c.json({ success: true, data: results })
})

hr.post('/leave-requests', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id: number; leave_type_id: number; start_date: string
    end_date: string; days_count: number; reason?: string
  }>()
  if (!b.employee_id || !b.leave_type_id || !b.start_date || !b.end_date) {
    return c.json({ success: false, error: 'بيانات ناقصة' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO leave_requests
     (employee_id, company_id, leave_type_id, start_date, end_date, days_count, reason)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(b.employee_id, company_id, b.leave_type_id, b.start_date, b.end_date,
         b.days_count ?? 1, b.reason ?? null).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'leave_requests', record_id: r.meta.last_row_id })
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

hr.patch('/leave-requests/:id/approve', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE leave_requests SET status = 'approved', approved_by = ?, approved_at = datetime('now')
     WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(userId, id, company_id).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'APPROVE', table_name: 'leave_requests', record_id: id })
  return c.json({ success: true, data: null })
})

hr.patch('/leave-requests/:id/reject', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { notes } = await c.req.json<{ notes?: string }>()
  await c.env.DB.prepare(
    `UPDATE leave_requests SET status = 'rejected', approved_by = ?, approved_at = datetime('now'), notes = ?
     WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(userId, notes ?? null, id, company_id).run()
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// SALARY ADVANCES (طلبات السلف)
// ═══════════════════════════════════════════════════════════

hr.get('/salary-advances', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const status = c.req.query('status')
  const empId  = c.req.query('employee_id')

  let where = 'WHERE sa.company_id = ?'
  const p: unknown[] = [company_id]
  if (status) { where += ' AND sa.status = ?'; p.push(status) }
  if (empId)  { where += ' AND sa.employee_id = ?'; p.push(Number(empId)) }

  const { results } = await c.env.DB.prepare(
    `SELECT sa.*, e.name AS employee_name, u.full_name AS approved_by_name
     FROM salary_advances sa
     JOIN employees e ON e.id = sa.employee_id
     LEFT JOIN users u ON u.id = sa.approved_by
     ${where}
     ORDER BY sa.created_at DESC LIMIT 200`
  ).bind(...p).all()
  return c.json({ success: true, data: results })
})

hr.post('/salary-advances', permissionGuard('hr', 'write'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id: number; request_date: string; amount: number
    reason?: string; repay_months?: number
  }>()
  if (!b.employee_id || !b.amount || !b.request_date) {
    return c.json({ success: false, error: 'الموظف والمبلغ والتاريخ مطلوبة' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO salary_advances (employee_id, company_id, request_date, amount, reason, repay_months)
     VALUES (?,?,?,?,?,?)`
  ).bind(b.employee_id, company_id, b.request_date, b.amount, b.reason ?? null, b.repay_months ?? 1).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'salary_advances', record_id: r.meta.last_row_id })
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

hr.patch('/salary-advances/:id/approve', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE salary_advances SET status = 'approved', approved_by = ?, approved_at = datetime('now')
     WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(userId, id, company_id).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'APPROVE', table_name: 'salary_advances', record_id: id })
  return c.json({ success: true, data: null })
})

hr.patch('/salary-advances/:id/reject', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE salary_advances SET status = 'rejected', approved_by = ?, approved_at = datetime('now')
     WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(userId, id, company_id).run()
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// PAYROLL RUNS (مسيرات الرواتب)
// ═══════════════════════════════════════════════════════════

hr.get('/payroll', permissionGuard('hr', 'read'), async (c) => {
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

hr.get('/payroll/:id', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const [run, items] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
      .bind(id, company_id).first(),
    c.env.DB.prepare(
      `SELECT pi.*, COALESCE(e.name, '[موظف محذوف]') AS employee_name, e.national_id
       FROM payroll_items pi
       LEFT JOIN employees e ON e.id = pi.employee_id
       WHERE pi.payroll_run_id = ?
       ORDER BY employee_name`
    ).bind(id).all(),
  ])
  if (!run) return c.json({ success: false, error: 'المسيرة غير موجودة' }, 404)
  return c.json({ success: true, data: { ...run, items: items.results } })
})

// POST /api/hr/payroll/run — حساب مسيرة شهر
hr.post('/payroll/run', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{ year: number; month: number }>()
  if (!b.year || !b.month || b.month < 1 || b.month > 12) {
    return c.json({ success: false, error: 'السنة والشهر مطلوبان (1-12)' }, 400)
  }

  // Check if run already exists
  const existing = await c.env.DB
    .prepare('SELECT id FROM payroll_runs WHERE company_id = ? AND period_year = ? AND period_month = ?')
    .bind(company_id, b.year, b.month).first<{id:number}>()
  if (existing) {
    return c.json({ success: false, error: 'مسيرة هذا الشهر موجودة بالفعل' }, 409)
  }

  const monthStr  = String(b.month).padStart(2, '0')
  const fromDate  = `${b.year}-${monthStr}-01`
  const toDate    = `${b.year}-${monthStr}-31`

  // Fetch all active employees with job details
  const { results: employees } = await c.env.DB.prepare(
    `SELECT e.id, e.name, e.daily_wage,
            ejd.base_salary, ejd.housing_allow, ejd.transport_allow,
            ejd.other_allows, ejd.social_insur, ejd.income_tax_pct
     FROM employees e
     LEFT JOIN employee_job_details ejd ON ejd.employee_id = e.id
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

  // Fetch attendance for this month
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

  // Fetch approved advances still within repayment window.
  // months_deducted counts completed payroll runs (approved/paid) that included this advance.
  // Once months_deducted >= repay_months the advance is fully recovered and excluded.
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

  // Create the payroll run
  const runResult = await c.env.DB.prepare(
    `INSERT INTO payroll_runs (company_id, period_year, period_month, run_date, status, created_by)
     VALUES (?,?,?,date('now'),'draft',?)`
  ).bind(company_id, b.year, b.month, userId).run()
  const runId = runResult.meta.last_row_id

  let totalGross = 0, totalDeductions = 0, totalNet = 0

  // Build all payroll item rows first, then batch-insert
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

  // Single D1 batch — all employees in one round-trip
  await c.env.DB.batch(itemStmts)

  // Update run totals
  await c.env.DB.prepare(
    `UPDATE payroll_runs SET total_gross = ?, total_deductions = ?, total_net = ? WHERE id = ?`
  ).bind(totalGross, totalDeductions, totalNet, runId).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE', table_name: 'payroll_runs', record_id: runId,
    new_value: { year: b.year, month: b.month, total_net: totalNet, employees: employees.length },
  })

  return c.json({
    success: true,
    data: { id: runId, total_gross: totalGross, total_deductions: totalDeductions, total_net: totalNet },
  }, 201)
})

hr.patch('/payroll/:id/approve', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string; total_net: number; period_year: number; period_month: number }>()
  if (!run) return c.json({ success: false, error: 'المسيرة غير موجودة' }, 404)
  if (run.status !== 'draft') return c.json({ success: false, error: 'المسيرة ليست في حالة مسودة' }, 400)

  // GL FIRST — validate period and mappings before changing status
  const runDate = `${run.period_year}-${String(run.period_month).padStart(2,'0')}-28`
  let glId: number | null = null
  try {
    glId = await glPayroll(
      c.env.DB, company_id, id, run.total_net, runDate,
      `مسيرة رواتب ${run.period_year}/${run.period_month}`, userId,
    )
  } catch (e: any) {
    return c.json({ success: false, error: `فشل إنشاء القيد المحاسبي للمسيرة: ${e.message}` }, 400)
  }

  // APPROVE only after GL succeeds
  await c.env.DB.prepare(
    `UPDATE payroll_runs SET status = 'approved', approved_by = ?, journal_entry_id = ? WHERE id = ?`
  ).bind(userId, glId, id).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'APPROVE', table_name: 'payroll_runs', record_id: id,
    new_value: { total_net: run.total_net, gl_entry_id: glId } })
  return c.json({ success: true, data: null })
})

// PATCH /hr/payroll/:id/pay — صرف الرواتب فعلياً (DR Wages Payable / CR Cash)
hr.patch('/payroll/:id/pay', permissionGuard('hr', 'admin'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { payment_date } = await c.req.json<{ payment_date?: string }>()

  const run = await c.env.DB.prepare('SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?')
    .bind(id, company_id).first<{ status: string; total_net: number; period_year: number; period_month: number }>()
  if (!run) return c.json({ success: false, error: 'المسيرة غير موجودة' }, 404)
  if (run.status !== 'approved') return c.json({ success: false, error: 'يجب اعتماد المسيرة أولاً قبل الصرف' }, 400)

  const payDate = payment_date ?? new Date().toISOString().slice(0, 10)

  // GL: DR Wages Payable / CR Cash — closes the liability opened on approval
  let glId: number | null = null
  try {
    glId = await glWagesPayment(
      c.env.DB, company_id, id, run.total_net, payDate,
      `صرف رواتب ${run.period_year}/${run.period_month}`, userId,
    )
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

// ═══════════════════════════════════════════════════════════
// EMPLOYEE ASSETS (أصول الموظف)
// ═══════════════════════════════════════════════════════════

hr.get('/assets', async (c) => {
  const { company_id } = getUser(c)
  const empId = c.req.query('employee_id')

  let where = 'WHERE ea.company_id = ?'
  const p: unknown[] = [company_id]
  if (empId) { where += ' AND ea.employee_id = ?'; p.push(Number(empId)) }

  const { results } = await c.env.DB.prepare(
    `SELECT ea.*, e.name AS employee_name
     FROM employee_assets ea
     JOIN employees e ON e.id = ea.employee_id
     ${where}
     ORDER BY ea.assigned_date DESC LIMIT 200`
  ).bind(...p).all()
  return c.json({ success: true, data: results })
})

hr.post('/assets', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id: number; asset_name: string; asset_type?: string
    serial_number?: string; assigned_date: string; condition_in?: string; notes?: string
  }>()
  if (!b.employee_id || !b.asset_name || !b.assigned_date) {
    return c.json({ success: false, error: 'الموظف والأصل وتاريخ التسليم مطلوبة' }, 400)
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO employee_assets (employee_id, company_id, asset_name, asset_type, serial_number, assigned_date, condition_in, notes)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(b.employee_id, company_id, b.asset_name, b.asset_type ?? null, b.serial_number ?? null,
         b.assigned_date, b.condition_in ?? null, b.notes ?? null).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CREATE', table_name: 'employee_assets', record_id: r.meta.last_row_id })
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

hr.patch('/assets/:id/return', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const { return_date, condition_out, notes } = await c.req.json<{
    return_date: string; condition_out?: string; notes?: string
  }>()
  await c.env.DB.prepare(
    `UPDATE employee_assets SET return_date = ?, condition_out = ?, notes = ?
     WHERE id = ? AND company_id = ?`
  ).bind(return_date, condition_out ?? null, notes ?? null, id, company_id).run()
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// EMPLOYEE PROFILE (موظف كامل — شامل كل التفاصيل)
// ═══════════════════════════════════════════════════════════

hr.get('/employees/:id/profile', permissionGuard('hr', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const empId = Number(c.req.param('id'))

  const [employee, jobDetails, recentAttendance, advances, assets, leaveRequests] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
      .bind(empId, company_id).first(),
    c.env.DB.prepare(
      `SELECT ejd.*, b.name AS branch_name FROM employee_job_details ejd
       LEFT JOIN branches b ON b.id = ejd.branch_id
       WHERE ejd.employee_id = ? AND ejd.company_id = ?`
    ).bind(empId, company_id).first(),
    c.env.DB.prepare(
      `SELECT * FROM attendance_records WHERE employee_id = ? AND company_id = ?
       ORDER BY work_date DESC LIMIT 30`
    ).bind(empId, company_id).all(),
    c.env.DB.prepare(
      `SELECT * FROM salary_advances WHERE employee_id = ? AND company_id = ?
       ORDER BY created_at DESC LIMIT 10`
    ).bind(empId, company_id).all(),
    c.env.DB.prepare(
      `SELECT * FROM employee_assets WHERE employee_id = ? AND company_id = ?
       ORDER BY assigned_date DESC`
    ).bind(empId, company_id).all(),
    c.env.DB.prepare(
      `SELECT lr.*, lt.name AS leave_type_name FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.employee_id = ? AND lr.company_id = ?
       ORDER BY lr.created_at DESC LIMIT 10`
    ).bind(empId, company_id).all(),
  ])

  if (!employee) return c.json({ success: false, error: 'الموظف غير موجود' }, 404)

  return c.json({
    success: true,
    data: {
      employee,
      job_details: jobDetails ?? null,
      recent_attendance: recentAttendance.results,
      advances: advances.results,
      assets: assets.results,
      leave_requests: leaveRequests.results,
    },
  })
})

// ═══════════════════════════════════════════════════════════
// GEO — helpers
// ═══════════════════════════════════════════════════════════

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Ray-casting point-in-polygon
// coords are [lng, lat] (GeoJSON standard)
function pointInPolygon(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside
  }
  return inside
}

// Extract first polygon ring from GeoJSON string
function extractRingFromGeoJSON(geojson: string): [number, number][] | null {
  try {
    const g = JSON.parse(geojson)
    let geometry = g
    if (g.type === 'FeatureCollection') geometry = g.features?.[0]?.geometry
    else if (g.type === 'Feature') geometry = g.geometry
    if (geometry?.type === 'Polygon') return geometry.coordinates[0]
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates[0][0]
    return null
  } catch { return null }
}

// ═══════════════════════════════════════════════════════════
// GEO CHECK-IN (تسجيل الحضور بالموقع الجغرافي)
// ═══════════════════════════════════════════════════════════
// POST /hr/geo/check-in
// الموظف يفتح التطبيق → يضغط "تسجيل حضور" → يُرسل GPS coordinates
// النظام يحسب المسافة من الفرع ويحدد: onsite | field
hr.post('/geo/check-in', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id: number
    work_date:   string
    lat:         number
    lng:         number
    accuracy_m:  number
    field_id?:   number  // اختياري — لو الموظف اختار حقل من القائمة
  }>()

  if (!b.employee_id || !b.work_date || b.lat == null || b.lng == null) {
    return c.json({ success: false, error: 'بيانات ناقصة: employee_id, work_date, lat, lng مطلوبة' }, 400)
  }

  // جلب بيانات الفرع المرتبط بالموظف
  const branch = await c.env.DB.prepare(
    `SELECT b.lat, b.lng, b.geofence_radius_m
     FROM branches b
     JOIN employee_job_details ejd ON ejd.branch_id = b.id
     WHERE ejd.employee_id = ? AND ejd.company_id = ?`
  ).bind(b.employee_id, company_id).first<{ lat: number | null; lng: number | null; geofence_radius_m: number }>()

  let location_status = 'unverified'
  let distance_m: number | null = null

  if (branch?.lat != null && branch?.lng != null) {
    distance_m = Math.round(haversineM(b.lat, b.lng, branch.lat, branch.lng))
    const radius = branch.geofence_radius_m ?? 200
    location_status = distance_m <= radius ? 'onsite' : 'field'
  }

  // تحديث أو إنشاء سجل الحضور
  const existing = await c.env.DB.prepare(
    `SELECT id FROM attendance_records WHERE employee_id = ? AND company_id = ? AND work_date = ?`
  ).bind(b.employee_id, company_id, b.work_date).first<{ id: number }>()

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE attendance_records
       SET check_in = datetime('now'), check_in_lat = ?, check_in_lng = ?,
           location_status = ?, gps_accuracy_m = ?, field_id = ?
       WHERE id = ?`
    ).bind(b.lat, b.lng, location_status, b.accuracy_m ?? null, b.field_id ?? null, existing.id).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO attendance_records
         (employee_id, company_id, work_date, status, check_in, check_in_lat, check_in_lng,
          location_status, gps_accuracy_m, field_id, recorded_by)
       VALUES (?,?,?,?,datetime('now'),?,?,?,?,?,?)`
    ).bind(
      b.employee_id, company_id, b.work_date, 'present',
      b.lat, b.lng, location_status, b.accuracy_m ?? null, b.field_id ?? null, userId
    ).run()
  }

  return c.json({
    success: true,
    data: { location_status, distance_m, accuracy_m: b.accuracy_m, weak_signal: b.accuracy_m > 100 },
  })
})

// ═══════════════════════════════════════════════════════════
// LOCATION TASKS (مهام زيارة موضع)
// ═══════════════════════════════════════════════════════════

// GET /hr/location-tasks — قائمة المهام (للمدير: كل الموظفين / للموظف: مهامه)
hr.get('/location-tasks', async (c) => {
  const { company_id } = getUser(c)
  const empId    = c.req.query('employee_id')
  const taskDate = c.req.query('date')  // YYYY-MM-DD
  const status   = c.req.query('status')

  const conditions: string[] = ['lt.company_id = ?']
  const params: unknown[] = [company_id]

  if (empId)    { conditions.push('lt.employee_id = ?');  params.push(Number(empId)) }
  if (taskDate) { conditions.push('lt.task_date = ?');    params.push(taskDate) }
  if (status)   { conditions.push('lt.status = ?');       params.push(status) }

  const { results } = await c.env.DB.prepare(
    `SELECT lt.*,
            e.name    AS employee_name,
            u.full_name AS assigned_by_name,
            f.name    AS field_name,
            f.code    AS field_code
     FROM location_tasks lt
     JOIN employees e ON e.id = lt.employee_id
     JOIN users     u ON u.id = lt.assigned_by
     LEFT JOIN fields f ON f.id = lt.field_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY lt.task_date DESC, lt.id DESC
     LIMIT 200`
  ).bind(...params).all()

  return c.json({ success: true, data: results })
})

// POST /hr/location-tasks — المدير يُسند مهمة زيارة
hr.post('/location-tasks', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id:  number
    task_date:    string
    field_id?:    number   // إما حقل موجود
    custom_lat?:  number   // أو موقع مخصص
    custom_lng?:  number
    custom_name?: string
    tolerance_m?: number   // نطاق القبول (default 150m)
    task_notes?:  string
  }>()

  if (!b.employee_id || !b.task_date) {
    return c.json({ success: false, error: 'الموظف والتاريخ مطلوبان' }, 400)
  }
  if (!b.field_id && (b.custom_lat == null || b.custom_lng == null)) {
    return c.json({ success: false, error: 'يجب تحديد حقل أو إحداثيات موقع مخصص' }, 400)
  }

  const r = await c.env.DB.prepare(
    `INSERT INTO location_tasks
       (company_id, employee_id, assigned_by, field_id, custom_lat, custom_lng, custom_name,
        tolerance_m, task_date, task_notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id, b.employee_id, userId,
    b.field_id ?? null, b.custom_lat ?? null, b.custom_lng ?? null, b.custom_name ?? null,
    b.tolerance_m ?? 150, b.task_date, b.task_notes ?? null
  ).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'location_tasks', record_id: r.meta.last_row_id,
  })

  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

// PATCH /hr/location-tasks/:id/arrive — الموظف يُسجّل وصوله
hr.patch('/location-tasks/:id/arrive', async (c) => {
  const { company_id } = getUser(c)
  const taskId = Number(c.req.param('id'))
  const b = await c.req.json<{ lat: number; lng: number; accuracy_m?: number }>()

  if (b.lat == null || b.lng == null) {
    return c.json({ success: false, error: 'الإحداثيات مطلوبة' }, 400)
  }

  const task = await c.env.DB.prepare(
    `SELECT * FROM location_tasks WHERE id = ? AND company_id = ?`
  ).bind(taskId, company_id).first<{
    status: string; field_id: number | null
    custom_lat: number | null; custom_lng: number | null
    tolerance_m: number
  }>()

  if (!task) return c.json({ success: false, error: 'المهمة غير موجودة' }, 404)
  if (task.status !== 'pending') return c.json({ success: false, error: 'تم تسجيل الوصول مسبقاً' }, 409)

  // جلب إحداثيات الهدف (مع boundary_geojson لو موجود)
  let targetLat: number | null = task.custom_lat
  let targetLng: number | null = task.custom_lng
  let fieldPolygon: [number, number][] | null = null

  if (task.field_id) {
    const field = await c.env.DB.prepare(
      'SELECT center_lat, center_lng, boundary_geojson FROM fields WHERE id = ? AND company_id = ?'
    ).bind(task.field_id, company_id).first<{
      center_lat: number | null; center_lng: number | null; boundary_geojson: string | null
    }>()
    if (field?.boundary_geojson) fieldPolygon = extractRingFromGeoJSON(field.boundary_geojson)
    if (field?.center_lat != null) { targetLat = field.center_lat; targetLng = field.center_lng }
  }

  // حساب المسافة وتحديد الحالة
  // الأولوية: polygon check → circle check → unverified
  let distance_m: number | null = null
  let newStatus = 'arrived'  // default: وصل (لو مفيش إحداثيات للهدف)

  if (fieldPolygon && fieldPolygon.length >= 3) {
    // استخدام فحص الـ polygon (دقيق)
    const inside = pointInPolygon(b.lat, b.lng, fieldPolygon)
    if (inside) {
      newStatus = 'arrived'
      distance_m = 0
    } else if (targetLat != null && targetLng != null) {
      distance_m = Math.round(haversineM(b.lat, b.lng, targetLat, targetLng))
      newStatus  = distance_m <= task.tolerance_m ? 'arrived' : 'outside'
    } else {
      newStatus = 'outside'
    }
  } else if (targetLat != null && targetLng != null) {
    // فحص دائرة (fallback)
    distance_m = Math.round(haversineM(b.lat, b.lng, targetLat, targetLng))
    newStatus  = distance_m <= task.tolerance_m ? 'arrived' : 'outside'
  }

  await c.env.DB.prepare(
    `UPDATE location_tasks
     SET status = ?, arrived_at = datetime('now'), arrived_lat = ?, arrived_lng = ?,
         distance_m = ?, gps_accuracy_m = ?
     WHERE id = ?`
  ).bind(newStatus, b.lat, b.lng, distance_m, b.accuracy_m ?? null, taskId).run()

  return c.json({
    success: true,
    data: {
      status:      newStatus,
      distance_m,
      tolerance_m: task.tolerance_m,
      within_range: newStatus === 'arrived',
      weak_signal:  b.accuracy_m != null && b.accuracy_m > 100,
    },
  })
})

// PATCH /hr/location-tasks/:id/cancel — المدير يلغي المهمة
hr.patch('/location-tasks/:id/cancel', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const taskId = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE location_tasks SET status = 'missed' WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(taskId, company_id).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CANCEL', table_name: 'location_tasks', record_id: taskId })
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// HR DASHBOARD — لوحة تحكم الموارد البشرية
// ═══════════════════════════════════════════════════════════

// GET /hr/dashboard — بيانات الداشبورد الكاملة
hr.get('/dashboard', async (c) => {
  const { company_id } = getUser(c)

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  const [
    totalEmpsRes,
    todayAttendRes,
    pendingLeavesRes,
    pendingAdvancesRes,
    todayTasksRes,
    monthlyAttendRes,
    payrollTrendRes,
    expiringDocRes,
  ] = await Promise.all([
    // إجمالي الموظفين النشطين
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT jd.employee_id) AS total
       FROM employee_job_details jd
       JOIN employees e ON e.id = jd.employee_id AND e.company_id = jd.company_id
       WHERE jd.company_id = ? AND (jd.end_date IS NULL OR jd.end_date >= date('now'))`
    ).bind(company_id).first<{ total: number }>(),

    // إحصائيات الحضور اليوم
    c.env.DB.prepare(
      `SELECT
         COUNT(CASE WHEN status IN ('present','late','half_day') THEN 1 END) AS present,
         COUNT(CASE WHEN status = 'absent'   THEN 1 END) AS absent,
         COUNT(CASE WHEN status = 'late'     THEN 1 END) AS late,
         COUNT(CASE WHEN status = 'sick'     THEN 1 END) AS sick,
         COUNT(CASE WHEN status = 'leave'    THEN 1 END) AS on_leave,
         COUNT(*) AS total_records
       FROM attendance_records
       WHERE company_id = ? AND work_date = ?`
    ).bind(company_id, today).first<{
      present: number; absent: number; late: number;
      sick: number; on_leave: number; total_records: number
    }>(),

    // طلبات الإجازة المعلقة
    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM leave_requests WHERE company_id = ? AND status = 'pending'`
    ).bind(company_id).first<{ cnt: number }>(),

    // طلبات السلف المعلقة
    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM salary_advances WHERE company_id = ? AND status = 'pending'`
    ).bind(company_id).first<{ cnt: number }>(),

    // مهام الزيارات اليوم
    c.env.DB.prepare(
      `SELECT
         COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
         COUNT(CASE WHEN status = 'arrived' THEN 1 END) AS arrived,
         COUNT(CASE WHEN status = 'outside' THEN 1 END) AS outside,
         COUNT(CASE WHEN status = 'missed'  THEN 1 END) AS missed,
         COUNT(*) AS total
       FROM location_tasks
       WHERE company_id = ? AND task_date = ?`
    ).bind(company_id, today).first<{
      pending: number; arrived: number; outside: number; missed: number; total: number
    }>(),

    // توجه الحضور — آخر 6 أشهر (عدد أيام الحضور الفعلية لكل شهر)
    c.env.DB.prepare(
      `SELECT
         strftime('%Y-%m', work_date) AS month,
         COUNT(CASE WHEN status IN ('present','late','half_day') THEN 1 END) AS present_days,
         COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent_days,
         COUNT(DISTINCT employee_id) AS active_employees
       FROM attendance_records
       WHERE company_id = ? AND work_date >= date('now','-6 months')
       GROUP BY month ORDER BY month ASC`
    ).bind(company_id).all<{ month: string; present_days: number; absent_days: number; active_employees: number }>(),

    // آخر 6 مسيرات رواتب معتمدة
    c.env.DB.prepare(
      `SELECT
         period_year || '-' || printf('%02d', period_month) AS month,
         total_gross, total_deductions, total_net
       FROM payroll_runs
       WHERE company_id = ? AND status IN ('approved','paid')
       ORDER BY period_year DESC, period_month DESC
       LIMIT 6`
    ).bind(company_id).all<{ month: string; total_gross: number; total_deductions: number; total_net: number }>(),

    // مستندات تنتهي في 30 يوم القادمة
    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM documents
       WHERE company_id = ? AND expiry_date IS NOT NULL
         AND expiry_date BETWEEN date('now') AND date('now','+30 days')`
    ).bind(company_id).first<{ cnt: number }>(),
  ])

  return c.json({
    success: true,
    data: {
      today,
      total_employees: totalEmpsRes?.total ?? 0,
      today_attendance: {
        present:  todayAttendRes?.present  ?? 0,
        absent:   todayAttendRes?.absent   ?? 0,
        late:     todayAttendRes?.late     ?? 0,
        sick:     todayAttendRes?.sick     ?? 0,
        on_leave: todayAttendRes?.on_leave ?? 0,
        total:    todayAttendRes?.total_records ?? 0,
      },
      pending_leaves:    pendingLeavesRes?.cnt  ?? 0,
      pending_advances:  pendingAdvancesRes?.cnt ?? 0,
      today_tasks:       todayTasksRes ?? { pending: 0, arrived: 0, outside: 0, missed: 0, total: 0 },
      monthly_attendance: (monthlyAttendRes?.results ?? []).reverse(), // oldest→newest for chart
      payroll_trend:     (payrollTrendRes?.results ?? []).reverse(),
      expiring_documents: expiringDocRes?.cnt ?? 0,
    },
  })
})

export default hr
