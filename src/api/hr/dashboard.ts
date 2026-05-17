import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { getTodayIsoDate } from '../../lib/utils/date'

const dashboard = new Hono<{ Bindings: Env }>()

dashboard.get('/dashboard', async (c) => {
  const { company_id } = getUser(c)

  const today = getTodayIsoDate()

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
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT jd.employee_id) AS total
       FROM employee_job_details jd
       JOIN employees e ON e.id = jd.employee_id AND e.company_id = jd.company_id
       WHERE jd.company_id = ? AND (jd.end_date IS NULL OR jd.end_date >= date('now'))`
    ).bind(company_id).first<{ total: number }>(),

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

    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM leave_requests WHERE company_id = ? AND status = 'pending'`
    ).bind(company_id).first<{ cnt: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM salary_advances WHERE company_id = ? AND status = 'pending'`
    ).bind(company_id).first<{ cnt: number }>(),

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

    c.env.DB.prepare(
      `SELECT
         period_year || '-' || printf('%02d', period_month) AS month,
         total_gross, total_deductions, total_net
       FROM payroll_runs
       WHERE company_id = ? AND status IN ('approved','paid')
       ORDER BY period_year DESC, period_month DESC
       LIMIT 6`
    ).bind(company_id).all<{ month: string; total_gross: number; total_deductions: number; total_net: number }>(),

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
      monthly_attendance: (monthlyAttendRes?.results ?? []).reverse(),
      payroll_trend:     (payrollTrendRes?.results ?? []).reverse(),
      expiring_documents: expiringDocRes?.cnt ?? 0,
    },
  })
})

export default dashboard
