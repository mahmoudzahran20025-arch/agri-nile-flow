/**
 * wip.ts
 * ======
 * Manual WIP entry API — allows accountants and farm managers to post
 * overhead, land rent, and other costs directly to a crop cycle's WIP ledger
 * without going through inventory movements or operations.
 *
 * Routes:
 *   POST /api/wip/manual-entry  — post a manual cost to a crop cycle
 *   GET  /api/wip/entries       — list manual WIP entries for a crop cycle
 */

import { Hono } from 'hono'
import type { Env } from '../types'
import { getUser, permissionGuard } from '../middleware/auth'
import { postCostToWIP, type WIPCostCategory } from '../lib/wip_engine'
import { normalizeIsoDate, isFutureIsoDate } from '../lib/utils/date'

const wip = new Hono<{ Bindings: Env }>()

// ── POST /api/wip/manual-entry ────────────────────────────────────────────────
wip.post('/manual-entry', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id, sub: userId } = getUser(c)

  const b = await c.req.json<{
    crop_cycle_id:      number
    cost_category_code: string
    amount:             number
    description:        string
    transaction_date:   string
    notes?:             string
  }>()

  if (!b.crop_cycle_id || !b.cost_category_code || !b.amount || !b.transaction_date) {
    return c.json({ success: false, error: 'crop_cycle_id, cost_category_code, amount, transaction_date مطلوبة' }, 400)
  }
  if (!Number.isFinite(b.amount) || b.amount <= 0) {
    return c.json({ success: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }, 400)
  }
  if (!b.description?.trim()) {
    return c.json({ success: false, error: 'الوصف مطلوب' }, 400)
  }

  const txDate = normalizeIsoDate(b.transaction_date)
  if (isFutureIsoDate(txDate)) {
    return c.json({ success: false, error: 'لا يمكن إدخال تاريخ مستقبلي' }, 422)
  }

  // Validate crop cycle belongs to company and is active
  const cycle = await c.env.DB.prepare(
    'SELECT id, season_id, status FROM crop_cycles WHERE id = ? AND company_id = ?'
  ).bind(b.crop_cycle_id, company_id).first<{ id: number; season_id: number; status: string }>()
  if (!cycle) return c.json({ success: false, error: 'دورة المحصول غير موجودة' }, 404)
  if (cycle.status !== 'active') {
    return c.json({ success: false, error: `لا يمكن الإضافة إلى دورة محصول بحالة ${cycle.status}`, code: 'CYCLE_NOT_ACTIVE' }, 422)
  }

  // Validate cost_category_code exists
  const cat = await c.env.DB.prepare(
    'SELECT code FROM cost_categories WHERE company_id = ? AND code = ? AND is_active = 1 LIMIT 1'
  ).bind(company_id, b.cost_category_code).first<{ code: string }>()
  if (!cat) {
    return c.json({ success: false, error: `كود الفئة التكليفية "${b.cost_category_code}" غير موجود أو غير نشط` }, 422)
  }

  try {
    const result = await postCostToWIP({
      db: c.env.DB,
      company_id,
      crop_cycle_id:      b.crop_cycle_id,
      season_id:          cycle.season_id,
      transaction_date:   txDate,
      cost_category:      b.cost_category_code as WIPCostCategory,
      cost_category_code: b.cost_category_code,
      debit:              Math.round(b.amount * 100) / 100,
      description:        b.description.trim(),
      source_module:      'manual_wip',
      source_id:          userId,
    })
    return c.json({ success: true, data: { wip_ledger_id: result.wip_ledger_id, running_balance: result.running_balance } }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: 'WIP_POST_FAILED' }, 422)
  }
})

// ── GET /api/wip/entries ──────────────────────────────────────────────────────
// Returns manual WIP entries (source_module='manual_wip') for a crop cycle,
// newest first. Used by CropCycleDetailPage manual entry history panel.
wip.get('/entries', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const cropCycleId = Number(c.req.query('crop_cycle_id'))
  if (!cropCycleId) return c.json({ success: false, error: 'crop_cycle_id مطلوب' }, 400)

  const { results } = await c.env.DB.prepare(`
    SELECT wl.id, wl.transaction_date, wl.cost_category, wl.cost_category_code,
           wl.debit, wl.running_balance, wl.description,
           cc.name AS category_name
    FROM wip_ledger wl
    LEFT JOIN cost_categories cc
      ON cc.company_id = wl.company_id AND cc.code = wl.cost_category_code
    WHERE wl.company_id = ? AND wl.crop_cycle_id = ?
      AND wl.source_module = 'manual_wip'
    ORDER BY wl.id DESC
    LIMIT 100
  `).bind(company_id, cropCycleId).all<{
    id: number
    transaction_date: string
    cost_category: string
    cost_category_code: string | null
    debit: number
    running_balance: number
    description: string | null
    category_name: string | null
  }>()

  return c.json({ success: true, data: results })
})

export default wip
