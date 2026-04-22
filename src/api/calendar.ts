import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser } from '../middleware/auth'
import { logAudit } from '../lib/audit'

const calendar = new Hono<{ Bindings: Env }>()
calendar.use('*', authMiddleware)

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const dPhi = ((lat2 - lat1) * Math.PI) / 180
  const dLam = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ═══════════════════════════════════════════════════════════
// LIST EVENTS  — GET /calendar/events
// Query params:
//   from=YYYY-MM-DD  (defaults to start of current month)
//   to=YYYY-MM-DD    (defaults to end of current month)
//   type=task|meeting|visit|reminder|other
//   status=pending|in_progress|done|cancelled
//   assigned_to_user=<id>
//   assigned_to_employee=<id>
// ═══════════════════════════════════════════════════════════
calendar.get('/events', async (c) => {
  const { company_id } = getUser(c)

  const now   = new Date()
  const y     = now.getFullYear()
  const m     = String(now.getMonth() + 1).padStart(2, '0')
  const days  = new Date(y, now.getMonth() + 1, 0).getDate()

  const from   = (c.req.query('from')   ?? `${y}-${m}-01`)
  const to     = (c.req.query('to')     ?? `${y}-${m}-${days}`)
  const type   = c.req.query('type')
  const status = c.req.query('status')
  const auId   = c.req.query('assigned_to_user')
  const aeId   = c.req.query('assigned_to_employee')

  const conditions: string[] = [
    `ce.company_id = ?`,
    `date(ce.start_datetime) >= ?`,
    `date(ce.start_datetime) <= ?`,
  ]
  const binds: (string | number)[] = [company_id, from, to]

  if (type)   { conditions.push(`ce.event_type = ?`);              binds.push(type) }
  if (status) { conditions.push(`ce.status = ?`);                  binds.push(status) }
  if (auId)   { conditions.push(`ce.assigned_to_user = ?`);        binds.push(Number(auId)) }
  if (aeId)   { conditions.push(`ce.assigned_to_employee = ?`);    binds.push(Number(aeId)) }

  const where = conditions.join(' AND ')

  const { results } = await c.env.DB
    .prepare(`
      SELECT
        ce.*,
        u1.full_name  AS created_by_name,
        u2.full_name  AS assigned_to_user_name,
        e.name   AS assigned_to_employee_name,
        (SELECT COUNT(*) FROM event_attendees ea WHERE ea.event_id = ce.id) AS attendee_count
      FROM calendar_events ce
      LEFT JOIN users     u1 ON u1.id = ce.created_by
      LEFT JOIN users     u2 ON u2.id = ce.assigned_to_user
      LEFT JOIN employees e  ON e.id  = ce.assigned_to_employee
      WHERE ${where}
      ORDER BY ce.start_datetime ASC
    `)
    .bind(...binds).all()

  return c.json({ success: true, data: results })
})

// ═══════════════════════════════════════════════════════════
// GET SINGLE EVENT  — GET /calendar/events/:id
// ═══════════════════════════════════════════════════════════
calendar.get('/events/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const row = await c.env.DB
    .prepare(`
      SELECT
        ce.*,
        u1.full_name AS created_by_name,
        u2.full_name AS assigned_to_user_name,
        e.name  AS assigned_to_employee_name
      FROM calendar_events ce
      LEFT JOIN users     u1 ON u1.id = ce.created_by
      LEFT JOIN users     u2 ON u2.id = ce.assigned_to_user
      LEFT JOIN employees e  ON e.id  = ce.assigned_to_employee
      WHERE ce.id = ? AND ce.company_id = ?
    `)
    .bind(id, company_id).first()

  if (!row) return c.json({ success: false, error: 'الحدث غير موجود' }, 404)

  const { results: attendees } = await c.env.DB
    .prepare(`
      SELECT ea.*, u.full_name AS user_name, e.name AS employee_name
      FROM event_attendees ea
      LEFT JOIN users     u ON u.id = ea.user_id
      LEFT JOIN employees e ON e.id = ea.employee_id
      WHERE ea.event_id = ?
      ORDER BY ea.created_at
    `)
    .bind(id).all()

  return c.json({ success: true, data: { ...row, attendees } })
})

// ═══════════════════════════════════════════════════════════
// CREATE EVENT  — POST /calendar/events
// ═══════════════════════════════════════════════════════════
calendar.post('/events', async (c) => {
  const { company_id, sub: userId } = getUser(c)

  const b = await c.req.json<{
    title: string
    event_type?: string
    description?: string
    priority?: string
    start_datetime: string
    end_datetime?: string
    all_day?: number
    assigned_to_user?: number
    assigned_to_employee?: number
    location_name?: string
    location_lat?: number
    location_lng?: number
    location_tolerance_m?: number
    ref_table?: string
    ref_id?: number
    color?: string
    attendees?: Array<{ user_id?: number; employee_id?: number; name?: string; email?: string }>
  }>()

  if (!b.title?.trim())      return c.json({ success: false, error: 'العنوان مطلوب' }, 400)
  if (!b.start_datetime)     return c.json({ success: false, error: 'وقت البداية مطلوب' }, 400)

  const eventType = b.event_type ?? 'task'
  const validTypes = ['task', 'meeting', 'visit', 'reminder', 'other']
  if (!validTypes.includes(eventType)) return c.json({ success: false, error: 'نوع الحدث غير صالح' }, 400)

  const r = await c.env.DB.prepare(`
    INSERT INTO calendar_events (
      company_id, created_by, title, description, event_type, priority,
      start_datetime, end_datetime, all_day,
      assigned_to_user, assigned_to_employee,
      location_name, location_lat, location_lng, location_tolerance_m,
      ref_table, ref_id, color, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    company_id, userId,
    b.title.trim(), b.description ?? null, eventType,
    b.priority ?? 'normal',
    b.start_datetime, b.end_datetime ?? null, b.all_day ?? 0,
    b.assigned_to_user ?? null, b.assigned_to_employee ?? null,
    b.location_name ?? null, b.location_lat ?? null, b.location_lng ?? null,
    b.location_tolerance_m ?? 150,
    b.ref_table ?? null, b.ref_id ?? null,
    b.color ?? '#3B82F6', 'pending'
  ).run()

  const newId = r.meta.last_row_id as number

  // Insert attendees if provided (for meetings)
  if (b.attendees?.length) {
    const stmts = b.attendees.map(a =>
      c.env.DB.prepare(`
        INSERT INTO event_attendees (event_id, user_id, employee_id, name, email)
        VALUES (?,?,?,?,?)
      `).bind(newId, a.user_id ?? null, a.employee_id ?? null, a.name ?? null, a.email ?? null)
    )
    await c.env.DB.batch(stmts)
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'calendar_events', record_id: newId,
  })

  return c.json({ success: true, data: { id: newId } }, 201)
})

// ═══════════════════════════════════════════════════════════
// UPDATE EVENT  — PATCH /calendar/events/:id
// ═══════════════════════════════════════════════════════════
calendar.patch('/events/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const existing = await c.env.DB
    .prepare(`SELECT id FROM calendar_events WHERE id = ? AND company_id = ?`)
    .bind(id, company_id).first()
  if (!existing) return c.json({ success: false, error: 'الحدث غير موجود' }, 404)

  const b = await c.req.json<Record<string, unknown>>()
  const allowed = [
    'title', 'description', 'event_type', 'priority',
    'start_datetime', 'end_datetime', 'all_day',
    'assigned_to_user', 'assigned_to_employee',
    'location_name', 'location_lat', 'location_lng', 'location_tolerance_m',
    'ref_table', 'ref_id', 'color', 'status',
  ]
  const sets: string[] = []
  const vals: unknown[] = []
  for (const key of allowed) {
    if (key in b) { sets.push(`${key} = ?`); vals.push(b[key]) }
  }
  if (!sets.length) return c.json({ success: false, error: 'لا يوجد شيء للتحديث' }, 400)

  sets.push(`updated_at = datetime('now')`)
  vals.push(id, company_id)

  await c.env.DB
    .prepare(`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`)
    .bind(...vals).run()

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'calendar_events', record_id: id })
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// MARK DONE  — PATCH /calendar/events/:id/done
// ═══════════════════════════════════════════════════════════
calendar.patch('/events/:id/done', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const r = await c.env.DB
    .prepare(`UPDATE calendar_events SET status = 'done', updated_at = datetime('now')
              WHERE id = ? AND company_id = ? AND status != 'cancelled'`)
    .bind(id, company_id).run()

  if (r.meta.changes === 0) return c.json({ success: false, error: 'لا يمكن تحديث هذا الحدث' }, 404)

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'calendar_events', record_id: id })
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// CANCEL EVENT  — PATCH /calendar/events/:id/cancel
// ═══════════════════════════════════════════════════════════
calendar.patch('/events/:id/cancel', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))

  const r = await c.env.DB
    .prepare(`UPDATE calendar_events SET status = 'cancelled', updated_at = datetime('now')
              WHERE id = ? AND company_id = ? AND status != 'done'`)
    .bind(id, company_id).run()

  if (r.meta.changes === 0) return c.json({ success: false, error: 'لا يمكن إلغاء هذا الحدث' }, 404)

  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'UPDATE', table_name: 'calendar_events', record_id: id })
  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// GPS CHECK-IN (arrive at location)
// PATCH /calendar/events/:id/arrive
// Body: { lat, lng, accuracy_m? }
// ═══════════════════════════════════════════════════════════
calendar.patch('/events/:id/arrive', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const ev = await c.env.DB
    .prepare(`SELECT * FROM calendar_events WHERE id = ? AND company_id = ?`)
    .bind(id, company_id).first<{
      location_lat: number | null
      location_lng: number | null
      location_tolerance_m: number
      status: string
    }>()

  if (!ev) return c.json({ success: false, error: 'الحدث غير موجود' }, 404)
  if (!ev.location_lat || !ev.location_lng) {
    return c.json({ success: false, error: 'هذا الحدث لا يحتوي على موقع جغرافي' }, 400)
  }

  const { lat, lng, accuracy_m } = await c.req.json<{
    lat: number; lng: number; accuracy_m?: number
  }>()

  if (lat === undefined || lng === undefined) {
    return c.json({ success: false, error: 'الإحداثيات مطلوبة' }, 400)
  }

  const distanceM  = haversineMeters(lat, lng, ev.location_lat, ev.location_lng)
  const tolerance  = ev.location_tolerance_m ?? 150
  const withinRange = distanceM <= tolerance
  const weakSignal  = (accuracy_m ?? 0) > 50

  await c.env.DB.prepare(`
    UPDATE calendar_events
    SET checkin_lat = ?, checkin_lng = ?, checkin_at = datetime('now'),
        location_verified = ?, checkin_distance_m = ?,
        status = ?, updated_at = datetime('now')
    WHERE id = ? AND company_id = ?
  `).bind(
    lat, lng,
    withinRange ? 1 : 0,
    Math.round(distanceM),
    withinRange ? 'done' : ev.status,
    id, company_id,
  ).run()

  return c.json({
    success: true,
    data: {
      within_range:  withinRange,
      distance_m:    Math.round(distanceM),
      tolerance_m:   tolerance,
      weak_signal:   weakSignal,
    },
  })
})

// ═══════════════════════════════════════════════════════════
// ADD ATTENDEE  — POST /calendar/events/:id/attendees
// ═══════════════════════════════════════════════════════════
calendar.post('/events/:id/attendees', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const exists = await c.env.DB
    .prepare(`SELECT id FROM calendar_events WHERE id = ? AND company_id = ?`)
    .bind(id, company_id).first()
  if (!exists) return c.json({ success: false, error: 'الحدث غير موجود' }, 404)

  const b = await c.req.json<{
    user_id?: number; employee_id?: number; name?: string; email?: string
  }>()

  const r = await c.env.DB.prepare(`
    INSERT INTO event_attendees (event_id, user_id, employee_id, name, email)
    VALUES (?,?,?,?,?)
  `).bind(id, b.user_id ?? null, b.employee_id ?? null, b.name ?? null, b.email ?? null).run()

  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

// ═══════════════════════════════════════════════════════════
// REMOVE ATTENDEE  — DELETE /calendar/events/:id/attendees/:att_id
// ═══════════════════════════════════════════════════════════
calendar.delete('/events/:id/attendees/:att_id', async (c) => {
  const { company_id } = getUser(c)
  const eventId = Number(c.req.param('id'))
  const attId   = Number(c.req.param('att_id'))

  const exists = await c.env.DB
    .prepare(`SELECT id FROM calendar_events WHERE id = ? AND company_id = ?`)
    .bind(eventId, company_id).first()
  if (!exists) return c.json({ success: false, error: 'الحدث غير موجود' }, 404)

  await c.env.DB
    .prepare(`DELETE FROM event_attendees WHERE id = ? AND event_id = ?`)
    .bind(attId, eventId).run()

  return c.json({ success: true, data: null })
})

// ═══════════════════════════════════════════════════════════
// UPDATE ATTENDEE RESPONSE  — PATCH /calendar/events/:id/attendees/:att_id
// Body: { response: 'accepted' | 'declined' | 'pending' }
// ═══════════════════════════════════════════════════════════
calendar.patch('/events/:id/attendees/:att_id', async (c) => {
  const { company_id } = getUser(c)
  const eventId = Number(c.req.param('id'))
  const attId   = Number(c.req.param('att_id'))

  const exists = await c.env.DB
    .prepare(`SELECT id FROM calendar_events WHERE id = ? AND company_id = ?`)
    .bind(eventId, company_id).first()
  if (!exists) return c.json({ success: false, error: 'الحدث غير موجود' }, 404)

  const { response } = await c.req.json<{ response: string }>()
  const valid = ['pending', 'accepted', 'declined']
  if (!valid.includes(response)) return c.json({ success: false, error: 'الرد غير صالح' }, 400)

  await c.env.DB
    .prepare(`UPDATE event_attendees SET response = ? WHERE id = ? AND event_id = ?`)
    .bind(response, attId, eventId).run()

  return c.json({ success: true, data: null })
})

export default calendar
