/**
 * src/api/gl/master-data.ts
 * 
 * Phase 1: Master Data Management Endpoints
 * Handles: Material Groups, Business Units, Account Roles, Currencies, Costing Methods
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { logAudit } from '../../lib/audit'
import type {
  CreateMaterialGroupRequest,
  CreateBusinessUnitRequest,
  MaterialGroup,
  BusinessUnit,
  AccountRole,
  Currency,
  CostingMethod,
} from '../../types/posting_v2'

const masterData = new Hono<{ Bindings: Env }>()

// Middleware: All master data endpoints require auth and GL permission
masterData.use('*', authMiddleware)
masterData.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// ============================================================================
// MATERIAL GROUPS
// ============================================================================

// GET /api/gl/master-data/material-groups
masterData.get('/material-groups', async (c) => {
  const { company_id } = getUser(c)
  const active = c.req.query('active')
  
  let query = 'SELECT * FROM md_material_groups WHERE company_id = ?'
  const params: any[] = [company_id]
  
  if (active === '1' || active === 'true') {
    query += ' AND is_active = 1'
  }
  
  query += ' ORDER BY code ASC'
  
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  
  return c.json({
    success: true,
    data: results as unknown as MaterialGroup[],
    count: results?.length ?? 0,
  })
})

// GET /api/gl/master-data/material-groups/:id
masterData.get('/material-groups/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  
  const result = await c.env.DB.prepare(
    'SELECT * FROM md_material_groups WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<MaterialGroup>()
  
  if (!result) {
    return c.json({ success: false, error: 'مجموعة المواد غير موجودة' }, 404)
  }
  
  return c.json({ success: true, data: result })
})

// POST /api/gl/master-data/material-groups
masterData.post('/material-groups', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<CreateMaterialGroupRequest>()
  
  if (!body.code || !body.name) {
    return c.json({
      success: false,
      error: 'الكود والاسم مطلوبان',
    }, 400)
  }
  
  // Check for duplicate code
  const existing = await c.env.DB.prepare(
    'SELECT id FROM md_material_groups WHERE company_id = ? AND code = ?'
  ).bind(company_id, body.code).first()
  
  if (existing) {
    return c.json({
      success: false,
      error: 'هذا الكود موجود مسبقاً',
      code: 'DUPLICATE_CODE',
    }, 409)
  }
  
  const result = await c.env.DB.prepare(`
    INSERT INTO md_material_groups (company_id, code, name, description, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).bind(company_id, body.code, body.name, body.description ?? null).run()
  
  // Audit log
  await logAudit(c.env.DB, {
    user_id: userId,
    company_id,
    action: 'CREATE',
    table_name: 'md_material_groups',
    record_id: result.meta.last_row_id as number,
    new_value: body,
  })
  
  return c.json({
    success: true,
    data: { id: result.meta.last_row_id, ...body },
  }, 201)
})

// PATCH /api/gl/master-data/material-groups/:id
masterData.patch('/material-groups/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<Partial<CreateMaterialGroupRequest>>()
  
  // Check if exists
  const existing = await c.env.DB.prepare(
    'SELECT * FROM md_material_groups WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<MaterialGroup>()
  
  if (!existing) {
    return c.json({ success: false, error: 'مجموعة المواد غير موجودة' }, 404)
  }
  
  // Check for duplicate code if updating
  if (body.code && body.code !== existing.code) {
    const dup = await c.env.DB.prepare(
      'SELECT id FROM md_material_groups WHERE company_id = ? AND code = ?'
    ).bind(company_id, body.code).first()
    if (dup) {
      return c.json({ success: false, error: 'هذا الكود موجود مسبقاً' }, 409)
    }
  }
  
  // Build update
  const updates: string[] = []
  const params: any[] = []
  
  if (body.code) { updates.push('code = ?'); params.push(body.code) }
  if (body.name) { updates.push('name = ?'); params.push(body.name) }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(body.description) }
  
  if (updates.length === 0) {
    return c.json({ success: false, error: 'لا توجد تحديثات' }, 400)
  }
  
  updates.push('updated_at = datetime("now")')
  params.push(id, company_id)
  
  await c.env.DB.prepare(`
    UPDATE md_material_groups
    SET ${updates.join(', ')}
    WHERE id = ? AND company_id = ?
  `).bind(...params).run()
  
  // Audit log
  await logAudit(c.env.DB, {
    user_id: userId,
    company_id,
    action: 'UPDATE',
    table_name: 'md_material_groups',
    record_id: id,
    new_value: body,
  })
  
  return c.json({ success: true, data: { ...existing, ...body, id } as MaterialGroup })
})

// ============================================================================
// BUSINESS UNITS

// GET /api/gl/master-data/business-units
masterData.get('/business-units', async (c) => {
  const { company_id } = getUser(c)
  const active = c.req.query('active')
  
  let query = 'SELECT * FROM md_business_units WHERE company_id = ?'
  const params: any[] = [company_id]
  
  if (active === '1' || active === 'true') {
    query += ' AND is_active = 1'
  }
  
  query += ' ORDER BY code ASC'
  
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  
  return c.json({
    success: true,
    data: results as unknown as BusinessUnit[],
    count: results?.length ?? 0,
  })
})

// GET /api/gl/master-data/business-units/:id
masterData.get('/business-units/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  
  const result = await c.env.DB.prepare(
    'SELECT * FROM md_business_units WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<BusinessUnit>()
  
  if (!result) {
    return c.json({ success: false, error: 'الوحدة التنظيمية غير موجودة' }, 404)
  }
  
  return c.json({ success: true, data: result })
})

// POST /api/gl/master-data/business-units
masterData.post('/business-units', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const body = await c.req.json<CreateBusinessUnitRequest>()
  
  if (!body.code || !body.name) {
    return c.json({
      success: false,
      error: 'الكود والاسم مطلوبان',
    }, 400)
  }
  
  // Check for duplicate code
  const existing = await c.env.DB.prepare(
    'SELECT id FROM md_business_units WHERE company_id = ? AND code = ?'
  ).bind(company_id, body.code).first()
  
  if (existing) {
    return c.json({
      success: false,
      error: 'هذا الكود موجود مسبقاً',
      code: 'DUPLICATE_CODE',
    }, 409)
  }
  
  const result = await c.env.DB.prepare(`
    INSERT INTO md_business_units (company_id, code, name, description, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).bind(company_id, body.code, body.name, body.description ?? null).run()
  
  // Audit log
  await logAudit(c.env.DB, {
    user_id: userId,
    company_id,
    action: 'CREATE',
    table_name: 'md_business_units',
    record_id: result.meta.last_row_id as number,
    new_value: body,
  })
  
  return c.json({
    success: true,
    data: { id: result.meta.last_row_id, ...body },
  }, 201)
})

// PATCH /api/gl/master-data/business-units/:id
masterData.patch('/business-units/:id', async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<Partial<CreateBusinessUnitRequest>>()
  
  // Check if exists
  const existing = await c.env.DB.prepare(
    'SELECT * FROM md_business_units WHERE id = ? AND company_id = ?'
  ).bind(id, company_id).first<BusinessUnit>()
  
  if (!existing) {
    return c.json({ success: false, error: 'الوحدة التنظيمية غير موجودة' }, 404)
  }
  
  // Check for duplicate code if updating
  if (body.code && body.code !== existing.code) {
    const dup = await c.env.DB.prepare(
      'SELECT id FROM md_business_units WHERE company_id = ? AND code = ?'
    ).bind(company_id, body.code).first()
    if (dup) {
      return c.json({ success: false, error: 'هذا الكود موجود مسبقاً' }, 409)
    }
  }
  
  // Build update
  const updates: string[] = []
  const params: any[] = []
  
  if (body.code) { updates.push('code = ?'); params.push(body.code) }
  if (body.name) { updates.push('name = ?'); params.push(body.name) }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(body.description) }
  
  if (updates.length === 0) {
    return c.json({ success: false, error: 'لا توجد تحديثات' }, 400)
  }
  
  updates.push('updated_at = datetime("now")')
  params.push(id, company_id)
  
  await c.env.DB.prepare(`
    UPDATE md_business_units
    SET ${updates.join(', ')}
    WHERE id = ? AND company_id = ?
  `).bind(...params).run()
  
  // Audit log
  await logAudit(c.env.DB, {
    user_id: userId,
    company_id,
    action: 'UPDATE',
    table_name: 'md_business_units',
    record_id: id,
    new_value: body,
  })
  
  return c.json({ success: true, data: { ...existing, ...body, id } as BusinessUnit })
})

// ============================================================================
// ACCOUNT ROLES (Reference data - read only)
// ============================================================================

// GET /api/gl/master-data/account-roles
masterData.get('/account-roles', async (c) => {
  const category = c.req.query('category')
  
  let query = 'SELECT * FROM md_account_roles WHERE is_active = 1'
  const params: any[] = []
  
  if (category) {
    query += ' AND category = ?'
    params.push(category)
  }
  
  query += ' ORDER BY category ASC, code ASC'
  
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  
  return c.json({
    success: true,
    data: results as unknown as AccountRole[],
    count: results?.length ?? 0,
  })
})

// ============================================================================
// CURRENCIES (Reference data - read only)
// ============================================================================

// GET /api/gl/master-data/currencies
masterData.get('/currencies', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM md_currencies WHERE is_active = 1 ORDER BY code ASC
  `).all()
  
  return c.json({
    success: true,
    data: results as unknown as Currency[],
    count: results?.length ?? 0,
  })
})

// ============================================================================
// COSTING METHODS (Reference data - read only)
// ============================================================================

// GET /api/gl/master-data/costing-methods
masterData.get('/costing-methods', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM md_costing_methods WHERE is_active = 1 ORDER BY code ASC
  `).all()
  
  return c.json({
    success: true,
    data: results as unknown as CostingMethod[],
    count: results?.length ?? 0,
  })
})

export default masterData
