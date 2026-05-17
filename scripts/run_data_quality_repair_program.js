#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const DB_NAME = 'agri-nile-flow-data-lake'
const COMPANY_ID = 1
const ROOT = process.cwd()
const ARTIFACT_DIR = path.join(ROOT, 'reports', 'data_quality')

const supplierJsonPath = path.join(ROOT, 'نواة_المستقبل_2025-2026.json')
const cashJsonPath = path.join(ROOT, 'خزينة_نواة_المستقبل_2025-2026.json')

const args = process.argv.slice(2)
const phaseArg = (() => {
  const i = args.indexOf('--phase')
  return i >= 0 ? String(args[i + 1] || 'all').toLowerCase() : 'all'
})()
const freezeHours = (() => {
  const i = args.indexOf('--freeze-hours')
  const v = i >= 0 ? Number(args[i + 1]) : 24
  return Number.isFinite(v) && v >= 0 ? v : 24
})()

const runPhase0 = phaseArg === 'all' || phaseArg === '0' || phaseArg === 'phase0'
const runPhase1 = phaseArg === 'all' || phaseArg === '1' || phaseArg === 'phase1'
const runPhase2 = phaseArg === 'all' || phaseArg === '2' || phaseArg === 'phase2'
const runPhase3 = phaseArg === 'all' || phaseArg === '3' || phaseArg === 'phase3'
const runPhase4 = phaseArg === 'all' || phaseArg === '4' || phaseArg === 'phase4'

function nowIso() {
  return new Date().toISOString()
}

function stamp() {
  return nowIso().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function esc(v) {
  return String(v).replace(/'/g, "''")
}

function toDate(v) {
  if (!v) return null
  return String(v).slice(0, 10)
}

function toNumber(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toText(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function sqlNum(v) {
  return v == null ? 'NULL' : String(v)
}

function sqlText(v) {
  return v == null ? 'NULL' : `'${esc(v)}'`
}

function runD1Json(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim()
  const escaped = compact.replace(/"/g, '\\"')
  const useFile = compact.length > 5000
  let cmd = ''
  let tmpPath = null

  if (useFile) {
    tmpPath = path.join(os.tmpdir(), `d1_batch_${Date.now()}_${Math.random().toString(36).slice(2)}.sql`)
    fs.writeFileSync(tmpPath, `${sql}\n`, 'utf8')
    cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --file "${tmpPath}"`
  } else {
    cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${escaped}"`
  }

  try {
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
    const start = out.indexOf('[')
    const end = out.lastIndexOf(']')
    if (start < 0 || end < 0 || end < start) {
      throw new Error('Failed to parse D1 JSON output')
    }
    return JSON.parse(out.slice(start, end + 1))
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
  }
}

function query(sql) {
  return runD1Json(sql)[0]?.results ?? []
}

function runBatch(statements, batchSize = 25) {
  let touched = 0
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize)
    const sql = chunk.join('\n')
    const results = runD1Json(sql)
    touched += results.reduce((sum, r) => sum + Number(r?.meta?.changes || 0), 0)
  }
  return touched
}

function pct(num, den) {
  if (!den) return 100
  return Math.round((num / den) * 10000) / 100
}

function ensureGovernanceTables() {
  const sql = `
    CREATE TABLE IF NOT EXISTS data_quality_control (
      company_id INTEGER PRIMARY KEY,
      freeze_until TEXT,
      enforce_gates INTEGER NOT NULL DEFAULT 0,
      min_supplier_center_pct REAL NOT NULL DEFAULT 95,
      min_supplier_expense_pct REAL NOT NULL DEFAULT 95,
      min_supplier_equipment_type_pct REAL NOT NULL DEFAULT 90,
      min_cash_center_pct REAL NOT NULL DEFAULT 95,
      min_cash_expense_pct REAL NOT NULL DEFAULT 90,
      min_items_ppg_pct REAL NOT NULL DEFAULT 100,
      min_items_ipg_pct REAL NOT NULL DEFAULT 100,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS data_quality_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO data_quality_control (
      company_id,
      enforce_gates,
      min_supplier_center_pct,
      min_supplier_expense_pct,
      min_supplier_equipment_type_pct,
      min_cash_center_pct,
      min_cash_expense_pct,
      min_items_ppg_pct,
      min_items_ipg_pct,
      updated_by
    )
    VALUES (${COMPANY_ID}, 0, 95, 95, 90, 95, 90, 100, 100, 'run_data_quality_repair_program')
    ON CONFLICT(company_id) DO NOTHING;
  `
  runD1Json(sql)
}

function snapshotMetrics() {
  const supplier = query(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center,
      SUM(CASE WHEN expense_category IS NOT NULL THEN 1 ELSE 0 END) AS with_expense,
      SUM(CASE WHEN equipment IS NOT NULL THEN 1 ELSE 0 END) AS with_equipment,
      SUM(CASE WHEN equipment_type_id IS NOT NULL THEN 1 ELSE 0 END) AS with_equipment_type,
      SUM(CASE WHEN equipment_usage_mode IS NOT NULL THEN 1 ELSE 0 END) AS with_usage_mode
    FROM supplier_transactions WHERE company_id=${COMPANY_ID}
  `)[0] || {}

  const cash = query(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN center_code IS NOT NULL THEN 1 ELSE 0 END) AS with_center,
      SUM(CASE WHEN expense_code IS NOT NULL THEN 1 ELSE 0 END) AS with_expense_code
    FROM cash_transactions WHERE company_id=${COMPANY_ID}
  `)[0] || {}

  const items = query(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN prod_posting_group_code IS NOT NULL THEN 1 ELSE 0 END) AS with_ppg,
      SUM(CASE WHEN inv_posting_group_code IS NOT NULL THEN 1 ELSE 0 END) AS with_ipg
    FROM items WHERE company_id=${COMPANY_ID}
  `)[0] || {}

  const equipment = query(`
    SELECT
      (SELECT COUNT(*) FROM equipment_types WHERE company_id=${COMPANY_ID}) AS equipment_types,
      (SELECT COUNT(*) FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND equipment IS NOT NULL) AS supplier_equipment_text,
      (SELECT COUNT(*) FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND equipment_type_id IS NOT NULL) AS supplier_equipment_type_id,
      (SELECT COUNT(*) FROM work_order_equipment WHERE company_id=${COMPANY_ID}) AS work_order_equipment_rows
  `)[0] || {}

  return {
    at: nowIso(),
    supplier: {
      ...supplier,
      center_pct: pct(Number(supplier.with_center || 0), Number(supplier.total || 0)),
      expense_pct: pct(Number(supplier.with_expense || 0), Number(supplier.total || 0)),
      equipment_type_pct_on_equipped: pct(Number(supplier.with_equipment_type || 0), Number(supplier.with_equipment || 0)),
    },
    cash: {
      ...cash,
      center_pct: pct(Number(cash.with_center || 0), Number(cash.total || 0)),
      expense_pct: pct(Number(cash.with_expense_code || 0), Number(cash.total || 0)),
    },
    items: {
      ...items,
      ppg_pct: pct(Number(items.with_ppg || 0), Number(items.total || 0)),
      ipg_pct: pct(Number(items.with_ipg || 0), Number(items.total || 0)),
    },
    equipment,
  }
}

function saveSnapshot(stage, metrics) {
  const json = JSON.stringify(metrics)
  const sql = `
    INSERT INTO data_quality_snapshots(company_id, stage, metrics_json)
    VALUES (${COMPANY_ID}, '${esc(stage)}', '${esc(json)}');
  `
  runD1Json(sql)
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function getEquipmentTypeMap() {
  const rows = query(`SELECT id, name FROM equipment_types WHERE company_id=${COMPANY_ID}`)
  const findBy = (rx) => {
    const row = rows.find((r) => rx.test(String(r.name || '')))
    return row ? Number(row.id) : null
  }
  return {
    tractor: findBy(/جرار/),
    pump: findBy(/طلمب|طلمبة/),
    harvester: findBy(/حصاد|حصادة/),
    spare: findBy(/غيار/),
    fuel: findBy(/وقود/),
  }
}

function inferUsageMode(description, expenseCategory) {
  const text = `${description || ''} ${expenseCategory || ''}`
  if (/وقود/.test(text)) return 'fuel'
  if (/صيان|اصلاح/.test(text)) return 'maintenance'
  if (/ايجار|ميكنة|معدات/.test(text)) return 'rental'
  return null
}

function inferEquipmentTypeId(equipmentText, expenseCategory, eqMap) {
  const text = `${equipmentText || ''} ${expenseCategory || ''}`
  if (/لودر|بدار|بلانتر|رشاش|عزاق/.test(text)) return eqMap.tractor
  if (/جرار/.test(text)) return eqMap.tractor
  if (/طلمب|طلمبة/.test(text)) return eqMap.pump
  if (/حصاد|حصادة/.test(text)) return eqMap.harvester
  if (/غيار/.test(text)) return eqMap.spare
  if (/وقود/.test(text)) return eqMap.fuel
  return null
}

function buildSupplierRows(eqMap) {
  const json = loadJson(supplierJsonPath)
  const tx = json?.البيان_الرئيسي?.المعاملات || []
  return tx.map((row) => {
    const description = toText(row['البيان'])
    const expenseCategory = toText(row['المصروف'])
    const equipment = toText(row['المعدة'])
    const amount = toNumber(row['القيمه']) || 0
    const quantity = toNumber(row['الكميه'])
    let unitPrice = toNumber(row['السعر'])
    if (unitPrice == null && quantity != null && quantity !== 0) {
      unitPrice = Math.round((amount / quantity) * 10000) / 10000
    }
    return {
      transactionDate: toDate(row['التاريخ']),
      entryType: toText(row['النوع']),
      supplierCode: toNumber(row['كود المورد']),
      documentNumber: toNumber(row['رقم المستند']),
      amount,
      debit: toNumber(row['مدين']) || 0,
      credit: toNumber(row['دائن']) || 0,
      centerCode: toNumber(row['كود البيقوت']),
      expenseCategory,
      equipment,
      unit: toText(row['الوحدة']),
      quantity,
      unitPrice,
      description,
      usageMode: inferUsageMode(description, expenseCategory),
      equipmentTypeId: inferEquipmentTypeId(equipment, expenseCategory, eqMap),
    }
  }).filter((row) => row.transactionDate && row.entryType)
}

function buildCashRows() {
  const json = loadJson(cashJsonPath)
  const tx = json?.البيان_الرئيسي?.المعاملات || []
  return tx.map((row) => ({
    transactionDate: toDate(row['التاريخ']),
    direction: toText(row['الحالة']),
    supplierCode: toNumber(row['كود المورد']),
    documentNumber: toNumber(row['رقم المستند']),
    amount: toNumber(row['القيمة']) || 0,
    debit: toNumber(row['مدين']) || 0,
    credit: toNumber(row['دائن']) || 0,
    centerCode: toNumber(row['كود المركز']),
    expenseCode: toNumber(row['كود المصروف']),
    narration: toText(row['البيان']),
  })).filter((row) => row.transactionDate && row.direction)
}

function backfillSupplierDimensions(rows) {
  const occurrence = new Map()
  const statements = []

  for (const row of rows) {
    const key = [
      row.transactionDate,
      row.entryType,
      row.supplierCode ?? 'NULL',
      row.documentNumber ?? 'NULL',
      row.amount.toFixed(3),
      row.debit.toFixed(3),
      row.credit.toFixed(3),
    ].join('|')

    const offset = occurrence.get(key) || 0
    occurrence.set(key, offset + 1)

    const updateSql = `
      UPDATE supplier_transactions
      SET
        center_code = COALESCE(center_code, ${sqlNum(row.centerCode)}),
        expense_category = COALESCE(expense_category, ${sqlText(row.expenseCategory)}),
        equipment = COALESCE(equipment, ${sqlText(row.equipment)}),
        unit = COALESCE(unit, ${sqlText(row.unit)}),
        quantity = COALESCE(quantity, ${sqlNum(row.quantity)}),
        unit_price = COALESCE(unit_price, ${sqlNum(row.unitPrice)}),
        description = COALESCE(description, ${sqlText(row.description)}),
        equipment_usage_mode = COALESCE(equipment_usage_mode, ${sqlText(row.usageMode)}),
        equipment_type_id = COALESCE(equipment_type_id, ${sqlNum(row.equipmentTypeId)})
      WHERE id = (
        SELECT id
        FROM supplier_transactions
        WHERE company_id=${COMPANY_ID}
          AND transaction_date='${esc(row.transactionDate)}'
          AND entry_type='${esc(row.entryType)}'
          AND COALESCE(supplier_code, -1)=${row.supplierCode == null ? -1 : row.supplierCode}
          AND COALESCE(document_number, -1)=${row.documentNumber == null ? -1 : row.documentNumber}
          AND ABS(COALESCE(amount,0) - ${row.amount}) < 0.01
          AND ABS(COALESCE(debit,0) - ${row.debit}) < 0.01
          AND ABS(COALESCE(credit,0) - ${row.credit}) < 0.01
        ORDER BY id
        LIMIT 1 OFFSET ${offset}
      );
    `

    statements.push(updateSql)
  }

  return runBatch(statements, 25)
}

function backfillCashDimensions(rows) {
  const occurrence = new Map()
  const statements = []

  for (const row of rows) {
    const key = [
      row.transactionDate,
      row.direction,
      row.supplierCode ?? 'NULL',
      row.documentNumber ?? 'NULL',
      row.amount.toFixed(3),
      row.debit.toFixed(3),
      row.credit.toFixed(3),
    ].join('|')

    const offset = occurrence.get(key) || 0
    occurrence.set(key, offset + 1)

    const updateSql = `
      UPDATE cash_transactions
      SET
        center_code = COALESCE(center_code, ${sqlNum(row.centerCode)}),
        expense_code = COALESCE(expense_code, ${sqlNum(row.expenseCode)}),
        narration = COALESCE(narration, ${sqlText(row.narration)})
      WHERE id = (
        SELECT id
        FROM cash_transactions
        WHERE company_id=${COMPANY_ID}
          AND transaction_date='${esc(row.transactionDate)}'
          AND direction='${esc(row.direction)}'
          AND COALESCE(supplier_code, -1)=${row.supplierCode == null ? -1 : row.supplierCode}
          AND COALESCE(document_number, -1)=${row.documentNumber == null ? -1 : row.documentNumber}
          AND ABS(COALESCE(amount,0) - ${row.amount}) < 0.01
          AND ABS(COALESCE(debit,0) - ${row.debit}) < 0.01
          AND ABS(COALESCE(credit,0) - ${row.credit}) < 0.01
        ORDER BY id
        LIMIT 1 OFFSET ${offset}
      );
    `

    statements.push(updateSql)
  }

  return runBatch(statements, 25)
}

function backfillItemPostingGroups() {
  const sql = `
    UPDATE items
    SET
      prod_posting_group_code = COALESCE(prod_posting_group_code,
        CASE
          WHEN warehouse = 'اسمدة' THEN 'FERT'
          WHEN warehouse = 'مبيدات' THEN 'CHEM'
          WHEN warehouse = 'تقاوي وبذور' THEN 'SEED'
          WHEN warehouse = 'زيوت ووقود' THEN 'FUEL'
          WHEN warehouse = 'شبكات ري' THEN 'EQUIP'
          WHEN warehouse = 'عدد وادوات' THEN 'EQUIP'
          WHEN warehouse = 'قطع غيار' THEN 'SPARE'
          WHEN warehouse = 'تعبئة وتغليف' THEN 'PACK'
          WHEN warehouse = 'متنوعات' THEN 'MISC'
          WHEN warehouse = 'اصول ثابتة' THEN 'FA'
          WHEN warehouse = 'انتاج تام' THEN 'FG'
          ELSE 'MISC'
        END
      ),
      inv_posting_group_code = COALESCE(inv_posting_group_code,
        CASE
          WHEN warehouse = 'اسمدة' THEN 'FERT-WH'
          WHEN warehouse = 'مبيدات' THEN 'CHEM-WH'
          WHEN warehouse = 'تقاوي وبذور' THEN 'SEED-WH'
          WHEN warehouse = 'زيوت ووقود' THEN 'FUEL-WH'
          WHEN warehouse = 'شبكات ري' THEN 'MAIN-WH'
          WHEN warehouse = 'عدد وادوات' THEN 'MAIN-WH'
          WHEN warehouse = 'قطع غيار' THEN 'MAIN-WH'
          WHEN warehouse = 'تعبئة وتغليف' THEN 'PACK-WH'
          WHEN warehouse = 'متنوعات' THEN 'MAIN-WH'
          WHEN warehouse = 'اصول ثابتة' THEN 'ASSET-WH'
          WHEN warehouse = 'انتاج تام' THEN 'FG-WH'
          ELSE 'MAIN-WH'
        END
      )
    WHERE company_id = ${COMPANY_ID};
  `
  return runD1Json(sql)[0]?.meta?.changes || 0
}

function collectUnresolved() {
  return {
    supplier_missing_center: query(`
      SELECT id, transaction_date, supplier_code, amount
      FROM supplier_transactions
      WHERE company_id=${COMPANY_ID} AND center_code IS NULL
      ORDER BY id DESC LIMIT 200
    `),
    supplier_missing_expense: query(`
      SELECT id, transaction_date, supplier_code, amount, entry_type
      FROM supplier_transactions
      WHERE company_id=${COMPANY_ID} AND expense_category IS NULL
      ORDER BY id DESC LIMIT 200
    `),
    supplier_missing_equipment_type_on_equipped: query(`
      SELECT id, transaction_date, supplier_code, equipment, expense_category
      FROM supplier_transactions
      WHERE company_id=${COMPANY_ID} AND equipment IS NOT NULL AND equipment_type_id IS NULL
      ORDER BY id DESC LIMIT 200
    `),
    cash_missing_center: query(`
      SELECT id, transaction_date, amount, direction
      FROM cash_transactions
      WHERE company_id=${COMPANY_ID} AND center_code IS NULL
      ORDER BY id DESC LIMIT 200
    `),
    cash_missing_expense_code: query(`
      SELECT id, transaction_date, amount, direction, supplier_code
      FROM cash_transactions
      WHERE company_id=${COMPANY_ID} AND expense_code IS NULL
      ORDER BY id DESC LIMIT 200
    `),
    items_missing_ppg: query(`
      SELECT code, name, warehouse
      FROM items
      WHERE company_id=${COMPANY_ID} AND prod_posting_group_code IS NULL
      ORDER BY code LIMIT 200
    `),
    items_missing_ipg: query(`
      SELECT code, name, warehouse
      FROM items
      WHERE company_id=${COMPANY_ID} AND inv_posting_group_code IS NULL
      ORDER BY code LIMIT 200
    `),
  }
}

function readControl() {
  return query(`
    SELECT * FROM data_quality_control WHERE company_id=${COMPANY_ID}
  `)[0] || null
}

function writeContractArtifact(eqMap) {
  const contract = {
    phase: 'Phase 1 - Source Contract',
    generated_at: nowIso(),
    company_id: COMPANY_ID,
    field_contract: {
      supplier_transactions: {
        center_code: 'required(posted)',
        expense_category: 'required(posted)',
        equipment: 'optional',
        equipment_usage_mode: 'inferred',
        equipment_type_id: 'required when equipment text exists',
      },
      cash_transactions: {
        center_code: 'required(posted)',
        expense_code: 'required(posted outflow without supplier/partner)',
      },
      items: {
        prod_posting_group_code: 'required',
        inv_posting_group_code: 'required',
      },
    },
    dictionaries: {
      equipment_text_to_type_id: {
        contains_tractor: eqMap.tractor,
        contains_pump: eqMap.pump,
        contains_harvester: eqMap.harvester,
        contains_spare: eqMap.spare,
        contains_fuel: eqMap.fuel,
      },
      expense_labels_to_category_or_code: {
        supplier: 'expense_category from source field المصروف',
        cash: 'expense_code from source field كود المصروف',
      },
      center_labels_codes_to_center_code: {
        supplier: 'source field كود البيقوت',
        cash: 'source field كود المركز',
        fallback: 'field.center_code when field_id exists',
      },
    },
  }

  ensureDir(ARTIFACT_DIR)
  const file = path.join(ARTIFACT_DIR, `phase1_source_contract_${stamp()}.json`)
  fs.writeFileSync(file, JSON.stringify(contract, null, 2), 'utf8')
  return file
}

function saveReport(before, after, unresolved, control, touched) {
  ensureDir(ARTIFACT_DIR)
  const jsonFile = path.join(ARTIFACT_DIR, `phase_report_${stamp()}.json`)
  const mdFile = jsonFile.replace(/\.json$/, '.md')

  const payload = {
    generated_at: nowIso(),
    before,
    after,
    touched,
    control,
    unresolved_summary: Object.fromEntries(Object.entries(unresolved).map(([k, v]) => [k, v.length])),
    unresolved,
  }

  fs.writeFileSync(jsonFile, JSON.stringify(payload, null, 2), 'utf8')

  const md = [
    '# Data Quality Remediation Report',
    '',
    `Generated: ${payload.generated_at}`,
    '',
    '## BEFORE',
    '',
    '```json',
    JSON.stringify(before, null, 2),
    '```',
    '',
    '## AFTER',
    '',
    '```json',
    JSON.stringify(after, null, 2),
    '```',
    '',
    '## Touched Rows',
    '',
    '```json',
    JSON.stringify(touched, null, 2),
    '```',
    '',
    '## Active Policy',
    '',
    '```json',
    JSON.stringify(control, null, 2),
    '```',
    '',
    '## Unresolved Counts',
    '',
    '```json',
    JSON.stringify(payload.unresolved_summary, null, 2),
    '```',
  ].join('\n')

  fs.writeFileSync(mdFile, md, 'utf8')
  return { jsonFile, mdFile }
}

function setFreeze(hours) {
  const freezeUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
  runD1Json(`
    UPDATE data_quality_control
    SET freeze_until='${freezeUntil}', enforce_gates=0, updated_at=datetime('now'), updated_by='phase0_freeze'
    WHERE company_id=${COMPANY_ID};
  `)
  return freezeUntil
}

function enableGates() {
  runD1Json(`
    UPDATE data_quality_control
    SET enforce_gates=1, updated_at=datetime('now'), updated_by='phase3_enable_gates'
    WHERE company_id=${COMPANY_ID};
  `)
}

function enablePhase4Enforcement() {
  runD1Json(`
    UPDATE data_quality_control
    SET freeze_until=NULL, enforce_gates=1, updated_at=datetime('now'), updated_by='phase4_enforcement'
    WHERE company_id=${COMPANY_ID};
  `)
}

function main() {
  ensureGovernanceTables()
  ensureDir(ARTIFACT_DIR)

  if (!fs.existsSync(supplierJsonPath)) {
    throw new Error(`Missing source JSON: ${supplierJsonPath}`)
  }
  if (!fs.existsSync(cashJsonPath)) {
    throw new Error(`Missing source JSON: ${cashJsonPath}`)
  }

  console.log('Running data quality repair program...')
  console.log(`Phase selector: ${phaseArg}`)

  let before = snapshotMetrics()
  saveSnapshot('baseline_before', before)

  if (runPhase0) {
    const freezeUntil = setFreeze(freezeHours)
    console.log(`[Phase0] Bulk freeze enabled until ${freezeUntil}`)
  }

  const eqMap = getEquipmentTypeMap()
  if (runPhase1) {
    const contractFile = writeContractArtifact(eqMap)
    console.log(`[Phase1] Source contract written: ${contractFile}`)
  }

  const touched = {
    supplier: 0,
    cash: 0,
    items: 0,
  }

  if (runPhase2) {
    const supplierRows = buildSupplierRows(eqMap)
    const cashRows = buildCashRows()
    touched.supplier = backfillSupplierDimensions(supplierRows)
    touched.cash = backfillCashDimensions(cashRows)
    touched.items = Number(backfillItemPostingGroups() || 0)
    console.log(`[Phase2] Backfill touched rows => supplier:${touched.supplier}, cash:${touched.cash}, items:${touched.items}`)
  }

  const after = snapshotMetrics()
  saveSnapshot('baseline_after', after)

  if (runPhase3) {
    enableGates()
    console.log('[Phase3] Validation gates are now enabled for bulk and posted writes')
  }

  if (runPhase4) {
    enablePhase4Enforcement()
    console.log('[Phase4] Enforcement mode enabled; freeze released, gates remain active')
  }

  const unresolved = collectUnresolved()
  const control = readControl()
  const files = saveReport(before, after, unresolved, control, touched)

  console.log('--- BEFORE ---')
  console.log(JSON.stringify(before, null, 2))
  console.log('--- AFTER ---')
  console.log(JSON.stringify(after, null, 2))
  console.log(`Report JSON: ${files.jsonFile}`)
  console.log(`Report MD:   ${files.mdFile}`)
  console.log('Done.')
}

main()
