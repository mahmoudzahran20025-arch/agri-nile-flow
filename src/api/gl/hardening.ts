import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'
import { invalidateFlagCache } from '../../lib/hardening'
import type { HardeningFlagKey } from '../../lib/hardening'
import { clearPostingEngineCaches } from '../../lib/posting_engine'

const hardening = new Hono<{ Bindings: Env }>()
hardening.use('*', authMiddleware)

// Mutations (flag toggles, approvals) require admin; reads are open to finance roles
const adminOnly   = roleGuard(['super_admin', 'company_admin'])
const financeRead = roleGuard(['super_admin', 'company_admin', 'accountant'])

function parseJsonObject(input: string | null | undefined): Record<string, unknown> {
  if (!input) return {}
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

async function applyApprovedPostingRuleChange(
  db: Env['DB'],
  companyId: number,
  auditRecord: { rule_id: number; action: string; old_values: string | null; new_values: string | null },
): Promise<void> {
  const action = auditRecord.action.toUpperCase()
  const oldValues = parseJsonObject(auditRecord.old_values)
  const newValues = parseJsonObject(auditRecord.new_values)

  if (auditRecord.rule_id === 0) {
    return
  }

  if (action === 'INSERT') {
    await db.prepare(
      `INSERT INTO posting_rules
       (company_id, rule_type, bus_posting_group_code, prod_posting_group_code, inv_posting_group_code,
        mapping_key, account_code, sales_account, purchases_account, cogs_account,
        sales_returns_account, purch_returns_account, expense_account,
        inventory_account, wip_account, finished_goods_account,
        priority, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`
    ).bind(
      companyId,
      (newValues.rule_type as string) ?? 'general',
      (newValues.bus_posting_group_code as string) ?? null,
      (newValues.prod_posting_group_code as string) ?? null,
      (newValues.inv_posting_group_code as string) ?? null,
      (newValues.mapping_key as string) ?? null,
      (newValues.account_code as string) ?? null,
      (newValues.sales_account as string) ?? null,
      (newValues.purchases_account as string) ?? null,
      (newValues.cogs_account as string) ?? null,
      (newValues.sales_returns_account as string) ?? null,
      (newValues.purch_returns_account as string) ?? null,
      (newValues.expense_account as string) ?? null,
      (newValues.inventory_account as string) ?? null,
      (newValues.wip_account as string) ?? null,
      (newValues.finished_goods_account as string) ?? null,
      Number(newValues.priority ?? 100),
      Number(newValues.is_active ?? 1),
    ).run()
    return
  }

  if (action === 'DELETE') {
    await db.prepare(
      `UPDATE posting_rules
       SET is_active = 0, updated_at = datetime('now')
       WHERE id = ? AND company_id = ?`
    ).bind(auditRecord.rule_id, companyId).run()
    return
  }

  const allowedFields = [
    'bus_posting_group_code', 'prod_posting_group_code', 'inv_posting_group_code',
    'mapping_key', 'account_code',
    'sales_account', 'purchases_account', 'cogs_account',
    'sales_returns_account', 'purch_returns_account', 'expense_account',
    'inventory_account', 'wip_account', 'finished_goods_account',
    'priority', 'is_active',
  ] as const

  const sets: string[] = []
  const binds: unknown[] = []
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(newValues, field)) {
      sets.push(`${field} = ?`)
      binds.push((newValues[field] as unknown) ?? null)
    }
  }

  if (!sets.length && (action === 'ACTIVATE' || action === 'DEACTIVATE')) {
    const fallbackActive = action === 'ACTIVATE' ? 1 : 0
    const oldActive = Number(oldValues.is_active ?? fallbackActive)
    sets.push('is_active = ?')
    binds.push(Number(newValues.is_active ?? oldActive ?? fallbackActive))
  }

  if (!sets.length) {
    return
  }

  await db.prepare(
    `UPDATE posting_rules
     SET ${sets.join(', ')}, updated_at = datetime('now')
     WHERE id = ? AND company_id = ?`
  ).bind(...binds, auditRecord.rule_id, companyId).run()
}

// GET /api/gl/hardening/flags — read all flags for this company
hardening.get('/flags', financeRead, async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(
    `SELECT flag_key, flag_value, description, set_by, set_at, expires_at
     FROM hardening_flags
     WHERE company_id = ?
     ORDER BY flag_key`
  ).bind(company_id).all()

  return c.json({ success: true, data: results })
})

// PATCH /api/gl/hardening/flags/:key — toggle a flag (admin only, audited)
hardening.patch('/flags/:key', adminOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const key = c.req.param('key') as HardeningFlagKey

  const allowed: HardeningFlagKey[] = ['strict_posting_mode', 'catch_all_allowed', 'report_fallback_mode']
  if (!allowed.includes(key)) {
    return c.json({ success: false, error: `Unknown flag key: ${key}` }, 400)
  }

  const body = await c.req.json<{ value: 0 | 1; reason: string; expires_at?: string }>()
  if (body.value !== 0 && body.value !== 1) {
    return c.json({ success: false, error: 'value must be 0 or 1' }, 400)
  }
  if (!body.reason?.trim()) {
    return c.json({ success: false, error: 'reason is required for flag changes (audit trail)' }, 400)
  }

  // Read current value for audit log
  const current = await c.env.DB.prepare(
    'SELECT flag_value FROM hardening_flags WHERE company_id=? AND flag_key=?'
  ).bind(company_id, key).first<{ flag_value: number }>()

  await c.env.DB.prepare(
    `UPDATE hardening_flags
     SET flag_value=?, set_by=?, set_at=datetime('now'), expires_at=?
     WHERE company_id=? AND flag_key=?`
  ).bind(body.value, userId, body.expires_at ?? null, company_id, key).run()

  // Log to posting_rules_audit as a flag change record
  await c.env.DB.prepare(
    `INSERT INTO posting_rules_audit
     (company_id, rule_id, action, changed_by, changed_at, change_reason,
      approval_status, approved_by, approved_at, old_values, new_values)
     VALUES (?,0,'UPDATE',?,datetime('now'),?,'approved',?,datetime('now'),?,?)`
  ).bind(
    company_id, userId,
    `FLAG_CHANGE: ${key} — ${body.reason}`,
    userId,
    JSON.stringify({ flag_key: key, flag_value: current?.flag_value ?? null }),
    JSON.stringify({ flag_key: key, flag_value: body.value }),
  ).run()

  invalidateFlagCache(company_id, key)

  return c.json({ success: true, data: { key, old_value: current?.flag_value, new_value: body.value } })
})

// GET /api/gl/hardening/baseline — daily governance metrics snapshot
hardening.get('/baseline', financeRead, async (c) => {
  const { company_id } = getUser(c)

  const [postingSuccess, dimensionCompleteness, subledgerDrift, ruleHealth, flags, pendingAudit] = await Promise.all([
    // Posting success rate: linked / total business_events
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total_events,
         SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) AS linked,
         SUM(CASE WHEN journal_entry_id IS NULL THEN 1 ELSE 0 END) AS unlinked,
         SUM(CASE
               WHEN source_module = 'inventory'
                 THEN CASE
                        WHEN ABS(COALESCE(CAST(json_extract(payload, '$.value_in') AS REAL), 0)) > 0.0001
                          OR ABS(COALESCE(CAST(json_extract(payload, '$.value_out') AS REAL), 0)) > 0.0001
                          THEN 1 ELSE 0 END
               ELSE CASE
                      WHEN ABS(COALESCE(CAST(json_extract(payload, '$.amount') AS REAL), 0)) > 0.0001
                        OR ABS(COALESCE(CAST(json_extract(payload, '$.debit') AS REAL), 0)) > 0.0001
                        OR ABS(COALESCE(CAST(json_extract(payload, '$.credit') AS REAL), 0)) > 0.0001
                        THEN 1 ELSE 0 END
             END) AS material_total_events,
         SUM(CASE
               WHEN journal_entry_id IS NOT NULL AND source_module = 'inventory'
                 THEN CASE
                        WHEN ABS(COALESCE(CAST(json_extract(payload, '$.value_in') AS REAL), 0)) > 0.0001
                          OR ABS(COALESCE(CAST(json_extract(payload, '$.value_out') AS REAL), 0)) > 0.0001
                          THEN 1 ELSE 0 END
               WHEN journal_entry_id IS NOT NULL
                 THEN CASE
                        WHEN ABS(COALESCE(CAST(json_extract(payload, '$.amount') AS REAL), 0)) > 0.0001
                          OR ABS(COALESCE(CAST(json_extract(payload, '$.debit') AS REAL), 0)) > 0.0001
                          OR ABS(COALESCE(CAST(json_extract(payload, '$.credit') AS REAL), 0)) > 0.0001
                          THEN 1 ELSE 0 END
               ELSE 0
             END) AS material_linked,
         SUM(CASE
               WHEN journal_entry_id IS NULL AND source_module = 'inventory'
                 THEN CASE
                        WHEN ABS(COALESCE(CAST(json_extract(payload, '$.value_in') AS REAL), 0)) > 0.0001
                          OR ABS(COALESCE(CAST(json_extract(payload, '$.value_out') AS REAL), 0)) > 0.0001
                          THEN 1 ELSE 0 END
               WHEN journal_entry_id IS NULL
                 THEN CASE
                        WHEN ABS(COALESCE(CAST(json_extract(payload, '$.amount') AS REAL), 0)) > 0.0001
                          OR ABS(COALESCE(CAST(json_extract(payload, '$.debit') AS REAL), 0)) > 0.0001
                          OR ABS(COALESCE(CAST(json_extract(payload, '$.credit') AS REAL), 0)) > 0.0001
                          THEN 1 ELSE 0 END
               ELSE 0
             END) AS material_unlinked,
         ROUND(100.0 * SUM(CASE WHEN journal_entry_id IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS raw_success_rate_pct,
         ROUND(
           100.0 * SUM(CASE
                         WHEN journal_entry_id IS NOT NULL AND source_module = 'inventory'
                           THEN CASE
                                  WHEN ABS(COALESCE(CAST(json_extract(payload, '$.value_in') AS REAL), 0)) > 0.0001
                                    OR ABS(COALESCE(CAST(json_extract(payload, '$.value_out') AS REAL), 0)) > 0.0001
                                    THEN 1 ELSE 0 END
                         WHEN journal_entry_id IS NOT NULL
                           THEN CASE
                                  WHEN ABS(COALESCE(CAST(json_extract(payload, '$.amount') AS REAL), 0)) > 0.0001
                                    OR ABS(COALESCE(CAST(json_extract(payload, '$.debit') AS REAL), 0)) > 0.0001
                                    OR ABS(COALESCE(CAST(json_extract(payload, '$.credit') AS REAL), 0)) > 0.0001
                                    THEN 1 ELSE 0 END
                         ELSE 0
                       END)
           / NULLIF(
               SUM(CASE
                     WHEN source_module = 'inventory'
                       THEN CASE
                              WHEN ABS(COALESCE(CAST(json_extract(payload, '$.value_in') AS REAL), 0)) > 0.0001
                                OR ABS(COALESCE(CAST(json_extract(payload, '$.value_out') AS REAL), 0)) > 0.0001
                                THEN 1 ELSE 0 END
                     ELSE CASE
                            WHEN ABS(COALESCE(CAST(json_extract(payload, '$.amount') AS REAL), 0)) > 0.0001
                              OR ABS(COALESCE(CAST(json_extract(payload, '$.debit') AS REAL), 0)) > 0.0001
                              OR ABS(COALESCE(CAST(json_extract(payload, '$.credit') AS REAL), 0)) > 0.0001
                              THEN 1 ELSE 0 END
                   END),
               0
             ),
           2
         ) AS success_rate_pct
       FROM business_events
       WHERE company_id = ?`
    ).bind(company_id).first(),

    // Dimensional completeness: center_code coverage on posted supplier + inventory
    c.env.DB.prepare(
      `SELECT
         'supplier_transactions' AS source,
         COUNT(*) AS total,
         SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS has_center,
         SUM(CASE WHEN season_id IS NOT NULL THEN 1 ELSE 0 END) AS has_season
       FROM supplier_transactions
       WHERE company_id = ? AND status = 'posted'
       UNION ALL
       SELECT
         'inventory_movements',
         COUNT(*),
         SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END),
         SUM(CASE WHEN season_id IS NOT NULL THEN 1 ELSE 0 END)
       FROM inventory_movements
       WHERE company_id = ?`
    ).bind(company_id, company_id).all(),

    // Subledger drift: suppliers where stored balance diverges from computed
    c.env.DB.prepare(
      `SELECT COUNT(*) AS suppliers_with_drift
       FROM (
         SELECT s.code,
                COALESCE(SUM(st.credit),0) - COALESCE(SUM(st.debit),0) AS calc_balance,
                MAX(CASE WHEN st.id = (
                  SELECT MAX(id) FROM supplier_transactions
                  WHERE supplier_code = s.code AND company_id = s.company_id AND status='posted'
                ) THEN st.balance_no_checks END) AS stored_balance
         FROM suppliers s
         LEFT JOIN supplier_transactions st
           ON st.supplier_code = s.code AND st.company_id = s.company_id AND st.status = 'posted'
         WHERE s.company_id = ?
         GROUP BY s.code
         HAVING ABS(COALESCE(calc_balance,0) - COALESCE(stored_balance,0)) > 0.5
       )`
    ).bind(company_id).first(),

    // Rule health: active critical rules, catch-all count
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total_active_rules,
         SUM(CASE WHEN rule_type='general' AND bus_posting_group_code IS NULL AND prod_posting_group_code IS NULL THEN 1 ELSE 0 END) AS catchall_rules,
         SUM(CASE WHEN rule_type='control' AND mapping_key='accounts_payable' AND is_active=1 THEN 1 ELSE 0 END) AS ap_rule_active,
         SUM(CASE WHEN rule_type='control' AND mapping_key='accounts_payable' AND is_active=0 THEN 1 ELSE 0 END) AS ap_rule_inactive
       FROM posting_rules
       WHERE company_id = ? AND is_active = 1`
    ).bind(company_id).first(),

    // Current flag state
    c.env.DB.prepare(
      'SELECT flag_key, flag_value FROM hardening_flags WHERE company_id=? ORDER BY flag_key'
    ).bind(company_id).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS pending_count
       FROM posting_rules_audit
       WHERE company_id = ? AND approval_status = 'pending'`
    ).bind(company_id).first<{ pending_count: number }>(),
  ])

  const flagMap = Object.fromEntries(
    (flags.results as Array<{ flag_key: string; flag_value: number }>)
      .map(f => [f.flag_key, f.flag_value === 1])
  )

  const postingSuccessRate = Number((postingSuccess as { success_rate_pct?: number })?.success_rate_pct ?? 0)
  const driftSuppliers = Number((subledgerDrift as { suppliers_with_drift?: number })?.suppliers_with_drift ?? 0)
  const pendingCount = Number(pendingAudit?.pending_count ?? 0)
  const activeApRule = Number((ruleHealth as { ap_rule_active?: number })?.ap_rule_active ?? 0)

  const isBlocked = activeApRule === 0
  const isDegraded = !isBlocked && (
    postingSuccessRate < 100 ||
    driftSuppliers > 0 ||
    pendingCount > 0
  )

  const degradedReason = isBlocked
    ? 'GL control mapping incomplete: accounts_payable inactive or missing'
    : isDegraded
      ? [
          postingSuccessRate < 100 ? `posting_success_rate=${postingSuccessRate}%` : null,
          driftSuppliers > 0 ? `supplier_drift=${driftSuppliers}` : null,
          pendingCount > 0 ? `pending_rule_changes=${pendingCount}` : null,
        ].filter(Boolean).join(' | ')
      : undefined

  return c.json({
    success: true,
    snapshot_date: new Date().toISOString().slice(0, 10),
    data: {
      posting_success:       postingSuccess,
      dimension_completeness: dimensionCompleteness.results,
      subledger_drift:       subledgerDrift,
      rule_health:           ruleHealth,
      hardening_flags:       flagMap,
    },
    meta: {
      certification_status:  isBlocked ? 'blocked' : isDegraded ? 'degraded' : 'certified',
      degraded_mode:         isBlocked || isDegraded,
      degraded_reason:       degradedReason,
      data_source:           'gl_primary' as const,
      strict_posting_active: flagMap['strict_posting_mode'] ?? false,
    },
  })
})

// ── Maker-Checker for posting_rules changes ─────────────────────────────────

// GET /api/gl/hardening/audit/pending — list changes awaiting approval
hardening.get('/audit/pending', financeRead, async (c) => {
  const { company_id } = getUser(c)

  const { results } = await c.env.DB.prepare(
    `SELECT pra.id, pra.rule_id, pra.action, pra.changed_by, pra.changed_at,
            pra.change_reason, pra.old_values, pra.new_values,
            u.full_name AS changed_by_name
     FROM posting_rules_audit pra
     LEFT JOIN users u ON u.id = pra.changed_by
     WHERE pra.company_id = ? AND pra.approval_status = 'pending'
     ORDER BY pra.changed_at DESC`
  ).bind(company_id).all()

  return c.json({ success: true, data: results, count: results.length })
})

// POST /api/gl/hardening/audit/:id/approve — approve a pending rule change
hardening.post('/audit/:id/approve', adminOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const auditId = Number(c.req.param('id'))
  const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }))

  // Prevent self-approval: the approver must differ from the maker
  const record = await c.env.DB.prepare(
    `SELECT id, changed_by, approval_status, rule_id, action, old_values, new_values
     FROM posting_rules_audit
     WHERE id = ? AND company_id = ?`
  ).bind(auditId, company_id).first<{
    id: number; changed_by: number; approval_status: string
    rule_id: number; action: string; old_values: string | null; new_values: string
  }>()

  if (!record) return c.json({ success: false, error: 'سجل المراجعة غير موجود' }, 404)
  if (record.approval_status !== 'pending') {
    return c.json({ success: false, error: `الإجراء مكتمل بالفعل: ${record.approval_status}` }, 409)
  }
  if (record.changed_by === userId) {
    return c.json({ success: false, error: 'لا يمكن الموافقة على طلبك الخاص — مطلوب مراجع مختلف (Maker-Checker)' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE posting_rules_audit
     SET approval_status = 'approved', approved_by = ?, approved_at = datetime('now'),
         change_reason = change_reason || COALESCE(' | APPROVER_NOTE: ' || ?, '')
     WHERE id = ? AND company_id = ?`
  ).bind(userId, body.reason ?? null, auditId, company_id).run()

  await applyApprovedPostingRuleChange(c.env.DB, company_id, {
    rule_id: record.rule_id,
    action: record.action,
    old_values: record.old_values,
    new_values: record.new_values,
  })

  clearPostingEngineCaches()

  return c.json({ success: true, data: { audit_id: auditId, approved_by: userId } })
})

// POST /api/gl/hardening/audit/:id/reject — reject a pending rule change
hardening.post('/audit/:id/reject', adminOnly, async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const auditId = Number(c.req.param('id'))
  const body = await c.req.json<{ reason: string }>()

  if (!body.reason?.trim()) {
    return c.json({ success: false, error: 'سبب الرفض مطلوب' }, 400)
  }

  const record = await c.env.DB.prepare(
    `SELECT id, changed_by, approval_status FROM posting_rules_audit
     WHERE id = ? AND company_id = ?`
  ).bind(auditId, company_id).first<{ id: number; changed_by: number; approval_status: string }>()

  if (!record) return c.json({ success: false, error: 'سجل المراجعة غير موجود' }, 404)
  if (record.approval_status !== 'pending') {
    return c.json({ success: false, error: `الإجراء مكتمل بالفعل: ${record.approval_status}` }, 409)
  }
  if (record.changed_by === userId) {
    return c.json({ success: false, error: 'لا يمكن رفض طلبك الخاص — مطلوب مراجع مختلف' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE posting_rules_audit
     SET approval_status = 'rejected', approved_by = ?, approved_at = datetime('now'),
         change_reason = change_reason || ' | REJECTED: ' || ?
     WHERE id = ? AND company_id = ?`
  ).bind(userId, body.reason, auditId, company_id).run()

  return c.json({ success: true, data: { audit_id: auditId, rejected_by: userId } })
})

// GET /api/gl/hardening/audit — full audit log (paginated)
hardening.get('/audit', financeRead, async (c) => {
  const { company_id } = getUser(c)
  const page = Math.max(1, Number(c.req.query('page') ?? 1))
  const size = Math.min(100, Number(c.req.query('size') ?? 50))
  const status = c.req.query('status') // 'pending' | 'approved' | 'rejected' | undefined

  let where = 'WHERE pra.company_id = ?'
  const binds: unknown[] = [company_id]
  if (status) { where += ' AND pra.approval_status = ?'; binds.push(status) }

  const [{ results }, countRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT pra.id, pra.rule_id, pra.action, pra.changed_by, pra.changed_at,
              pra.change_reason, pra.approval_status, pra.approved_by, pra.approved_at,
              pra.old_values, pra.new_values
       FROM posting_rules_audit pra
       ${where}
       ORDER BY pra.changed_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...binds, size, (page - 1) * size).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM posting_rules_audit pra ${where}`
    ).bind(...binds).first<{ total: number }>(),
  ])

  return c.json({
    success: true,
    data: results,
    pagination: { page, size, total: countRow?.total ?? 0 },
  })
})

export default hardening
