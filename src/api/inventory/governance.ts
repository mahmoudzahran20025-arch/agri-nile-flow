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
import { getInventoryPostingControls } from '../../lib/inventory_posting'
import { processInventoryPostingOutbox } from '../../lib/process_outbox'
import { resolveMovementDirection } from '../../lib/posting_engine'

const governance = new Hono<{ Bindings: Env }>()

// ── POST /gl-preview ────────────────────────────────────────────────────────
// Returns a preview of the GL journal entry that would be generated
// for a proposed inventory movement. No writes.

governance.post('/gl-preview', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const b = await c.req.json<{
    warehouse:      string
    item_code:      number
    movement_type:  string
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
    'SELECT name, unit, prod_posting_group_code FROM items WHERE company_id = ? AND code = ?'
  ).bind(company_id, b.item_code).first<{
    name: string; unit: string | null
    prod_posting_group_code: string | null
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

  // 4. Compute effective unit price from inventory_balances snapshot (authoritative).
  // Do NOT read balance_qty from inventory_movements — it is a stale running total
  // that becomes incorrect after any dedup or retroactive insert.
  const lastRow = await c.env.DB.prepare(
    `SELECT ib.balance_qty, ib.balance_value
     FROM inventory_balances ib
     LEFT JOIN warehouses w ON w.id = ib.warehouse_id AND w.company_id = ib.company_id
     WHERE ib.company_id = ? AND ib.item_code = ? AND w.name = ?`
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

  const warnings: string[] = []
  if (!setup) warnings.push(`لا يوجد إعداد ترحيل للتوليفة (${ipg ?? 'ANY'} × ${ppg ?? 'ANY'})`)
  if (!ipg)   warnings.push(`المخزن "${b.warehouse}" لا يملك مجموعة ترحيل مخزون (IPG)`)
  if (!ppg)   warnings.push(`الصنف "${item.name}" لا يملك مجموعة ترحيل منتج (PPG)`)

  const invAcc  = setup?.inventory_account
  const cogsAcc = setup?.cogs_account
  if (!invAcc) warnings.push('حساب المخزون غير محدد في إعداد الترحيل — لا يمكن توليد معاينة القيد')
  if (!cogsAcc) warnings.push('حساب تكلفة المبيعات (COGS) غير محدد في إعداد الترحيل')

  const supplierRow = await c.env.DB.prepare(
    `SELECT account_code FROM posting_rules WHERE company_id = ? AND rule_type = 'control'
     AND mapping_key IN ('accounts_payable', 'supplier_payable') AND is_active = 1 ORDER BY priority DESC LIMIT 1`
  ).bind(company_id).first<{ account_code: string }>()
  const supplierAcc = supplierRow?.account_code
  if (!supplierAcc) warnings.push('حساب الدائنين (ذمم الموردين) غير محدد في قواعد الترحيل')

  const cashRow2 = await c.env.DB.prepare(
    `SELECT account_code FROM posting_rules WHERE company_id = ? AND rule_type = 'control'
     AND mapping_key IN ('cash', 'cash_default') AND is_active = 1 ORDER BY priority DESC LIMIT 1`
  ).bind(company_id).first<{ account_code: string }>()
  const cashAcc = cashRow2?.account_code
  if (b.payment_method === 'cash' && !cashAcc) warnings.push('حساب النقدية غير محدد في قواعد الترحيل')

  // Return early if critical accounts are missing — preview can't be built
  if (!invAcc) {
    return c.json({
      success: true,
      data: {
        item_name: item.name, item_unit: item.unit, ipg, ppg,
        unit_price: unitPrice, value, lines: [], is_balanced: false, warnings,
      },
    })
  }

  const isInbound = resolveMovementDirection(b.movement_type) === 'IN'

  if (isInbound) {
    lines.push({ side: 'DR', account_code: invAcc,   account_label: 'أصول - المخزون',       amount: value, narration: `استلام ${item.name} - ${b.warehouse}` })
    if (b.payment_method === 'cash') {
      if (cashAcc) lines.push({ side: 'CR', account_code: cashAcc,     account_label: 'صندوق النقدية',       amount: value, narration: `دفع نقدي لـ ${item.name}` })
    } else {
      if (supplierAcc) lines.push({ side: 'CR', account_code: supplierAcc, account_label: 'دائنو الموردين', amount: value, narration: `ذمة مورد - ${item.name}` })
    }
  } else {
    if (cogsAcc) lines.push({ side: 'DR', account_code: cogsAcc, account_label: 'تكلفة المبيعات (COGS)', amount: value, narration: `صرف ${item.name} - ${b.warehouse}` })
    lines.push({ side: 'CR', account_code: invAcc, account_label: 'أصول - المخزون', amount: value, narration: `إخراج مخزون ${item.name}` })
  }

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
// Paginated items list with accounting fields + balance totals from snapshot.
// Query params: page (default 1), size (default 50, max 200), search, filter_status, catalog_status
// filter_status: 'all' | 'missing_ppg' | 'missing_ipg' | 'below_reorder'
// catalog_status: 'all' | 'catalog_only' | 'moved_zero_balance' | 'in_stock'

governance.get('/items-master', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const page           = Math.max(1, Number(c.req.query('page') ?? 1))
  const size           = Math.min(200, Math.max(1, Number(c.req.query('size') ?? 50)))
  const search         = (c.req.query('search') ?? '').trim()
  const filterStatus   = c.req.query('filter_status') ?? 'all'
  const catalogStatus  = c.req.query('catalog_status') ?? 'all'
  const offset         = (page - 1) * size

  const conditions: string[] = ['i.company_id = ?']
  const binds: unknown[] = [company_id]

  if (search) {
    conditions.push(`(i.name LIKE ? OR CAST(i.code AS TEXT) LIKE ?)`)
    binds.push(`%${search}%`, `%${search}%`)
  }

  if (filterStatus === 'missing_ppg') {
    conditions.push(`i.prod_posting_group_code IS NULL`)
  } else if (filterStatus === 'below_reorder') {
    conditions.push(`COALESCE(ms.balance_qty, 0) < COALESCE(i.reorder_threshold, 0) AND COALESCE(i.reorder_threshold, 0) > 0`)
  }

  if (catalogStatus !== 'all') {
    conditions.push(`CASE
      WHEN COALESCE(ms.balance_qty, 0) > 0 THEN 'in_stock'
      WHEN COALESCE(ms.movement_count, 0) > 0 THEN 'moved_zero_balance'
      ELSE 'catalog_only'
    END = ?`)
    binds.push(catalogStatus)
  }

  const where = conditions.join(' AND ')

  const countRow = await c.env.DB.prepare(
    `WITH movement_stats AS (
       SELECT
         company_id,
         item_code,
         COUNT(*) AS movement_count,
         SUM(COALESCE(qty_in, 0)) AS total_in,
         SUM(COALESCE(qty_out, 0)) AS total_out,
         SUM(COALESCE(qty_in, 0) - COALESCE(qty_out, 0)) AS balance_qty,
         SUM(COALESCE(value_in, 0) - COALESCE(value_out, 0)) AS balance_value
       FROM inventory_movements
       WHERE item_code IS NOT NULL
       GROUP BY company_id, item_code
     )
     SELECT COUNT(*) AS total
     FROM items i
     LEFT JOIN movement_stats ms
       ON ms.company_id = i.company_id
      AND ms.item_code = i.code
     WHERE ${where}`
  ).bind(...binds).first<{ total: number }>()

  const total = countRow?.total ?? 0

  const { results } = await c.env.DB.prepare(
    `WITH movement_stats AS (
       SELECT
         company_id,
         item_code,
         COUNT(*) AS movement_count,
         SUM(COALESCE(qty_in, 0)) AS total_in,
         SUM(COALESCE(qty_out, 0)) AS total_out,
         SUM(COALESCE(qty_in, 0) - COALESCE(qty_out, 0)) AS balance_qty,
         SUM(COALESCE(value_in, 0) - COALESCE(value_out, 0)) AS balance_value
       FROM inventory_movements
       WHERE item_code IS NOT NULL
       GROUP BY company_id, item_code
     ), warehouse_stats AS (
       SELECT company_id, item_code, COUNT(*) AS warehouse_count
       FROM (
         SELECT DISTINCT company_id, item_code, warehouse_id
         FROM inventory_movements
         WHERE item_code IS NOT NULL AND warehouse_id IS NOT NULL
       )
       GROUP BY company_id, item_code
     )
     SELECT
       i.code,
       i.name,
       i.unit,
       i.base_unit,
       i.package_type,
       i.package_capacity,
       i.category_id,
       i.prod_posting_group_code,
       i.inv_posting_group_code,
       i.standard_cost,
       i.reorder_threshold,
       i.item_type,
       i.is_sellable,
       i.is_purchasable,
       i.list_price,
       i.barcode,
       i.expiry_tracking,
       i.wip_cost_category,
       ic.name AS category_name,
       COALESCE(ms.balance_qty, 0) AS total_qty,
       COALESCE(ms.balance_value, 0) AS total_value,
       COALESCE(ws.warehouse_count, 0) AS warehouse_count,
       CASE
         WHEN COALESCE(ms.balance_qty, 0) > 0 THEN 'in_stock'
         WHEN COALESCE(ms.movement_count, 0) > 0 THEN 'moved_zero_balance'
         ELSE 'catalog_only'
       END AS catalog_status,
       COALESCE(ms.movement_count, 0) AS movement_count
     FROM items i
     LEFT JOIN item_categories ic
       ON ic.company_id = i.company_id
      AND ic.id = i.category_id
     LEFT JOIN movement_stats ms
       ON ms.company_id = i.company_id
      AND ms.item_code = i.code
     LEFT JOIN warehouse_stats ws
       ON ws.company_id = i.company_id
      AND ws.item_code = i.code
     WHERE ${where}
     ORDER BY i.name
     LIMIT ? OFFSET ?`
  ).bind(...binds, size, offset).all()

  return c.json({
    success: true,
    data: results,
    total,
    page,
    page_size: size,
    page_count: Math.ceil(total / size),
  })
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
    costing_method?:          'moving_average' | 'standard' | 'fifo' | null
    track_lots?:              boolean | null
    cogs_account_override?:   string | null
    name?:                    string
    unit?:                    string
    base_unit?:               string | null
    package_type?:            string | null
    package_capacity?:        number | null
    item_type?:               'inventory' | 'service' | 'non_stock' | null
    is_sellable?:             boolean | null
    is_purchasable?:          boolean | null
    list_price?:              number | null
    barcode?:                 string | null
    expiry_tracking?:         boolean | null
    wip_cost_category?:       string | null
  }>()

  const VALID_COSTING = ['moving_average', 'standard', 'fifo']
  if (b.costing_method != null && !VALID_COSTING.includes(b.costing_method)) {
    return c.json({ success: false, error: 'طريقة التكلفة غير صالحة' }, 400)
  }
  const VALID_ITEM_TYPES = ['inventory', 'service', 'non_stock']
  if (b.item_type != null && !VALID_ITEM_TYPES.includes(b.item_type)) {
    return c.json({ success: false, error: 'نوع الصنف غير صالح' }, 400)
  }

  // Build SET clause dynamically
  const sets: string[] = []
  const binds: unknown[] = []

  if ('prod_posting_group_code' in b) { sets.push('prod_posting_group_code = ?'); binds.push(b.prod_posting_group_code ?? null) }
  if ('inv_posting_group_code'  in b) { sets.push('inv_posting_group_code = ?');  binds.push(b.inv_posting_group_code  ?? null) }
  if ('standard_cost'           in b) { sets.push('standard_cost = ?');           binds.push(b.standard_cost ?? null) }
  if ('reorder_threshold'       in b) { sets.push('reorder_threshold = ?');       binds.push(b.reorder_threshold ?? null) }
  if ('costing_method'          in b) { sets.push('costing_method = ?');          binds.push(b.costing_method ?? null) }
  if ('track_lots'              in b) { sets.push('track_lots = ?');              binds.push(b.track_lots ? 1 : 0) }
  if ('cogs_account_override'   in b) { sets.push('cogs_account_override = ?');   binds.push(b.cogs_account_override ?? null) }
  if ('name'                    in b) { sets.push('name = ?');                    binds.push(b.name) }
  if ('unit'                    in b) { sets.push('unit = ?');                    binds.push(b.unit) }
  if ('base_unit'               in b) { sets.push('base_unit = ?');               binds.push(b.base_unit ?? null) }
  if ('package_type'            in b) { sets.push('package_type = ?');            binds.push(b.package_type ?? null) }
  if ('package_capacity'        in b) { sets.push('package_capacity = ?');        binds.push(b.package_capacity ?? null) }
  if ('item_type'               in b) { sets.push('item_type = ?');               binds.push(b.item_type ?? 'inventory') }
  if ('is_sellable'             in b) { sets.push('is_sellable = ?');             binds.push(b.is_sellable ? 1 : 0) }
  if ('is_purchasable'          in b) { sets.push('is_purchasable = ?');          binds.push(b.is_purchasable ? 1 : 0) }
  if ('list_price'              in b) { sets.push('list_price = ?');              binds.push(b.list_price ?? null) }
  if ('barcode'                 in b) { sets.push('barcode = ?');                 binds.push(b.barcode?.trim() || null) }
  if ('expiry_tracking'         in b) { sets.push('expiry_tracking = ?');         binds.push(b.expiry_tracking ? 1 : 0) }
  if ('wip_cost_category'       in b) { sets.push('wip_cost_category = ?');       binds.push(b.wip_cost_category ?? null) }

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
       im.warehouse_id,
       w.name AS warehouse_name,
       w.inv_posting_group_code AS ipg,
       i.prod_posting_group_code AS ppg,
       COUNT(*) AS movement_count,
       SUM(im.value_in + im.value_out) AS total_value
     FROM inventory_movements im
     LEFT JOIN warehouses w ON w.id = im.warehouse_id AND w.company_id = im.company_id
     LEFT JOIN items i ON i.code = im.item_code AND i.company_id = im.company_id
     WHERE im.company_id = ?
     GROUP BY im.warehouse_id, w.name, w.inv_posting_group_code, i.prod_posting_group_code
     ORDER BY total_value DESC`
  ).bind(company_id).all<{
    warehouse_id: number
    warehouse_name: string
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
      warehouse: combo.warehouse_name, // maintain compatibility with UI
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
         w.name AS warehouse,
         w.inv_posting_group_code AS ipg,
         i.prod_posting_group_code AS ppg
       FROM inventory_movements im
       LEFT JOIN warehouses w ON w.id = im.warehouse_id AND w.company_id = im.company_id
       LEFT JOIN items i ON i.company_id = im.company_id AND i.code = im.item_code
       WHERE im.company_id = ?
       GROUP BY im.warehouse_id, w.name, w.inv_posting_group_code, i.prod_posting_group_code`
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
         0 AS items_without_ipg,
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
         SELECT item_code, warehouse_id, balance_qty
         FROM inventory_movements
         WHERE company_id = ?
           AND id IN (
             SELECT MAX(id)
             FROM inventory_movements
             WHERE company_id = ?
             GROUP BY item_code, warehouse_id
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
         SELECT item_code, warehouse_id, balance_qty
         FROM inventory_movements
         WHERE company_id = ?
           AND id IN (
             SELECT MAX(id)
             FROM inventory_movements
             WHERE company_id = ?
             GROUP BY item_code, warehouse_id
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

  const result = await processInventoryPostingOutbox(c.env.DB, company_id, limit)

  return c.json({ success: true, data: result })
})

// ── GET /gl-trace ───────────────────────────────────────────────────────────
// Returns movements with GL traceability gaps:
//   - ghost_posted : gl_posting_status = 'posted' but journal_entry_id IS NULL
//   - pending      : not yet posted (normal for async_reliable mode)
//   - failed       : posting failed and is awaiting retry
//   - exempt       : zero-value movements that are intentionally not posted
//
// Also returns a summary count per status for dashboard use.
// Accepts ?status= filter (ghost_posted | pending | failed | exempt | all)
// and ?limit= (default 100, max 500).

governance.get('/gl-trace', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)
  const statusFilter = (c.req.query('status') ?? 'all') as string
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100), 1), 500)

  // Summary counts across all statuses
  const { results: counts } = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN gl_posting_status = 'posted'            AND journal_entry_id IS NULL THEN 1 ELSE 0 END) AS ghost_posted,
       SUM(CASE WHEN gl_posting_status = 'pending'                                        THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN gl_posting_status = 'failed'                                         THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN gl_posting_status = 'exempt_zero_value'                              THEN 1 ELSE 0 END) AS exempt,
       SUM(CASE WHEN gl_posting_status = 'posted'            AND journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS clean_posted,
       COUNT(*) AS total
     FROM inventory_movements
     WHERE company_id = ?`
  ).bind(company_id).all<{
    ghost_posted: number; pending: number; failed: number
    exempt: number; clean_posted: number; total: number
  }>()

  const summary = counts[0] ?? { ghost_posted: 0, pending: 0, failed: 0, exempt: 0, clean_posted: 0, total: 0 }

  // Build WHERE clause for the detail rows
  let whereClause: string
  switch (statusFilter) {
    case 'ghost_posted': whereClause = `gl_posting_status = 'posted' AND journal_entry_id IS NULL`; break
    case 'pending':      whereClause = `gl_posting_status = 'pending'`; break
    case 'failed':       whereClause = `gl_posting_status = 'failed'`; break
    case 'exempt':       whereClause = `gl_posting_status = 'exempt_zero_value'`; break
    default:             whereClause = `gl_posting_status != 'posted' OR journal_entry_id IS NULL`
  }

  const { results: rows } = await c.env.DB.prepare(
    `SELECT
       m.id,
       m.movement_date,
       w.name                AS warehouse,
       m.movement_type,
       m.item_code,
       i.name                AS item_name,
       m.quantity,
       m.unit_price,
       m.value_in,
       m.value_out,
       m.gl_posting_status,
       m.journal_entry_id,
       m.gl_posting_error,
       m.gl_posted_at,
       m.transaction_id,
       m.document_number,
       m.supplier_code,
       m.zero_value_reason,
       ob.status             AS outbox_status,
       ob.attempts           AS outbox_attempts,
       ob.last_error         AS outbox_last_error,
       ob.updated_at         AS outbox_updated_at,
       je.entry_number       AS je_number,
       je.entry_date         AS je_date,
       je.description        AS je_description
     FROM inventory_movements m
     LEFT JOIN warehouses w ON w.id = m.warehouse_id AND w.company_id = m.company_id
     LEFT JOIN items i  ON i.company_id = m.company_id AND i.code = m.item_code
     LEFT JOIN inventory_posting_outbox ob
       ON ob.movement_id = m.id AND ob.company_id = m.company_id
          AND ob.status NOT IN ('done')
     LEFT JOIN journal_entries je ON je.id = m.journal_entry_id AND je.company_id = m.company_id
     WHERE m.company_id = ? AND (${whereClause})
     ORDER BY m.movement_date DESC, m.id DESC
     LIMIT ?`
  ).bind(company_id, limit).all<{
    id: number; movement_date: string; warehouse: string; movement_type: string
    item_code: number; item_name: string | null; quantity: number; unit_price: number
    value_in: number; value_out: number; gl_posting_status: string
    journal_entry_id: number | null; gl_posting_error: string | null; gl_posted_at: string | null
    transaction_id: number | null; document_number: string | null; supplier_code: number | null
    zero_value_reason: string | null; outbox_status: string | null; outbox_attempts: number | null
    outbox_last_error: string | null; outbox_updated_at: string | null
    je_number: string | null; je_date: string | null; je_description: string | null
  }>()

  return c.json({
    success: true,
    data: {
      summary: {
        ghost_posted:  summary.ghost_posted,
        pending:       summary.pending,
        failed:        summary.failed,
        exempt:        summary.exempt,
        clean_posted:  summary.clean_posted,
        total:         summary.total,
        traceability_pct: summary.total > 0
          ? Math.round(100 * summary.clean_posted / summary.total)
          : 100,
      },
      filter: statusFilter,
      rows,
    },
  })
})

// ── POST /gl-trace/:id/resolve ───────────────────────────────────────────────
// Resolve a single GL trace anomaly:
//   action='exempt'  → mark as exempt_zero_value (zero-value ghost movements)
//   action='retry'   → force-enqueue in outbox for re-posting (non-zero ghosts/failed)

governance.post('/gl-trace/:id/resolve', permissionGuard('inventory', 'create'), async (c) => {
  const { company_id } = getUser(c)
  const movId  = Number(c.req.param('id'))
  const body   = await c.req.json<{ action: 'exempt' | 'retry'; reason?: string }>().catch(() => ({ action: 'retry' as const }))

  if (!movId) return c.json({ success: false, error: 'movement id required' }, 400)

  const mov = await c.env.DB.prepare(
    `SELECT im.id, im.gl_posting_status, im.value_in, im.value_out, im.journal_entry_id,
            im.item_code, w.name AS warehouse, im.movement_type, im.movement_date,
            im.center_code, im.supplier_code, im.work_order_id, im.created_by_user_id
     FROM inventory_movements im
     LEFT JOIN warehouses w ON w.id = im.warehouse_id AND w.company_id = im.company_id
     WHERE im.company_id = ? AND im.id = ?`
  ).bind(company_id, movId).first<{
    id: number; gl_posting_status: string
    value_in: number; value_out: number; journal_entry_id: number | null
    item_code: number; warehouse: string; movement_type: string; movement_date: string
    center_code: number | null; supplier_code: number | null
    work_order_id: number | null; created_by_user_id: number | null
  }>()

  if (!mov) return c.json({ success: false, error: 'movement not found' }, 404)

  const totalValue = (mov.value_in ?? 0) + (mov.value_out ?? 0)

  if (body.action === 'exempt') {
    if (totalValue > 0) {
      return c.json({ success: false, error: 'cannot exempt a non-zero-value movement' }, 400)
    }
    await c.env.DB.prepare(
      `UPDATE inventory_movements
       SET gl_posting_status = 'exempt_zero_value',
           zero_value_reason  = COALESCE(?, zero_value_reason),
           gl_posting_error   = NULL
       WHERE company_id = ? AND id = ?
         AND (gl_posting_status = 'posted' OR gl_posting_status = 'pending')`
    ).bind(body.reason ?? 'zero_value_auto_exempt', company_id, movId).run()

    return c.json({ success: true, action: 'exempt', movement_id: movId })
  }

  // action='retry' — enqueue in outbox with correct schema
  // The unique constraint is on (company_id, idempotency_key), not (company_id, movement_id).
  // We must include event_type (NOT NULL) and payload_json (NOT NULL) in the INSERT.
  // Use ON CONFLICT to reset failed/stuck rows so the cron worker picks them up again.
  const itemRow = await c.env.DB.prepare(
    `SELECT name FROM items WHERE code = ? AND company_id = ? LIMIT 1`
  ).bind(mov.item_code, company_id).first<{ name: string }>()

  const retryPayload = {
    company_id,
    ref_id:         movId,
    item_code:      mov.item_code,
    warehouse:      mov.warehouse,
    movement_type:  mov.movement_type,
    value:          (mov.value_in ?? 0) + (mov.value_out ?? 0),
    date:           mov.movement_date,
    item_name:      itemRow?.name ?? String(mov.item_code),
    created_by:     mov.created_by_user_id ?? undefined,
    center_code:    mov.center_code ?? undefined,
    supplier_code:  mov.supplier_code ?? undefined,
    work_order_id:  mov.work_order_id ?? undefined,
  }

  const idempotencyKey = `inventory_movement:${movId}`
  await c.env.DB.prepare(
    `INSERT INTO inventory_posting_outbox
       (company_id, event_type, movement_id, payload_json, status, attempts, idempotency_key, created_at, updated_at)
     VALUES (?, 'inventory_movement', ?, ?, 'pending', 0, ?, datetime('now'), datetime('now'))
     ON CONFLICT(company_id, idempotency_key) DO UPDATE SET
       status       = 'pending',
       attempts     = 0,
       last_error   = NULL,
       payload_json = excluded.payload_json,
       updated_at   = datetime('now')`
  ).bind(company_id, movId, JSON.stringify(retryPayload), idempotencyKey).run()

  return c.json({ success: true, action: 'retry', movement_id: movId, outbox: 'enqueued' })
})

// ── GET /service-types ──────────────────────────────────────────────────────
// Returns active service types for this company — used by frontend ISSUE form
governance.get('/service-types', permissionGuard('inventory', 'read'), async (c) => {
  const { company_id } = getUser(c)

  const tableCheck = await c.env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='service_types' LIMIT 1`
  ).first<{ name: string }>()

  if (!tableCheck) return c.json({ success: true, data: [] })

  const { results } = await c.env.DB.prepare(
    `SELECT code, name_ar, name_en, service_group, requires_center, requires_document
     FROM service_types WHERE company_id = ? AND is_active = 1 ORDER BY service_group, name_ar`
  ).bind(company_id).all<{
    code: string; name_ar: string; name_en: string | null
    service_group: string; requires_center: number; requires_document: number
  }>()

  return c.json({ success: true, data: results })
})

export default governance
