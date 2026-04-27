import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'

const geo = new Hono<{ Bindings: Env }>()

// ── Geo helpers ──────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

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

// ── Geo Check-in ─────────────────────────────────────────────

geo.post('/geo/check-in', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id: number
    work_date:   string
    lat:         number
    lng:         number
    accuracy_m:  number
    field_id?:   number
  }>()

  if (!b.employee_id || !b.work_date || b.lat == null || b.lng == null) {
    return c.json({ success: false, error: 'بيانات ناقصة: employee_id, work_date, lat, lng مطلوبة' }, 400)
  }

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

// ── Location Tasks ────────────────────────────────────────────

geo.get('/location-tasks', async (c) => {
  const { company_id } = getUser(c)
  const empId    = c.req.query('employee_id')
  const taskDate = c.req.query('date')
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

geo.post('/location-tasks', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    employee_id:  number
    task_date:    string
    field_id?:    number
    custom_lat?:  number
    custom_lng?:  number
    custom_name?: string
    tolerance_m?: number
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

geo.patch('/location-tasks/:id/arrive', async (c) => {
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

  let distance_m: number | null = null
  let newStatus = 'arrived'

  if (fieldPolygon && fieldPolygon.length >= 3) {
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

geo.patch('/location-tasks/:id/cancel', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const taskId = Number(c.req.param('id'))
  await c.env.DB.prepare(
    `UPDATE location_tasks SET status = 'missed' WHERE id = ? AND company_id = ? AND status = 'pending'`
  ).bind(taskId, company_id).run()
  void logAudit(c.env.DB, { user_id: userId, company_id, action: 'CANCEL', table_name: 'location_tasks', record_id: taskId })
  return c.json({ success: true, data: null })
})

export default geo
