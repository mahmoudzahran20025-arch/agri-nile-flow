/**
 * Inventory Governance API
 * - POST /gl-preview      — GL preview for a movement (no side effects)
 * - GET  /items-master    — items with full accounting fields
 * - PATCH /items-master/:code — update accounting fields on item
 * - GET  /posting-health  — posting setup completeness check per warehouse×PPG
 */
import { Hono } from 'hono'
import type { Env } from '../../types'
import { getUser, permissionGuard } from '../../middleware/auth'
import { FinanceCore } from '../../lib/finance_core'
import { getInventoryPostingControls } from '../../lib/inventory_posting'

const governance = new Hono<{ Bindings: Env }>()

// ── POST /gl-preview ────────────────────────────────────────────────────────
// Returns a preview of the GL journal entry that would be generated
// for a proposed inventory movement. No writes.

governance.post('/gl-preview', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const b = await c.req.json<{
    warehouse:      string
    item_code:      number
    movement_type:  'اضافة' | 'صرف'
    quantity:       number
    unit_price?:    number
    payment_method?: 'cash' | 'credit'
    center_code?:   number
  }>()

  if (!b.warehouse || !b.item_code || !b.quantity || !b.movement_type) {
    return c.json({ success: false, error: 'warehouse, item_code, quantity, movement_type required' }, 400)
  }

  // 1. Resolve item and warehouse IPG
  const item = await c.env.DB.prepare(
    'SELECT name, unit, prod_posting_group_code, inv_posting_group_code FROM items WHERE company_id = ? AND code = ?'
  ).bind(company_id, b.item_code).first<{
    name: string; unit: string | null
    prod_posting_group_code: string | null
    inv_posting_group_code: string | null
  }>()

  if (!item) return c.json({ success: false, error: 'الصنف غير موجود' }, 404)

  // 2. Resolve warehouse IPG
  const warehouse = await c.env.DB.prepare(
    'SELECT inv_posting_group_code FROM warehouses WHERE company_id = ? AND name = ? AND is_active = 1'
  ).bind(company_id, b.warehouse).first<{ inv_posting_group_code: string | null }>()

  const ipg = warehouse?.inv_posting_group_code ?? null
  const ppg = item.prod_posting_group_code ?? null

  // 3. Find posting setup (exact match first, then fallbacks)
  const setup = await c.env.DB.prepare(
    `SELECT inventory_account, purchases_account, cogs_account, expense_account
     FROM posting_rules
     WHERE company_id = ? AND rule_type = 'inventory' AND is_active = 1
       AND (inv_posting_group_code = ? OR inv_posting_group_code IS NULL)
       AND (prod_posting_group_code = ? OR prod_posting_group_code IS NULL)
     ORDER BY
       CASE WHEN inv_posting_group_code IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN prod_posting_group_code IS NOT NULL THEN 0 ELSE 1 END
     LIMIT 1`
  ).bind(company_id, ipg, ppg).first<{
    inventory_account: string | null
    purchases_account: string | null
    cogs_account: string | null
    expense_account: string | null
  }>()

  // 4. Compute effective unit price
  const lastRow = await c.env.DB.prepare(
    `SELECT balance_qty, balance_value FROM inventory_movements
     WHERE company_id = ? AND item_code = ? AND warehouse = ?
     ORDER BY movement_date DESC, id DESC LIMIT 1`
  ).bind(company_id, b.item_code, b.warehouse).first<{ balance_qty: number; balance_value: number }>()

  const avgCost = (lastRow?.balance_qty ?? 0) > 0
    ? (lastRow!.balance_value / lastRow!.balance_qty)
    : (b.unit_price ?? 0)

  const unitPrice = b.unit_price ?? avgCost
  const value = b.quantity * unitPrice

  // 5. Build GL lines
  const lines: {
    side: 'DR' | 'CR'
    account_code: string
    account_label: string
    amount: number
    narration: string
  }[] = []

  const invAcc      = setup?.inventory_account  ?? '140701'
  const cogsAcc     = setup?.cogs_account       ?? '45010001'
  const supplierAcc = '2120'  // Accounts payable
  const cashAcc     = '14010101'

  if (b.movement_type === 'اضافة') {
    // Purchase receipt: DR Inventory / CR Supplier (credit) or CR Cash (cash)
    lines.push({ side: 'DR', account_code: invAcc,   account_label: 'أصول - المخزون',       amount: value, narration: `استلام ${item.name} - ${b.warehouse}` })
    if (b.payment_method === 'cash') {
      lines.push({ side: 'CR', account_code: cashAcc,     account_label: 'صندوق النقدية',      amount: value, narration: `دفع نقدي لـ ${item.name}` })
    } else {
      lines.push({ side: 'CR', account_code: supplierAcc, account_label: 'دائنو الموردين (2120)', amount: value, narration: `ذمة مورد - ${item.name}` })
    }
  } else {
    // Issue: DR COGS / CR Inventory
    lines.push({ side: 'DR', account_code: cogsAcc,  account_label: 'تكلفة المبيعات (COGS)', amount: value, narration: `صرف ${item.name} - ${b.warehouse}` })
    lines.push({ side: 'CR', account_code: invAcc,   account_label: 'أصول - المخزون',        amount: value, narration: `إخراج مخزون ${item.name}` })
  }

  const warnings: string[] = []
  if (!setup) warnings.push(`لا يوجد إعداد ترحيل للتوليفة (${ipg ?? 'ANY'} × ${ppg ?? 'ANY'}) — سيُستخدم الحساب الافتراضي`)
  if (!ipg)   warnings.push(`المخزن "${b.warehouse}" لا يملك مجموعة ترحيل مخزون (IPG)`)
  if (!ppg)   warnings.push(`الصنف "${item.name}" لا يملك مجموعة ترحيل منتج (PPG)`)

  return c.json({
    success: true,
    data: {
      item_name:      item.name,
      item_unit:      item.unit,
      ipg,
      ppg,
      unit_price:     unitPrice,
      value,
      lines,
      is_balanced:    lines.filter(l => l.side === 'DR').reduce((s, l) => s + l.amount, 0) ===
                      lines.filter(l => l.side === 'CR').reduce((s, l) => s + l.amount, 0),
      warnings,
    },
  })
})

// ── GET /items-master ────────────────────────────────────────────────────────
// Returns items with all accounting fields + current balance totals

governance.get('/items-master', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(
    `SELECT
       i.code, i.name, i.unit, i.category_id,
       i.prod_posting_group_code, i.inv_posting_group_code,
       i.standard_cost, i.reorder_threshold,
       cat.name AS category_name,
       COALESCE(bal.total_qty,   0) AS total_qty,
       COALESCE(bal.total_value, 0) AS total_value,
       bal.warehouse_count
     FROM items i
     LEFT JOIN item_categories cat ON cat.id = i.category_id
     LEFT JOIN (
       SELECT item_code,
              SUM(balance_qty)   AS total_qty,
              SUM(balance_value) AS total_value,
              COUNT(DISTINCT warehouse) AS warehouse_count
       FROM (
         SELECT item_code, warehouse, balance_qty, balance_value
         FROM inventory_movements im2
         WHERE company_id = ? AND id IN (
           SELECT MAX(id) FROM inventory_movements
           WHERE company_id = ?
           GROUP BY item_code, warehouse
         )
       )
       GROUP BY item_code
     ) bal ON bal.item_code = i.code
     WHERE i.company_id = ?
     ORDER BY i.name`
  ).bind(company_id, company_id, company_id).all()

  return c.json({ success: true, data: results })
})

// ── PATCH /items-master/:code ────────────────────────────────────────────────
// Update accounting fields on an item (PPG, IPG, standard cost, reorder threshold)

governance.patch('/items-master/:code', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id } = getUser(c)
  const code = Number(c.req.param('code'))

  const b = await c.req.json<{
    prod_posting_group_code?: string | null
    inv_posting_group_code?:  string | null
    standard_cost?:           number | null
    reorder_threshold?:       number | null
    name?:                    string
    unit?:                    string
  }>()

  // Build SET clause dynamically
  const sets: string[] = []
  const binds: unknown[] = []

  if ('prod_posting_group_code' in b) { sets.push('prod_posting_group_code = ?'); binds.push(b.prod_posting_group_code ?? null) }
  if ('inv_posting_group_code'  in b) { sets.push('inv_posting_group_code = ?');  binds.push(b.inv_posting_group_code  ?? null) }
  if ('standard_cost'           in b) { sets.push('standard_cost = ?');           binds.push(b.standard_cost ?? null) }
  if ('reorder_threshold'       in b) { sets.push('reorder_threshold = ?');       binds.push(b.reorder_threshold ?? null) }
  if ('name'                    in b) { sets.push('name = ?');                    binds.push(b.name) }
  if ('unit'                    in b) { sets.push('unit = ?');                    binds.push(b.unit) }

  if (sets.length === 0) return c.json({ success: false, error: 'لا توجد حقول للتحديث' }, 400)

  sets.push('updated_at = datetime(\'now\')')
  binds.push(company_id, code)

  const result = await c.env.DB.prepare(
    `UPDATE items SET ${sets.join(', ')} WHERE company_id = ? AND code = ?`
  ).bind(...binds).run()

  if (!result.meta.changes) return c.json({ success: false, error: 'الصنف غير موجود' }, 404)

  return c.json({ success: true })
})

// ── GET /posting-health ──────────────────────────────────────────────────────
// Returns matrix of warehouse×PPG combinations with movement history
// and whether each has a posting setup entry

governance.get('/posting-health', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  // All unique warehouse × PPG combos that have actual movements
  const { results: combos } = await c.env.DB.prepare(
    `SELECT
       im.warehouse,
       w.inv_posting_group_code AS ipg,
       i.prod_posting_group_code AS ppg,
       COUNT(*) AS movement_count,
       SUM(im.value_in + im.value_out) AS total_value
     FROM inventory_movements im
     LEFT JOIN warehouses w ON w.company_id = im.company_id AND w.name = im.warehouse AND w.is_active = 1
     LEFT JOIN items i ON i.company_id = im.company_id AND i.code = im.item_code
     WHERE im.company_id = ?
     GROUP BY im.warehouse, w.inv_posting_group_code, i.prod_posting_group_code
     ORDER BY total_value DESC`
  ).bind(company_id).all<{
    warehouse: string
    ipg: string | null
    ppg: string | null
    movement_count: number
    total_value: number
  }>()

  // All posting setup rows
  const { results: setupRows } = await c.env.DB.prepare(
    `SELECT inv_posting_group_code, prod_posting_group_code,
            inventory_account, purchases_account, cogs_account
       FROM posting_rules
     WHERE company_id = ? AND rule_type = 'inventory' AND is_active = 1`
  ).bind(company_id).all<{
    inv_posting_group_code: string | null
    prod_posting_group_code: string | null
    inventory_account: string | null
    purchases_account: string | null
    cogs_account: string | null
  }>()

  // For each combo, determine if covered
  const health = combos.map(combo => {
    const covered = setupRows.some(s => {
      const ipgMatch = s.inv_posting_group_code === null || s.inv_posting_group_code === combo.ipg
      const ppgMatch = s.prod_posting_group_code === null || s.prod_posting_group_code === combo.ppg
      return ipgMatch && ppgMatch
    })
    const exactRow = setupRows.find(s =>
      s.inv_posting_group_code === combo.ipg &&
      s.prod_posting_group_code === combo.ppg
    )
    const gaps: string[] = []
    if (!combo.ipg) gaps.push('المخزن بدون IPG')
    if (!combo.ppg) gaps.push('الصنف بدون PPG')
    if (!exactRow?.inventory_account) gaps.push('حساب المخزون مفقود')
    if (!exactRow?.purchases_account) gaps.push('حساب المشتريات مفقود')
    if (!exactRow?.cogs_account)      gaps.push('حساب COGS مفقود')

    return {
      ...combo,
      has_exact_setup: !!exactRow,
      has_fallback_setup: covered && !exactRow,
      is_covered: covered,
      gaps,
    }
  })

  const totalCombos   = health.length
  const coveredCount  = health.filter(h => h.is_covered).length
  const exactCount    = health.filter(h => h.has_exact_setup).length
  const gapCount      = health.filter(h => !h.is_covered).length

  return c.json({
    success: true,
    data: health,
    summary: {
      total_combos:   totalCombos,
      covered:        coveredCount,
      exact_setup:    exactCount,
      missing_setup:  gapCount,
      health_pct:     totalCombos > 0 ? Math.round((coveredCount / totalCombos) * 100) : 100,
    },
  })
})

// ── GET /health-summary ─────────────────────────────────────────────────────
// ERP cockpit summary for inventory+finance linkage and inventory data risks.

governance.get('/health-summary', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const [
    movementRow,
    combosRow,
    setupRows,
    itemRiskRow,
    reorderRow,
    negativeRow,
  ] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total_movements,
         SUM(CASE WHEN journal_entry_id IS NULL THEN 1 ELSE 0 END) AS unlinked_total,
         SUM(CASE WHEN journal_entry_id IS NULL AND (COALESCE(value_in, 0) + COALESCE(value_out, 0)) > 0 THEN 1 ELSE 0 END) AS unlinked_non_zero,
         SUM(CASE WHEN journal_entry_id IS NULL AND (COALESCE(value_in, 0) + COALESCE(value_out, 0)) = 0 THEN 1 ELSE 0 END) AS unlinked_zero
       FROM inventory_movements
       WHERE company_id = ?`
    ).bind(company_id).first<{
      total_movements: number
      unlinked_total: number
      unlinked_non_zero: number
      unlinked_zero: number
    }>(),

    c.env.DB.prepare(
      `SELECT
         im.warehouse,
         w.inv_posting_group_code AS ipg,
         i.prod_posting_group_code AS ppg
       FROM inventory_movements im
       LEFT JOIN warehouses w ON w.company_id = im.company_id AND w.name = im.warehouse AND w.is_active = 1
       LEFT JOIN items i ON i.company_id = im.company_id AND i.code = im.item_code
       WHERE im.company_id = ?
       GROUP BY im.warehouse, w.inv_posting_group_code, i.prod_posting_group_code`
    ).bind(company_id).all<{
      warehouse: string
      ipg: string | null
      ppg: string | null
    }>(),

    c.env.DB.prepare(
      `SELECT inv_posting_group_code, prod_posting_group_code
       FROM posting_rules
       WHERE company_id = ? AND rule_type = 'inventory' AND is_active = 1`
    ).bind(company_id).all<{
      inv_posting_group_code: string | null
      prod_posting_group_code: string | null
    }>(),

    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS active_items,
         SUM(CASE WHEN COALESCE(standard_cost, 0) <= 0 THEN 1 ELSE 0 END) AS items_without_standard_cost,
         SUM(CASE WHEN prod_posting_group_code IS NULL OR TRIM(prod_posting_group_code) = '' THEN 1 ELSE 0 END) AS items_without_ppg,
         SUM(CASE WHEN inv_posting_group_code IS NULL OR TRIM(inv_posting_group_code) = '' THEN 1 ELSE 0 END) AS items_without_ipg,
         SUM(CASE WHEN reorder_threshold IS NULL OR reorder_threshold <= 0 THEN 1 ELSE 0 END) AS items_without_reorder_threshold
       FROM items
       WHERE company_id = ? AND is_active = 1`
    ).bind(company_id).first<{
      active_items: number
      items_without_standard_cost: number
      items_without_ppg: number
      items_without_ipg: number
      items_without_reorder_threshold: number
    }>(),

    c.env.DB.prepare(
      `WITH latest_wh AS (
         SELECT item_code, warehouse, balance_qty
         FROM inventory_movements
         WHERE company_id = ?
           AND id IN (
             SELECT MAX(id)
             FROM inventory_movements
             WHERE company_id = ?
             GROUP BY item_code, warehouse
           )
       ), agg AS (
         SELECT item_code, SUM(balance_qty) AS total_qty
         FROM latest_wh
         GROUP BY item_code
       )
       SELECT COUNT(*) AS below_reorder_count
       FROM items i
       LEFT JOIN agg a ON a.item_code = i.code
       WHERE i.company_id = ?
         AND i.is_active = 1
         AND COALESCE(i.reorder_threshold, 0) > 0
         AND COALESCE(a.total_qty, 0) <= i.reorder_threshold`
    ).bind(company_id, company_id, company_id).first<{ below_reorder_count: number }>(),

    c.env.DB.prepare(
      `WITH latest_wh AS (
         SELECT item_code, warehouse, balance_qty
         FROM inventory_movements
         WHERE company_id = ?
           AND id IN (
             SELECT MAX(id)
             FROM inventory_movements
             WHERE company_id = ?
             GROUP BY item_code, warehouse
           )
       )
       SELECT
         COUNT(*) AS negative_balance_rows,
         COUNT(DISTINCT item_code) AS negative_balance_items
       FROM latest_wh
       WHERE balance_qty < 0`
    ).bind(company_id, company_id).first<{ negative_balance_rows: number; negative_balance_items: number }>(),
  ])

  const combos = combosRow.results
  const setups = setupRows.results
  const coveredCount = combos.filter(combo =>
    setups.some(s => {
      const ipgMatch = s.inv_posting_group_code === null || s.inv_posting_group_code === combo.ipg
      const ppgMatch = s.prod_posting_group_code === null || s.prod_posting_group_code === combo.ppg
      return ipgMatch && ppgMatch
    })
  ).length

  const totalCombos = combos.length
  const missingSetup = totalCombos - coveredCount
  const healthPct = totalCombos > 0 ? Math.round((coveredCount / totalCombos) * 100) : 100

  return c.json({
    success: true,
    data: {
      movement: {
        total: movementRow?.total_movements ?? 0,
        unlinked_total: movementRow?.unlinked_total ?? 0,
        unlinked_non_zero: movementRow?.unlinked_non_zero ?? 0,
        unlinked_zero: movementRow?.unlinked_zero ?? 0,
      },
      posting: {
        total_combos: totalCombos,
        covered: coveredCount,
        missing_setup: missingSetup,
        health_pct: healthPct,
      },
      item_risk: {
        active_items: itemRiskRow?.active_items ?? 0,
        items_without_standard_cost: itemRiskRow?.items_without_standard_cost ?? 0,
        items_without_ppg: itemRiskRow?.items_without_ppg ?? 0,
        items_without_ipg: itemRiskRow?.items_without_ipg ?? 0,
        items_without_reorder_threshold: itemRiskRow?.items_without_reorder_threshold ?? 0,
        below_reorder_count: reorderRow?.below_reorder_count ?? 0,
      },
      stock_risk: {
        negative_balance_rows: negativeRow?.negative_balance_rows ?? 0,
        negative_balance_items: negativeRow?.negative_balance_items ?? 0,
      },
      generated_at: new Date().toISOString(),
    },
  })
})

// ── GET /posting-controls ──────────────────────────────────────────────────

governance.get('/posting-controls', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const controls = await getInventoryPostingControls(c.env.DB, company_id)
  return c.json({ success: true, data: controls })
})

// ── PATCH /posting-controls ────────────────────────────────────────────────

governance.patch('/posting-controls', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id } = getUser(c)
  const b = await c.req.json<{
    posting_mode?: 'strict_sync' | 'async_reliable' | 'decoupled'
    zero_value_reason_required?: boolean
    zero_value_approval_roles?: string[]
    locked_through_date?: string | null
  }>()

  const current = await getInventoryPostingControls(c.env.DB, company_id)
  const postingMode = b.posting_mode ?? current.posting_mode
  const zeroReasonRequired = b.zero_value_reason_required ?? Boolean(current.zero_value_require_reason)
  const approvalRoles = b.zero_value_approval_roles ?? String(current.zero_value_approval_roles || '').split(',').map(s => s.trim()).filter(Boolean)
  const lockedThroughDate = Object.prototype.hasOwnProperty.call(b, 'locked_through_date')
    ? b.locked_through_date
    : current.locked_through_date

  await c.env.DB.prepare(
    `INSERT INTO inventory_posting_controls (
       company_id, posting_mode, zero_value_require_reason, zero_value_approval_roles, locked_through_date, updated_at
     ) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(company_id) DO UPDATE SET
       posting_mode = excluded.posting_mode,
       zero_value_require_reason = excluded.zero_value_require_reason,
       zero_value_approval_roles = excluded.zero_value_approval_roles,
       locked_through_date = excluded.locked_through_date,
       updated_at = datetime('now')`
  ).bind(
    company_id,
    postingMode,
    zeroReasonRequired ? 1 : 0,
    approvalRoles.join(','),
    lockedThroughDate ?? null,
  ).run()

  const updated = await getInventoryPostingControls(c.env.DB, company_id)
  return c.json({ success: true, data: updated })
})

// ── POST /posting-outbox/process ───────────────────────────────────────────

governance.post('/posting-outbox/process', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id } = getUser(c)
  const b: { limit?: number } = await c.req.json<{ limit?: number }>().catch(() => ({}))
  const limit = Math.min(Math.max(Number(b.limit ?? 50), 1), 200)

  const { results: jobs } = await c.env.DB.prepare(
    `SELECT id, event_type, movement_id, payload_json, attempts
     FROM inventory_posting_outbox
     WHERE company_id = ? AND status IN ('pending', 'processing')
     ORDER BY id ASC
     LIMIT ?`
  ).bind(company_id, limit).all<{
    id: number
    event_type: string
    movement_id: number
    payload_json: string
    attempts: number
  }>()

  let posted = 0
  let failed = 0

  for (const job of jobs) {
    await c.env.DB.prepare(
      `UPDATE inventory_posting_outbox SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND company_id = ?`
    ).bind(job.id, company_id).run()

    try {
      const payload = JSON.parse(job.payload_json || '{}')
      let jeId: number | null = null

      if (job.event_type === 'inventory_movement') {
        jeId = await FinanceCore.resolveInventoryMovement(c.env.DB, payload)
      } else if (job.event_type === 'inventory_transfer') {
        jeId = await FinanceCore.resolveInventoryTransfer(c.env.DB, payload)
      } else {
        throw new Error(`Unsupported event_type: ${job.event_type}`)
      }

      await c.env.DB.prepare(
        `UPDATE inventory_posting_outbox
         SET status = 'done', processed_at = datetime('now'), last_error = NULL, updated_at = datetime('now')
         WHERE id = ? AND company_id = ?`
      ).bind(job.id, company_id).run()

      await c.env.DB.prepare(
        `UPDATE inventory_movements
         SET gl_posting_status = 'posted', gl_posted_at = datetime('now'), gl_posting_error = NULL, journal_entry_id = COALESCE(?, journal_entry_id)
         WHERE id = ? AND company_id = ?`
      ).bind(jeId, job.movement_id, company_id).run()

      const targetMovementId = Number(payload?.target_movement_id ?? 0)
      if (targetMovementId > 0) {
        await c.env.DB.prepare(
          `UPDATE inventory_movements
           SET gl_posting_status = 'posted', gl_posted_at = datetime('now'), gl_posting_error = NULL, journal_entry_id = COALESCE(?, journal_entry_id)
           WHERE id = ? AND company_id = ?`
        ).bind(jeId, targetMovementId, company_id).run()
      }

      posted++
    } catch (err: any) {
      failed++
      const nextRetry = (job.attempts ?? 0) + 1
      const nextStatus = nextRetry >= 10 ? 'failed' : 'pending'
      const errMsg = String(err?.message ?? err)

      await c.env.DB.prepare(
        `UPDATE inventory_posting_outbox
        SET status = ?, attempts = ?, last_error = ?, updated_at = datetime('now')
         WHERE id = ? AND company_id = ?`
      ).bind(nextStatus, nextRetry, errMsg, job.id, company_id).run()

      await c.env.DB.prepare(
        `UPDATE inventory_movements
         SET gl_posting_status = ?, gl_posting_error = ?
         WHERE id = ? AND company_id = ?`
      ).bind(nextStatus === 'failed' ? 'failed' : 'pending', errMsg, job.movement_id, company_id).run()
    }
  }

  return c.json({
    success: true,
    data: {
      scanned: jobs.length,
      posted,
      failed,
    },
  })
})

export default governance
