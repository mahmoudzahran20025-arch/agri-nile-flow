import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const attendance = new Hono<{ Bindings: Env }>()

attendance.get('/attendance', async (c) => {
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
       JOIN employees e ON e.id = a.employee_id AND e.company_id = a.company_id
       ${where}
       ORDER BY a.work_date DESC, e.name LIMIT ? OFFSET ?`
    ).bind(...p, size, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM attendance_records a ${where}`)
      .bind(...p).first<{n:number}>(),
  ])

  return c.json({ success: true, data: rows.results, total: cnt?.n ?? 0, page, page_size: size })
})

attendance.post('/attendance/bulk', async (c) => {
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

attendance.get('/attendance/summary', async (c) => {
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

export default attendance
