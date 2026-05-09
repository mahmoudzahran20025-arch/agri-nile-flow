import type { Env } from '../types'

type GateMode = 'bulk' | 'posted'

interface CoverageMetrics {
  supplier_center_pct: number
  supplier_expense_pct: number
  supplier_equipment_type_pct: number
  cash_center_pct: number
  cash_expense_pct: number
  items_ppg_pct: number
  items_ipg_pct: number
}

interface ControlRow {
  freeze_until: string | null
  enforce_gates: number
  min_supplier_center_pct: number
  min_supplier_expense_pct: number
  min_supplier_equipment_type_pct: number
  min_cash_center_pct: number
  min_cash_expense_pct: number
  min_items_ppg_pct: number
  min_items_ipg_pct: number
}

export interface DataQualityGateResult {
  ok: boolean
  status?: 409 | 423
  code?: string
  error?: string
  details?: unknown
}

function pct(num: number, den: number): number {
  if (!den) return 100
  return Math.round((num / den) * 10000) / 100
}

async function readCoverage(db: Env['DB'], companyId: number): Promise<CoverageMetrics> {
  const supplier = await db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center,
       SUM(CASE WHEN expense_category IS NOT NULL THEN 1 ELSE 0 END) AS with_expense,
       SUM(CASE WHEN equipment IS NOT NULL THEN 1 ELSE 0 END) AS with_equipment,
       SUM(CASE WHEN equipment IS NOT NULL AND equipment_type_id IS NOT NULL THEN 1 ELSE 0 END) AS with_equipment_type
     FROM supplier_transactions
     WHERE company_id = ?`
  ).bind(companyId).first<{
    total: number
    with_center: number
    with_expense: number
    with_equipment: number
    with_equipment_type: number
  }>()

  const cash = await db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center,
       SUM(CASE WHEN direction = 'م' THEN 1 ELSE 0 END) AS expense_required_total,
       SUM(CASE WHEN direction = 'م' AND expense_code IS NOT NULL THEN 1 ELSE 0 END) AS with_expense
     FROM cash_transactions
     WHERE company_id = ?`
  ).bind(companyId).first<{
    total: number
    with_center: number
    expense_required_total: number
    with_expense: number
  }>()

  const items = await db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN prod_posting_group_code IS NOT NULL THEN 1 ELSE 0 END) AS with_ppg,
       SUM(CASE WHEN inv_posting_group_code IS NOT NULL THEN 1 ELSE 0 END) AS with_ipg
     FROM items
     WHERE company_id = ?`
  ).bind(companyId).first<{
    total: number
    with_ppg: number
    with_ipg: number
  }>()

  const supplierTotal = Number(supplier?.total ?? 0)
  const supplierWithEquipment = Number(supplier?.with_equipment ?? 0)

  return {
    supplier_center_pct: pct(Number(supplier?.with_center ?? 0), supplierTotal),
    supplier_expense_pct: pct(Number(supplier?.with_expense ?? 0), supplierTotal),
    supplier_equipment_type_pct: pct(Number(supplier?.with_equipment_type ?? 0), supplierWithEquipment),
    cash_center_pct: pct(Number(cash?.with_center ?? 0), Number(cash?.total ?? 0)),
    cash_expense_pct: pct(Number(cash?.with_expense ?? 0), Number(cash?.expense_required_total ?? 0)),
    items_ppg_pct: pct(Number(items?.with_ppg ?? 0), Number(items?.total ?? 0)),
    items_ipg_pct: pct(Number(items?.with_ipg ?? 0), Number(items?.total ?? 0)),
  }
}

function validateCoverage(control: ControlRow, metrics: CoverageMetrics) {
  const violations: Array<{ metric: keyof CoverageMetrics; actual: number; minimum: number }> = []

  const checks: Array<[keyof CoverageMetrics, number]> = [
    ['supplier_center_pct', Number(control.min_supplier_center_pct)],
    ['supplier_expense_pct', Number(control.min_supplier_expense_pct)],
    ['supplier_equipment_type_pct', Number(control.min_supplier_equipment_type_pct)],
    ['cash_center_pct', Number(control.min_cash_center_pct)],
    ['cash_expense_pct', Number(control.min_cash_expense_pct)],
    ['items_ppg_pct', Number(control.min_items_ppg_pct)],
    ['items_ipg_pct', Number(control.min_items_ipg_pct)],
  ]

  for (const [metric, minimum] of checks) {
    const actual = Number(metrics[metric] ?? 0)
    if (actual + 0.0001 < minimum) {
      violations.push({ metric, actual, minimum })
    }
  }

  return violations
}

export async function enforceDataQualityPolicy(
  db: Env['DB'],
  companyId: number,
  opts: { mode: GateMode; module: string },
): Promise<DataQualityGateResult> {
  const control = await db.prepare(
    `SELECT
       freeze_until,
       enforce_gates,
       min_supplier_center_pct,
       min_supplier_expense_pct,
       min_supplier_equipment_type_pct,
       min_cash_center_pct,
       min_cash_expense_pct,
       min_items_ppg_pct,
       min_items_ipg_pct
     FROM data_quality_control
     WHERE company_id = ?`
  ).bind(companyId).first<ControlRow>()

  if (!control) {
    return { ok: true }
  }

  if (opts.mode === 'bulk' && control.freeze_until) {
    const freezeUntil = Date.parse(control.freeze_until)
    if (Number.isFinite(freezeUntil) && Date.now() < freezeUntil) {
      return {
        ok: false,
        status: 423,
        code: 'DATA_QUALITY_FREEZE',
        error: `Bulk writes are frozen until ${control.freeze_until}`,
      }
    }
  }

  if (!control.enforce_gates) {
    return { ok: true }
  }

  const coverage = await readCoverage(db, companyId)
  const violations = validateCoverage(control, coverage)
  if (violations.length === 0) {
    return { ok: true }
  }

  return {
    ok: false,
    status: 409,
    code: 'DATA_QUALITY_GATES_BLOCKED',
    error: `Data quality coverage below policy thresholds for module ${opts.module}`,
    details: {
      coverage,
      violations,
    },
  }
}
