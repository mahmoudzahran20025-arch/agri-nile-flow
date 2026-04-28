import { Hono } from 'hono'
import type { Env } from '../types'
import { getUser, permissionGuard } from '../middleware/auth'
import { FinanceCore } from '../lib/finance_core'

const assets = new Hono<{ Bindings: Env }>()

// GET /api/assets — list fixed assets
assets.get('/', permissionGuard('admin', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM fixed_assets
    WHERE company_id = ?
    ORDER BY acquisition_date DESC
  `).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// GET /api/assets/:id — get asset detail with depreciation schedule
assets.get('/:id', permissionGuard('admin', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const asset = await c.env.DB.prepare(`
    SELECT * FROM fixed_assets
    WHERE id = ? AND company_id = ?
  `).bind(id, company_id).first()

  if (!asset) return c.json({ success: false, error: 'الأصل غير موجود' }, 404)

  const schedule = await c.env.DB.prepare(`
    SELECT * FROM depreciation_schedules
    WHERE asset_id = ?
    ORDER BY period_year DESC, period_month DESC
  `).bind(id).all()

  return c.json({ success: true, data: { ...asset, schedule: schedule.results } })
})

// POST /api/assets — create new fixed asset
assets.post('/', permissionGuard('admin', 'write'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<{
    asset_code: string
    name: string
    category: string
    acquisition_date: string
    cost: number
    salvage_value?: number
    useful_life_months?: number
    depreciation_method?: string
    center_code?: number | null
    field_id?: number | null
    notes?: string
  }>()

  if (!body.asset_code || !body.name || !body.acquisition_date || !body.cost) {
    return c.json({ success: false, error: 'الحقول المطلوبة: asset_code, name, acquisition_date, cost' }, 400)
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO fixed_assets
    (company_id, asset_code, name, category, acquisition_date, cost, salvage_value, useful_life_months, depreciation_method, center_code, field_id, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    company_id,
    body.asset_code,
    body.name,
    body.category || 'equipment',
    body.acquisition_date,
    body.cost,
    body.salvage_value || 0,
    body.useful_life_months || 60,
    body.depreciation_method || 'straight_line',
    body.center_code || null,
    body.field_id || null,
    body.notes || null,
    userId
  ).run()

  const assetId = result.meta.last_row_id as number

  // Generate depreciation schedules from acquisition month to now
  const acqDate = new Date(body.acquisition_date)
  const now = new Date()
  const scheduleStmts: ReturnType<typeof c.env.DB.prepare>[] = []

  for (let y = acqDate.getFullYear(); y <= now.getFullYear(); y++) {
    const startMonth = y === acqDate.getFullYear() ? acqDate.getMonth() + 1 : 1
    const endMonth = y === now.getFullYear() ? now.getMonth() + 1 : 12

    for (let m = startMonth; m <= endMonth; m++) {
      scheduleStmts.push(
        c.env.DB.prepare(`
          INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, status)
          VALUES (?, ?, ?, ?, 'pending')
        `).bind(company_id, assetId, y, m)
      )
    }
  }

  if (scheduleStmts.length > 0) {
    await c.env.DB.batch(scheduleStmts)
  }

  return c.json({ success: true, data: { id: assetId, asset_code: body.asset_code } }, 201)
})

// PATCH /api/assets/:id — update asset details
assets.patch('/:id', permissionGuard('admin', 'write'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{
    name?: string
    cost?: number
    salvage_value?: number
    useful_life_months?: number
    is_active?: boolean
    notes?: string
  }>()

  const asset = await c.env.DB.prepare(`
    SELECT id FROM fixed_assets WHERE id = ? AND company_id = ?
  `).bind(id, company_id).first()

  if (!asset) return c.json({ success: false, error: 'الأصل غير موجود' }, 404)

  const updates: string[] = []
  const values: unknown[] = []

  if (body.name !== undefined) {
    updates.push('name = ?')
    values.push(body.name)
  }
  if (body.cost !== undefined) {
    updates.push('cost = ?')
    values.push(body.cost)
  }
  if (body.salvage_value !== undefined) {
    updates.push('salvage_value = ?')
    values.push(body.salvage_value)
  }
  if (body.useful_life_months !== undefined) {
    updates.push('useful_life_months = ?')
    values.push(body.useful_life_months)
  }
  if (body.is_active !== undefined) {
    updates.push('is_active = ?')
    values.push(body.is_active ? 1 : 0)
  }
  if (body.notes !== undefined) {
    updates.push('notes = ?')
    values.push(body.notes)
  }

  if (updates.length === 0) {
    return c.json({ success: true, data: { id } })
  }

  values.push(id)
  values.push(company_id)

  await c.env.DB.prepare(`
    UPDATE fixed_assets SET ${updates.join(', ')} WHERE id = ? AND company_id = ?
  `).bind(...values).run()

  return c.json({ success: true, data: { id } })
})

// POST /api/assets/run-depreciation — post depreciation for current month
assets.post('/run-depreciation', permissionGuard('admin', 'write'), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const now = new Date()

  try {
    const result = await FinanceCore.postMonthlyDepreciation(c.env.DB, {
      company_id,
      period_year: now.getFullYear(),
      period_month: now.getMonth() + 1,
      user_id: userId,
    })

    return c.json({
      success: true,
      data: {
        period: `${now.getFullYear()}/${now.getMonth() + 1}`,
        assets_processed: result.length,
        details: result,
      },
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
})

// GET /api/assets/:id/schedule — get full depreciation schedule
assets.get('/:id/schedule', permissionGuard('admin', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))

  const asset = await c.env.DB.prepare(`
    SELECT id FROM fixed_assets WHERE id = ? AND company_id = ?
  `).bind(id, company_id).first()

  if (!asset) return c.json({ success: false, error: 'الأصل غير موجود' }, 404)

  const { results } = await c.env.DB.prepare(`
    SELECT
      period_year, period_month,
      amount,
      COALESCE(accumulated, 0) as accumulated,
      status,
      journal_entry_id
    FROM depreciation_schedules
    WHERE asset_id = ?
    ORDER BY period_year ASC, period_month ASC
  `).bind(id).all()

  return c.json({ success: true, data: results })
})

export default assets
