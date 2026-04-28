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

export default governance
