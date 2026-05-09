import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard } from '../middleware/auth'
import { FinanceCore } from '../lib/finance_core'
import { logAudit } from '../lib/audit'

const operations = new Hono<{ Bindings: Env }>()
operations.use('*', authMiddleware)
// RBAC: Production work-order lifecycle is limited to operations leadership.
operations.use('*', roleGuard(['super_admin', 'company_admin', 'field_supervisor', 'accountant']))

// ── Lifecycle transition rules ────────────────────────────────
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending:     ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done:        ['costed', 'in_progress'],  // allow back to in_progress if mistake
  costed:      [],                          // terminal state
  cancelled:   [],                          // terminal state
}

// ── Work Orders ──────────────────────────────────────────────

// GET /api/operations/orders
operations.get('/orders', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')
  const field_id  = c.req.query('field_id')
  const status    = c.req.query('status')
  const page      = Math.max(1, Number(c.req.query('page') ?? 1))
  const size      = Math.min(100, Number(c.req.query('size') ?? 50))
  const offset    = (page - 1) * size

  let sql = `SELECT wo.*,
               f.name AS field_name, f.area_feddan,
               s.name AS season_name,
               COALESCE(SUM(wt.quantity * wt.unit_cost), 0) AS labor_cost,
               COALESCE(im_costs.inv_cost, 0)                AS inventory_cost,
               COALESCE(eq_costs.eq_cost, 0)                 AS equipment_cost
             FROM work_orders wo
             LEFT JOIN fields f ON f.id = wo.field_id AND f.company_id = wo.company_id
             LEFT JOIN seasons s ON s.id = wo.season_id AND s.company_id = wo.company_id
             LEFT JOIN work_tasks wt ON wt.work_order_id = wo.id AND wt.company_id = wo.company_id
             LEFT JOIN (
               SELECT work_order_id, SUM(value_out) AS inv_cost
               FROM inventory_movements
               WHERE company_id = ? AND work_order_id IS NOT NULL
               GROUP BY work_order_id
             ) im_costs ON im_costs.work_order_id = wo.id
             LEFT JOIN (
               SELECT work_order_id, SUM(total_cost) AS eq_cost
               FROM work_order_equipment
               WHERE company_id = ?
               GROUP BY work_order_id
             ) eq_costs ON eq_costs.work_order_id = wo.id
             WHERE wo.company_id = ?`
  const params: unknown[] = [company_id, company_id, company_id]

  if (season_id) { sql += ' AND wo.season_id = ?'; params.push(Number(season_id)) }
  if (field_id)  { sql += ' AND wo.field_id = ?';  params.push(Number(field_id)) }
  if (status)    { sql += ' AND wo.status = ?';    params.push(status) }

  sql += ' GROUP BY wo.id'

  const countSql = `SELECT COUNT(DISTINCT wo.id) AS n FROM work_orders wo WHERE wo.company_id = ?` +
    (season_id ? ' AND wo.season_id = ?' : '') +
    (field_id  ? ' AND wo.field_id = ?'  : '') +
    (status    ? ' AND wo.status = ?'    : '')
  const countParams: unknown[] = [company_id]
  if (season_id) countParams.push(Number(season_id))
  if (field_id)  countParams.push(Number(field_id))
  if (status)    countParams.push(status)

  const countRow = await c.env.DB.prepare(countSql).bind(...countParams).first<{ n: number }>()

  sql += ` ORDER BY wo.planned_date DESC LIMIT ? OFFSET ?`
  params.push(size, offset)

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results, total: countRow?.n ?? 0, page, page_size: size })
})

// GET /api/operations/orders/:id  (with tasks + inventory + equipment consumed)
operations.get('/orders/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const order = await c.env.DB.prepare(
    `SELECT wo.*, f.name AS field_name, f.area_feddan, s.name AS season_name
     FROM work_orders wo
     LEFT JOIN fields f ON f.id = wo.field_id AND f.company_id = wo.company_id
     LEFT JOIN seasons s ON s.id = wo.season_id AND s.company_id = wo.company_id
     WHERE wo.id = ? AND wo.company_id = ?`
  ).bind(id, company_id).first()
  if (!order) return c.json({ success: false, error: 'أمر العمل غير موجود' }, 404)

  const { results: tasks } = await c.env.DB.prepare(
    `SELECT wt.*, e.name AS employee_name FROM work_tasks wt
     LEFT JOIN employees e ON e.id = wt.employee_id AND e.company_id = wt.company_id
     WHERE wt.work_order_id = ? AND wt.company_id = ? ORDER BY wt.task_date`
  ).bind(id, company_id).all()

  const { results: inventory } = await c.env.DB.prepare(
    `SELECT im.item_code, i.name AS item_name, i.unit,
            SUM(im.qty_out)    AS qty_consumed,
            SUM(im.value_out)  AS cost_consumed,
            COUNT(*)           AS movement_count
     FROM inventory_movements im
     LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
     WHERE im.work_order_id = ? AND im.company_id = ?
       AND im.movement_type IN ('ISSUE','TRANSFER_OUT','COGS_ADJUSTMENT','PRODUCTION_INPUT','ADJUSTMENT_LOSS')
     GROUP BY im.item_code
     ORDER BY cost_consumed DESC`
  ).bind(id, company_id).all()

  const { results: equipment } = await c.env.DB.prepare(
    `SELECT id, equipment_name, task_date, hours_worked, cost_per_hour, total_cost, notes
     FROM work_order_equipment
     WHERE work_order_id = ? AND company_id = ?
     ORDER BY task_date, id`
  ).bind(id, company_id).all()

  const laborCost     = tasks.reduce((s: number, t: Record<string, unknown>) => s + ((Number(t.quantity) || 0) * (Number(t.unit_cost) || 0)), 0)
  const inventoryCost = inventory.reduce((s: number, r: Record<string, unknown>) => s + (Number(r.cost_consumed) || 0), 0)
  const equipmentCost = equipment.reduce((s: number, r: Record<string, unknown>) => s + (Number(r.total_cost) || 0), 0)

  return c.json({
    success: true,
    data: {
      ...order,
      tasks,
      inventory,
      equipment,
      labor_cost:     laborCost,
      inventory_cost: inventoryCost,
      equipment_cost: equipmentCost,
      total_cost:     laborCost + inventoryCost + equipmentCost,
    },
  })
})

// POST /api/operations/orders
operations.post('/orders', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    name: string; operation_type: string; planned_date: string
    season_id?: number; field_id?: number; center_code?: number; area_feddan?: number; notes?: string
  }>()
  if (!b.name || !b.operation_type || !b.planned_date) {
    return c.json({ success: false, error: 'الاسم والنوع والتاريخ مطلوبة' }, 400)
  }

  // Prefer explicit center_code from form; otherwise inherit from selected field.
  let resolvedCenterCode: number | null = b.center_code ?? null
  if (resolvedCenterCode == null && b.field_id != null) {
    const fieldRow = await c.env.DB.prepare(
      'SELECT center_code FROM fields WHERE id = ? AND company_id = ?'
    ).bind(b.field_id, company_id).first<{ center_code: number | null }>()
    resolvedCenterCode = fieldRow?.center_code ?? null
  }

  if (resolvedCenterCode != null) {
    const validCenter = await c.env.DB.prepare(
      'SELECT 1 AS ok FROM cost_centers WHERE company_id = ? AND CAST(code AS INTEGER) = ? AND is_active = 1 LIMIT 1'
    ).bind(company_id, resolvedCenterCode).first<{ ok: number }>()
    if (!validCenter) {
      return c.json({ success: false, error: 'مركز التكلفة غير موجود أو غير نشط' }, 422)
    }
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO work_orders (company_id, season_id, field_id, center_code, name, operation_type,
     planned_date, area_feddan, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(company_id, b.season_id ?? null, b.field_id ?? null, resolvedCenterCode, b.name, b.operation_type,
     b.planned_date, b.area_feddan ?? null, b.notes ?? null, userId).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'work_orders', record_id: result.meta.last_row_id,
    new_value: { name: b.name, type: b.operation_type, status: 'pending' },
  })

  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

// PATCH /api/operations/orders/:id/status  — lifecycle transition
operations.patch('/orders/:id/status', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const { status, actual_date } = await c.req.json<{ status: string; actual_date?: string }>()

  const current = await c.env.DB.prepare(
    'SELECT status FROM work_orders WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ status: string }>()

  if (!current) return c.json({ success: false, error: 'أمر العمل غير موجود' }, 404)

  const allowed = ALLOWED_TRANSITIONS[current.status] ?? []
  if (!allowed.includes(status)) {
    return c.json({
      success: false,
      error: `لا يمكن الانتقال من "${current.status}" إلى "${status}"`,
      current_status: current.status,
      allowed_next:   allowed,
    }, 422)
  }

  if (status === 'costed') {
    try {
      const order = await c.env.DB.prepare(
        'SELECT center_code, actual_date, season_id, field_id FROM work_orders WHERE id = ? AND company_id = ?'
      ).bind(id, company_id).first<{ center_code: number; actual_date: string; season_id: number | null; field_id: number | null }>()

      let centerCode = order?.center_code ?? null
      if (centerCode == null && order?.field_id != null) {
        const fieldRow = await c.env.DB.prepare(
          'SELECT center_code FROM fields WHERE id = ? AND company_id = ?'
        ).bind(order.field_id, company_id).first<{ center_code: number | null }>()
        centerCode = fieldRow?.center_code ?? null
      }

      const tasks = await c.env.DB.prepare(
        'SELECT SUM(quantity * unit_cost) AS total_cost FROM work_tasks WHERE work_order_id = ?'
      ).bind(id).first<{ total_cost: number }>()

      const eqRow = await c.env.DB.prepare(
        `SELECT SUM(total_cost) AS total_cost
         FROM work_order_equipment
         WHERE work_order_id = ? AND company_id = ? AND journal_entry_id IS NULL`
      ).bind(id, company_id).first<{ total_cost: number }>()

      const laborCost        = tasks?.total_cost ?? 0
      const equipmentUnposted = eqRow?.total_cost ?? 0
      const totalCost         = laborCost + equipmentUnposted

      if (totalCost > 0) {
        const entryId = await FinanceCore.resolveWorkOrderLabor(c.env.DB, {
          company_id,
          ref_id: id,
          amount: totalCost,
          date: actual_date ?? order?.actual_date ?? new Date().toISOString().slice(0, 10),
          description: equipmentUnposted > 0
            ? `تكلفة عمليات ميدانية (عمالة + معدات غير مُرحّلة): أمر عمل #${id}`
            : `تكلفة عمليات ميدانية (عمالة): أمر عمل #${id}`,
          created_by: userId,
          center_code: centerCode ?? undefined,
          season_id: order?.season_id,
          field_id: order?.field_id,
        })

        if (equipmentUnposted > 0 && entryId) {
          await c.env.DB.prepare(
            `UPDATE work_order_equipment
             SET journal_entry_id = ?
             WHERE work_order_id = ? AND company_id = ? AND journal_entry_id IS NULL`
          ).bind(entryId, id, company_id).run()
        }
      }
    } catch (e: any) {
      return c.json({ success: false, error: `فشل ترحيل التكاليف: ${e.message}` }, 400)
    }
  }

  await c.env.DB.prepare(
    `UPDATE work_orders
     SET status = ?, actual_date = COALESCE(?, actual_date)
     WHERE id = ? AND company_id = ?`
  ).bind(status, actual_date ?? null, id, company_id).run()

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'UPDATE',
    table_name: 'work_orders', record_id: id,
    new_value: { status, previous_status: current.status, actual_date },
  })

  return c.json({ success: true, data: { id, status } })
})

// ── Work Tasks ───────────────────────────────────────────────

// POST /api/operations/orders/:id/tasks
operations.post('/orders/:id/tasks', async (c) => {
  const { company_id } = getUser(c)
  const orderId = Number(c.req.param('id'))
  const b = await c.req.json<{
    task_date: string; description: string; employee_id?: number
    quantity?: number; unit?: string; unit_cost?: number; notes?: string
  }>()
  if (!b.task_date || !b.description) {
    return c.json({ success: false, error: 'التاريخ والوصف مطلوبان' }, 400)
  }

  // Block task addition if order is costed or cancelled
  const order = await c.env.DB.prepare(
    'SELECT status FROM work_orders WHERE id = ? AND company_id = ?'
  ).bind(orderId, company_id).first<{ status: string }>()
  if (!order) return c.json({ success: false, error: 'أمر العمل غير موجود' }, 404)
  if (['costed', 'cancelled'].includes(order.status)) {
    return c.json({ success: false, error: 'لا يمكن إضافة مهام لأمر عمل مغلق أو ملغى' }, 422)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO work_tasks (work_order_id, company_id, employee_id, task_date, description,
     quantity, unit, unit_cost, notes) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(orderId, company_id, b.employee_id ?? null, b.task_date, b.description,
     b.quantity ?? null, b.unit ?? null, b.unit_cost ?? 0, b.notes ?? null).run()
  return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201)
})

// DELETE /api/operations/tasks/:id
operations.delete('/tasks/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM work_tasks WHERE id = ? AND company_id = ?').bind(id, company_id).run()
  return c.json({ success: true, data: null })
})

// ── Equipment Lines ──────────────────────────────────────────

// POST /api/operations/orders/:id/equipment
operations.post('/orders/:id/equipment', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const orderId = Number(c.req.param('id'))

  const order = await c.env.DB.prepare(
    `SELECT status, center_code, season_id, field_id
     FROM work_orders
     WHERE id = ? AND company_id = ?`
  ).bind(orderId, company_id).first<{
    status: string
    center_code: number | null
    season_id: number | null
    field_id: number | null
  }>()
  if (!order) return c.json({ success: false, error: 'أمر العمل غير موجود' }, 404)
  if (['costed', 'cancelled'].includes(order.status)) {
    return c.json({ success: false, error: 'لا يمكن إضافة معدات لأمر عمل مغلق أو ملغى' }, 422)
  }

  const b = await c.req.json<{
    equipment_name: string
    task_date: string
    hours_worked: number
    cost_per_hour: number
    equipment_usage_mode?: 'owned' | 'rental'
    fixed_asset_id?: number | null
    supplier_code?: number | null
    notes?: string
  }>()

  if (!b.equipment_name?.trim() || !b.task_date) {
    return c.json({ success: false, error: 'اسم المعدة والتاريخ مطلوبان' }, 400)
  }
  if (!Number.isFinite(b.hours_worked) || b.hours_worked <= 0) {
    return c.json({ success: false, error: 'عدد الساعات يجب أن يكون أكبر من صفر' }, 400)
  }
  if (!Number.isFinite(b.cost_per_hour) || b.cost_per_hour < 0) {
    return c.json({ success: false, error: 'التكلفة / ساعة يجب أن تكون صفر أو أكثر' }, 400)
  }

  const usageMode = b.equipment_usage_mode ?? 'rental'
  if (!['owned', 'rental'].includes(usageMode)) {
    return c.json({ success: false, error: 'نوع استخدام المعدة يجب أن يكون owned أو rental' }, 400)
  }
  if (usageMode === 'owned' && b.fixed_asset_id == null) {
    return c.json({ success: false, error: 'عند اختيار owned يجب تحديد الأصل الثابت' }, 422)
  }
  if (usageMode === 'owned' && b.fixed_asset_id != null) {
    const asset = await c.env.DB.prepare(
      'SELECT id FROM fixed_assets WHERE id = ? AND company_id = ? AND is_active = 1 LIMIT 1'
    ).bind(b.fixed_asset_id, company_id).first<{ id: number }>()
    if (!asset) return c.json({ success: false, error: 'الأصل الثابت المحدد غير موجود أو غير نشط' }, 422)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO work_order_equipment
     (work_order_id, company_id, equipment_name, task_date, hours_worked, cost_per_hour,
      equipment_usage_mode, fixed_asset_id, supplier_code, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(orderId, company_id, b.equipment_name.trim(), b.task_date,
         b.hours_worked, b.cost_per_hour, usageMode, b.fixed_asset_id ?? null,
         b.supplier_code ?? null, b.notes ?? null).run()

  const equipmentId = Number(result.meta.last_row_id)
  const equipmentCost = Math.round(b.hours_worked * b.cost_per_hour * 100) / 100

  if (equipmentCost > 0) {
    try {
      const entryId = await FinanceCore.resolveWorkOrderLabor(c.env.DB, {
        company_id,
        ref_id: equipmentId,
        amount: equipmentCost,
        date: b.task_date,
        description: `تشغيل معدة: ${b.equipment_name.trim()} | أمر عمل #${orderId}`,
        created_by: userId,
        center_code: order?.center_code ?? undefined,
        season_id: order?.season_id,
        field_id: order?.field_id,
      })

      if (entryId) {
        await c.env.DB.prepare(
          'UPDATE work_order_equipment SET journal_entry_id = ? WHERE id = ? AND company_id = ?'
        ).bind(entryId, equipmentId, company_id).run()
      }
    } catch (e: any) {
      await c.env.DB.prepare(
        'DELETE FROM work_order_equipment WHERE id = ? AND company_id = ?'
      ).bind(equipmentId, company_id).run()
      return c.json({ success: false, error: `فشل ترحيل تكلفة المعدة: ${e.message}` }, 400)
    }
  }

  return c.json({ success: true, data: { id: equipmentId } }, 201)
})

// DELETE /api/operations/equipment/:id
operations.delete('/equipment/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const row = await c.env.DB.prepare(
    'SELECT journal_entry_id FROM work_order_equipment WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<{ journal_entry_id: number | null }>()
  if (!row) return c.json({ success: false, error: 'سطر المعدة غير موجود' }, 404)
  if (row.journal_entry_id) {
    return c.json({ success: false, error: 'لا يمكن حذف سطر معدة مُرحّل محاسبيًا' }, 422)
  }

  await c.env.DB.prepare(
    'DELETE FROM work_order_equipment WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).run()
  return c.json({ success: true, data: null })
})

// GET /api/operations/summary  (by season/field)
operations.get('/summary', async (c) => {
  const { company_id } = getUser(c)
  const season_id = c.req.query('season_id')

  let sql = `SELECT wo.operation_type,
               COUNT(*) AS order_count,
               SUM(CASE WHEN wo.status = 'done'   THEN 1 ELSE 0 END) AS done_count,
               SUM(CASE WHEN wo.status = 'costed' THEN 1 ELSE 0 END) AS costed_count,
               COALESCE(SUM(wt.quantity * wt.unit_cost), 0) AS labor_cost
             FROM work_orders wo
             LEFT JOIN work_tasks wt ON wt.work_order_id = wo.id
             WHERE wo.company_id = ?`
  const params: unknown[] = [company_id]
  if (season_id) { sql += ' AND wo.season_id = ?'; params.push(Number(season_id)) }
  sql += ' GROUP BY wo.operation_type ORDER BY labor_cost DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ success: true, data: results })
})

// GET /api/operations/orders/by-field  — drill-down for CostByFieldPage
operations.get('/orders/by-field', async (c) => {
  const { company_id } = getUser(c)
  const field_id  = c.req.query('field_id')
  const season_id = c.req.query('season_id')
  if (!field_id) return c.json({ success: false, error: 'field_id مطلوب' }, 400)

  const params: unknown[] = [company_id, Number(field_id)]
  let sql = `
    SELECT
      wo.id, wo.name, wo.operation_type, wo.status, wo.planned_date, wo.actual_date,
      COALESCE(SUM(wt.quantity * wt.unit_cost), 0) AS labor_cost,
      COALESCE((SELECT SUM(COALESCE(im.value_out, 0)) FROM inventory_movements im WHERE im.work_order_id = wo.id), 0) AS inv_cost,
      COALESCE((SELECT SUM(woe.total_cost) FROM work_order_equipment woe WHERE woe.work_order_id = wo.id), 0) AS equipment_cost
    FROM work_orders wo
    LEFT JOIN work_tasks wt ON wt.work_order_id = wo.id
    WHERE wo.company_id = ? AND wo.field_id = ?`
  if (season_id) { sql += ' AND wo.season_id = ?'; params.push(Number(season_id)) }
  sql += ' GROUP BY wo.id ORDER BY wo.planned_date DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all<{
    id: number; name: string; operation_type: string; status: string
    planned_date: string; actual_date: string | null
    labor_cost: number; inv_cost: number; equipment_cost: number
  }>()

  const enriched = results.map(r => ({
    ...r,
    total_cost: r.labor_cost + r.inv_cost + r.equipment_cost,
  }))
  return c.json({ success: true, data: enriched })
})

// ── Work Order Templates ──────────────────────────────────────

// GET /api/operations/templates
operations.get('/templates', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM wo_template_tasks tt WHERE tt.template_id = t.id) AS task_count
    FROM wo_templates t
    WHERE t.company_id = ? AND t.is_active = 1
    ORDER BY t.operation_type, t.name
  `).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// GET /api/operations/templates/:id
operations.get('/templates/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const tpl = await c.env.DB.prepare(
    'SELECT * FROM wo_templates WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first()
  if (!tpl) return c.json({ success: false, error: 'النموذج غير موجود' }, 404)

  const [{ results: tasks }, { results: equipment }] = await Promise.all([
    c.env.DB.prepare(
      'SELECT * FROM wo_template_tasks WHERE template_id = ? ORDER BY task_order, id'
    ).bind(id).all(),
    c.env.DB.prepare(
      'SELECT * FROM wo_template_equipment WHERE template_id = ? ORDER BY item_order, id'
    ).bind(id).all(),
  ])
  return c.json({ success: true, data: { ...tpl, tasks, equipment } })
})

// POST /api/operations/templates
operations.post('/templates', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = await c.req.json<{
    name: string; operation_type: string; description?: string
    tasks?: Array<{ task_name: string; estimated_hours?: number; notes?: string }>
  }>()
  if (!b.name || !b.operation_type)
    return c.json({ success: false, error: 'الاسم ونوع العملية مطلوبان' }, 400)

  const r = await c.env.DB.prepare(
    `INSERT INTO wo_templates (company_id, name, operation_type, description, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(company_id, b.name, b.operation_type, b.description ?? null, userId).run()

  const tplId = r.meta.last_row_id
  if (b.tasks && b.tasks.length > 0) {
    for (let i = 0; i < b.tasks.length; i++) {
      const t = b.tasks[i]
      await c.env.DB.prepare(
        `INSERT INTO wo_template_tasks (template_id, company_id, task_name, task_order, estimated_hours, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(tplId, company_id, t.task_name, i + 1, t.estimated_hours ?? null, t.notes ?? null).run()
    }
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'wo_templates', record_id: tplId,
    new_value: { name: b.name, operation_type: b.operation_type },
  })
  return c.json({ success: true, data: { id: tplId } }, 201)
})

// PATCH /api/operations/templates/:id
operations.patch('/templates/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{ name?: string; description?: string; is_active?: number }>()
  const sets: string[] = []; const vals: unknown[] = []
  if (b.name        !== undefined) { sets.push('name = ?');        vals.push(b.name) }
  if (b.description !== undefined) { sets.push('description = ?'); vals.push(b.description) }
  if (b.is_active   !== undefined) { sets.push('is_active = ?');   vals.push(b.is_active) }
  if (sets.length === 0) return c.json({ success: true, data: null })
  vals.push(id, company_id)
  await c.env.DB.prepare(`UPDATE wo_templates SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).bind(...vals).run()
  return c.json({ success: true, data: null })
})

// DELETE /api/operations/templates/:id
operations.delete('/templates/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM wo_templates WHERE id = ? AND company_id = ?').bind(id, company_id).run()
  return c.json({ success: true, data: null })
})

// POST /api/operations/templates/:id/tasks
operations.post('/templates/:id/tasks', async (c) => {
  const { company_id } = getUser(c)
  const tplId = Number(c.req.param('id'))
  const b = await c.req.json<{ task_name: string; estimated_hours?: number; notes?: string }>()
  if (!b.task_name) return c.json({ success: false, error: 'اسم المهمة مطلوب' }, 400)

  const maxRow = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(task_order),0) AS m FROM wo_template_tasks WHERE template_id = ?'
  ).bind(tplId).first<{ m: number }>()

  const r = await c.env.DB.prepare(
    `INSERT INTO wo_template_tasks (template_id, company_id, task_name, task_order, estimated_hours, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(tplId, company_id, b.task_name, (maxRow?.m ?? 0) + 1, b.estimated_hours ?? null, b.notes ?? null).run()
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

// PATCH /api/operations/template-tasks/:id
operations.patch('/template-tasks/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{ task_name?: string; task_order?: number; estimated_hours?: number; notes?: string }>()
  const sets: string[] = []; const vals: unknown[] = []
  if (b.task_name       !== undefined) { sets.push('task_name = ?');       vals.push(b.task_name) }
  if (b.task_order      !== undefined) { sets.push('task_order = ?');      vals.push(b.task_order) }
  if (b.estimated_hours !== undefined) { sets.push('estimated_hours = ?'); vals.push(b.estimated_hours) }
  if (b.notes           !== undefined) { sets.push('notes = ?');           vals.push(b.notes) }
  if (sets.length === 0) return c.json({ success: true, data: null })
  vals.push(id, company_id)
  await c.env.DB.prepare(`UPDATE wo_template_tasks SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).bind(...vals).run()
  return c.json({ success: true, data: null })
})

// DELETE /api/operations/template-tasks/:id
operations.delete('/template-tasks/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM wo_template_tasks WHERE id = ? AND company_id = ?').bind(id, company_id).run()
  return c.json({ success: true, data: null })
})

// POST /api/operations/templates/:id/equipment
operations.post('/templates/:id/equipment', async (c) => {
  const { company_id } = getUser(c)
  const tplId = Number(c.req.param('id'))
  const b = await c.req.json<{
    equipment_name: string; estimated_hours?: number; cost_per_hour?: number; notes?: string
  }>()
  if (!b.equipment_name) return c.json({ success: false, error: 'اسم المعدة مطلوب' }, 400)

  const maxRow = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(item_order),0) AS m FROM wo_template_equipment WHERE template_id = ?'
  ).bind(tplId).first<{ m: number }>()

  const r = await c.env.DB.prepare(
    `INSERT INTO wo_template_equipment (template_id, company_id, equipment_name, item_order, estimated_hours, cost_per_hour, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(tplId, company_id, b.equipment_name, (maxRow?.m ?? 0) + 1,
    b.estimated_hours ?? null, b.cost_per_hour ?? 0, b.notes ?? null).run()
  return c.json({ success: true, data: { id: r.meta.last_row_id } }, 201)
})

// DELETE /api/operations/template-equipment/:id
operations.delete('/template-equipment/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(
    'DELETE FROM wo_template_equipment WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).run()
  return c.json({ success: true, data: null })
})

// POST /api/operations/templates/:id/use  — create work order from template
operations.post('/templates/:id/use', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const tplId = Number(c.req.param('id'))
  const b = await c.req.json<{
    name?: string; planned_date: string
    season_id?: number; field_id?: number; area_feddan?: number; notes?: string
  }>()
  if (!b.planned_date) return c.json({ success: false, error: 'تاريخ التخطيط مطلوب' }, 400)

  const tpl = await c.env.DB.prepare(
    'SELECT * FROM wo_templates WHERE id = ? AND company_id = ?'
  ).bind(tplId, company_id).first<{ name: string; operation_type: string }>()
  if (!tpl) return c.json({ success: false, error: 'النموذج غير موجود' }, 404)

  const [{ results: tplTasks }, { results: tplEquipment }] = await Promise.all([
    c.env.DB.prepare(
      'SELECT * FROM wo_template_tasks WHERE template_id = ? ORDER BY task_order, id'
    ).bind(tplId).all<{ task_name: string; notes: string | null }>(),
    c.env.DB.prepare(
      'SELECT * FROM wo_template_equipment WHERE template_id = ? ORDER BY item_order, id'
    ).bind(tplId).all<{ equipment_name: string; estimated_hours: number | null; cost_per_hour: number; notes: string | null }>(),
  ])

  const woResult = await c.env.DB.prepare(
    `INSERT INTO work_orders (company_id, season_id, field_id, name, operation_type,
     planned_date, area_feddan, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    company_id,
    b.season_id ?? null, b.field_id ?? null,
    b.name ?? tpl.name, tpl.operation_type,
    b.planned_date, b.area_feddan ?? null, b.notes ?? null, userId
  ).run()

  const woId = woResult.meta.last_row_id
  for (const t of tplTasks) {
    await c.env.DB.prepare(
      `INSERT INTO work_tasks (work_order_id, company_id, task_date, description, notes)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(woId, company_id, b.planned_date, t.task_name, t.notes ?? null).run()
  }
  for (const e of tplEquipment) {
    await c.env.DB.prepare(
      `INSERT INTO work_order_equipment (work_order_id, company_id, equipment_name, task_date, hours_worked, cost_per_hour, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(woId, company_id, e.equipment_name, b.planned_date,
      e.estimated_hours ?? 0, e.cost_per_hour, e.notes ?? null).run()
  }

  void logAudit(c.env.DB, {
    user_id: userId, company_id, action: 'CREATE',
    table_name: 'work_orders', record_id: woId,
    new_value: { name: b.name ?? tpl.name, from_template: tplId, task_count: tplTasks.length, equipment_count: tplEquipment.length },
  })
  return c.json({ success: true, data: { id: woId, task_count: tplTasks.length, equipment_count: tplEquipment.length } }, 201)
})

export default operations
