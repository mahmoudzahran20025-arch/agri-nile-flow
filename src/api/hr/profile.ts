import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'

const profile = new Hono<{ Bindings: Env }>()

profile.get('/employees/:id/profile', permissionGuard('hr', 'read'), async (c) => {
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

export default profile
