#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const ROOT = process.cwd()
const API_ROOT = path.join(ROOT, 'src', 'api')
const WORKER_BASE_URL = process.env.WORKER_BASE_URL || 'https://agri-nile-flow.mahm-zahran22.workers.dev'
const DB_NAME = process.env.DB_NAME || 'agri-nile-flow-data-lake'
const COMPANY_ID = Number(process.env.COMPANY_ID || 1)
const JSON_SOURCE = path.join(ROOT, 'مخازن_نواة_المستقبل_2025-2026.json')

function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile() && full.endsWith('.ts')) out.push(full)
  }
  return out
}

function run(cmd, opts = {}) {
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024, ...opts })
    return { ok: true, code: 0, stdout }
  } catch (e) {
    return {
      ok: false,
      code: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? String(e.stdout) : '',
      stderr: e.stderr ? String(e.stderr) : String(e.message || e),
    }
  }
}

function runD1Json(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"')
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --json --command "${compact}"`
  const res = run(cmd)
  if (!res.ok) {
    return { ok: false, error: res.stderr || res.stdout }
  }
  const start = res.stdout.indexOf('[')
  const end = res.stdout.lastIndexOf(']')
  if (start < 0 || end < 0) return { ok: false, error: 'D1 JSON parse bounds failed', raw: res.stdout }
  try {
    const arr = JSON.parse(res.stdout.slice(start, end + 1))
    return { ok: true, rows: arr[0]?.results || [], meta: arr[0]?.meta || null }
  } catch (e) {
    return { ok: false, error: String(e), raw: res.stdout }
  }
}

function inferPrefix(filePath) {
  const rel = path.relative(API_ROOT, filePath).replace(/\\/g, '/')
  const parts = rel.split('/')
  if (parts.length === 1) {
    const name = parts[0].replace(/\.ts$/, '')
    return `/api/${name}`
  }
  const group = parts[0]
  return `/api/${group}`
}

function extractEndpoints() {
  const files = walk(API_ROOT).filter(f => !f.endsWith('.legacy.backup'))
  const endpoints = []
  const routeRe = /([A-Za-z_][A-Za-z0-9_]*)\.(get|post|patch|put|delete)\(\s*['\"]([^'\"]+)['\"]/g

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const text = fs.readFileSync(file, 'utf8')
    const prefix = inferPrefix(file)
    let m
    while ((m = routeRe.exec(text)) !== null) {
      const method = m[2].toUpperCase()
      const routePath = m[3]
      endpoints.push({
        file: rel,
        method,
        routePath,
        inferredPath: `${prefix}${routePath}`.replace(/\/+/g, '/'),
        type: method === 'GET' ? 'read' : 'write',
      })
    }
  }

  return endpoints
}

async function httpProbe(url, method = 'GET') {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 15000)
  const started = Date.now()
  try {
    const res = await fetch(url, { method, signal: controller.signal, headers: { 'content-type': 'application/json' } })
    const ms = Date.now() - started
    clearTimeout(t)
    return { ok: true, status: res.status, ms }
  } catch (e) {
    clearTimeout(t)
    return { ok: false, status: null, ms: Date.now() - started, error: String(e) }
  }
}

function materializePath(p) {
  return p
    .replace(/\/:company_id\b/g, '/1')
    .replace(/\/:supplier_code\b/g, '/20900151')
    .replace(/\/:item_code\b/g, '/1010023')
    .replace(/\/:code\b/g, '/1006004')
    .replace(/\/:id\b/g, '/1')
    .replace(/\/:[^/]+\?/g, '')
    .replace(/\/:[^/]+/g, '/1')
}

function collectJsonMappings(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectJsonMappings(item, out)
    return
  }
  if (!node || typeof node !== 'object') return

  const main = node['الحساب الرئيسي']
  const centerCode = node['كود مركز التكلفة']
  const centerName = node['مركز التكلفة']
  const accountCode = node['كود الحساب']

  if (main != null && centerCode != null && centerName != null) {
    out.push({
      mainAccount: String(main).trim(),
      centerCode: Number(centerCode),
      centerName: String(centerName).trim(),
      accountCode: accountCode == null ? null : String(accountCode).trim(),
    })
  }

  for (const v of Object.values(node)) collectJsonMappings(v, out)
}

function uniqueBy(arr, keyFn) {
  const seen = new Set()
  const out = []
  for (const x of arr) {
    const k = keyFn(x)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  return out
}

function runPowershellScript(scriptPath) {
  const cmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
  return run(cmd)
}

async function main() {
  const stamp = nowStamp()
  const outDir = path.join(ROOT, 'reports', 'verification')
  fs.mkdirSync(outDir, { recursive: true })

  const endpoints = extractEndpoints()
  const endpointsByMethod = endpoints.reduce((acc, e) => {
    acc[e.method] = (acc[e.method] || 0) + 1
    return acc
  }, {})

  const probesList = [
    '/api/reports/supplier-payments',
    '/api/reports/suppliers-balance',
    '/api/gl/hardening/baseline',
    '/api/gl/posting-rules',
    '/api/inventory/movements',
    '/api/suppliers',
    '/api/treasury/transactions',
    '/api/gl/posting-setup/health',
  ]

  const probes = []
  for (const p of probesList) {
    probes.push({ path: p, ...(await httpProbe(`${WORKER_BASE_URL}${p}`, 'GET')) })
  }

  const getEndpoints = endpoints.filter(e => e.method === 'GET')
  const uniqueGetPaths = uniqueBy(getEndpoints.map(e => e.inferredPath), p => p)
  const getCoverageProbes = []
  for (const p of uniqueGetPaths) {
    const materialized = materializePath(p)
    getCoverageProbes.push({
      originalPath: p,
      path: materialized,
      ...(await httpProbe(`${WORKER_BASE_URL}${materialized}`, 'GET')),
    })
  }
  const getProbeStatusSummary = getCoverageProbes.reduce((acc, p) => {
    const key = p.status == null ? 'null' : String(p.status)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const kpiQuery = runD1Json(`
    SELECT
      (SELECT COUNT(*) FROM business_events WHERE company_id=${COMPANY_ID}) AS be_total,
      (SELECT COUNT(*) FROM business_events WHERE company_id=${COMPANY_ID} AND journal_entry_id IS NOT NULL) AS be_linked,
      (SELECT COUNT(*) FROM business_events WHERE company_id=${COMPANY_ID} AND journal_entry_id IS NULL) AS be_unlinked,
      (SELECT ROUND(100.0*COUNT(CASE WHEN journal_entry_id IS NOT NULL THEN 1 END)/COUNT(*),2) FROM business_events WHERE company_id=${COMPANY_ID}) AS be_link_pct,
      (SELECT COUNT(*) FROM business_events WHERE company_id=${COMPANY_ID} AND (
         CASE WHEN source_module='inventory'
           THEN ABS(COALESCE(CAST(json_extract(payload, '$.value_in') AS REAL),0)) > 0.0001
             OR ABS(COALESCE(CAST(json_extract(payload, '$.value_out') AS REAL),0)) > 0.0001
           ELSE ABS(COALESCE(CAST(json_extract(payload, '$.amount') AS REAL),0)) > 0.0001
             OR ABS(COALESCE(CAST(json_extract(payload, '$.debit') AS REAL),0)) > 0.0001
             OR ABS(COALESCE(CAST(json_extract(payload, '$.credit') AS REAL),0)) > 0.0001
         END
      )) AS be_material_total,
      (SELECT COUNT(*) FROM business_events WHERE company_id=${COMPANY_ID} AND journal_entry_id IS NOT NULL AND (
         CASE WHEN source_module='inventory'
           THEN ABS(COALESCE(CAST(json_extract(payload, '$.value_in') AS REAL),0)) > 0.0001
             OR ABS(COALESCE(CAST(json_extract(payload, '$.value_out') AS REAL),0)) > 0.0001
           ELSE ABS(COALESCE(CAST(json_extract(payload, '$.amount') AS REAL),0)) > 0.0001
             OR ABS(COALESCE(CAST(json_extract(payload, '$.debit') AS REAL),0)) > 0.0001
             OR ABS(COALESCE(CAST(json_extract(payload, '$.credit') AS REAL),0)) > 0.0001
         END
      )) AS be_material_linked,
      (SELECT ROUND(100.0 *
         COUNT(CASE WHEN journal_entry_id IS NOT NULL THEN 1 END) /
         NULLIF(COUNT(*),0), 2)
       FROM business_events
       WHERE company_id=${COMPANY_ID} AND (
         CASE WHEN source_module='inventory'
           THEN ABS(COALESCE(CAST(json_extract(payload, '$.value_in') AS REAL),0)) > 0.0001
             OR ABS(COALESCE(CAST(json_extract(payload, '$.value_out') AS REAL),0)) > 0.0001
           ELSE ABS(COALESCE(CAST(json_extract(payload, '$.amount') AS REAL),0)) > 0.0001
             OR ABS(COALESCE(CAST(json_extract(payload, '$.debit') AS REAL),0)) > 0.0001
             OR ABS(COALESCE(CAST(json_extract(payload, '$.credit') AS REAL),0)) > 0.0001
         END
       )) AS be_material_link_pct,
      (SELECT COUNT(*) FROM supplier_balance_snapshots WHERE company_id=${COMPANY_ID}) AS snapshot_rows,
      (SELECT COUNT(*) FROM supplier_balance_snapshots WHERE company_id=${COMPANY_ID} AND ABS(COALESCE(computed_balance,0)-COALESCE(stored_balance,0))>0.5) AS drift_rows,
      (SELECT COUNT(*) FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND center_code IS NULL) AS supplier_missing_center,
      (SELECT COUNT(*) FROM supplier_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND season_id IS NULL) AS supplier_missing_season,
      (SELECT COUNT(*) FROM inventory_movements WHERE company_id=${COMPANY_ID} AND status='posted' AND center_code IS NULL) AS inv_missing_center,
      (SELECT COUNT(*) FROM inventory_movements WHERE company_id=${COMPANY_ID} AND status='posted' AND season_id IS NULL) AS inv_missing_season,
      (SELECT COUNT(*) FROM inventory_movements im WHERE im.company_id=${COMPANY_ID} AND im.status='posted' AND im.field_id IS NULL AND EXISTS (
         SELECT 1 FROM fields f WHERE f.company_id=im.company_id AND f.center_code=im.center_code AND f.is_active=1 AND f.season_id IS NOT NULL
      )) AS inv_missing_field_operational,
      (SELECT COUNT(*) FROM cash_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND season_id IS NULL) AS cash_missing_season,
      (SELECT COUNT(*) FROM cash_transactions WHERE company_id=${COMPANY_ID} AND status='posted' AND field_id IS NULL) AS cash_missing_field,
      (SELECT COUNT(*) FROM cash_transactions ct WHERE ct.company_id=${COMPANY_ID} AND ct.status='posted' AND ct.field_id IS NULL AND EXISTS (
         SELECT 1 FROM fields f WHERE f.company_id=ct.company_id AND f.center_code=ct.center_code AND f.is_active=1 AND f.season_id IS NOT NULL
      )) AS cash_missing_field_operational,
      (SELECT COUNT(*) FROM posting_rules_audit WHERE company_id=${COMPANY_ID} AND approval_status='pending') AS pending_audit
  `)

  const unbalancedQuery = runD1Json(`
    SELECT COUNT(*) AS unbalanced_entries
    FROM (
      SELECT je.id
      FROM journal_entries je
      JOIN journal_entry_lines jl ON jl.entry_id = je.id AND jl.company_id = je.company_id
      WHERE je.company_id=${COMPANY_ID}
        AND je.ref_type IN ('supplier_transaction','cash_transaction','inventory_movement')
      GROUP BY je.id
      HAVING ABS(ROUND(SUM(COALESCE(jl.debit,0)),2)-ROUND(SUM(COALESCE(jl.credit,0)),2)) > 0.01
    )
  `)

  const phase4Simple = runPowershellScript(path.join(ROOT, 'scripts', 'phase4_test_simple.ps1'))
  const writeCycle = runPowershellScript(path.join(ROOT, 'scripts', 'write_test_delete_final.ps1'))

  let mappingSummary = {
    sourceRows: 0,
    uniqueMappings: 0,
    centersInJson: 0,
    centersMissingInDb: 0,
    sourceSupplierCodesInCenterColumn: [],
    accountsInJson: 0,
    accountsMissingInDb: 0,
    sampleMissingCenters: [],
    sampleMissingAccounts: [],
    sampleMappings: [],
  }

  try {
    const raw = fs.readFileSync(JSON_SOURCE, 'utf8').replace(/^\uFEFF/, '')
    const json = JSON.parse(raw)
    const rows = []
    collectJsonMappings(json, rows)
    const mappings = uniqueBy(rows, r => `${r.mainAccount}|${r.centerCode}|${r.centerName}|${r.accountCode || ''}`)

    const centers = uniqueBy(mappings.map(r => ({ code: r.centerCode, name: r.centerName })), r => String(r.code))
    const accounts = uniqueBy(
      mappings.filter(r => r.accountCode != null).map(r => String(r.accountCode)),
      r => r,
    )

    const centersDbRes = runD1Json(`SELECT code, name_ar, name_en FROM cost_centers WHERE company_id=${COMPANY_ID}`)
    const coaDbRes = runD1Json(`SELECT code, name FROM chart_of_accounts WHERE company_id=${COMPANY_ID}`)
    const cropMapRes = runD1Json(`SELECT crop_label, account_code FROM crop_account_mappings WHERE company_id=${COMPANY_ID} AND is_active=1`)
    const suppliersRes = runD1Json(`SELECT code, name FROM suppliers WHERE company_id=${COMPANY_ID}`)

    const dbCenters = new Set((centersDbRes.rows || []).map(r => Number(r.code)))
    const dbAccounts = new Set((coaDbRes.rows || []).map(r => String(r.code)))
    const cropAccountMap = new Map((cropMapRes.rows || []).map(r => [String(r.crop_label), String(r.account_code)]))
    const supplierCodes = new Set((suppliersRes.rows || []).map(r => Number(r.code)))

    const supplierLikeCenterCodes = centers.filter(c => !dbCenters.has(Number(c.code)) && supplierCodes.has(Number(c.code)))
    const missingCenters = centers.filter(c => !dbCenters.has(Number(c.code)) && !supplierCodes.has(Number(c.code)))
    const unresolvedAccounts = accounts.filter(a => {
      if (dbAccounts.has(String(a))) return false
      const matchingMapping = mappings.find(r => String(r.accountCode) === String(a) && cropAccountMap.has(String(r.mainAccount)))
      return !matchingMapping
    })
    const sourceAccountsResolvedViaMapping = accounts.filter(a => {
      if (dbAccounts.has(String(a))) return false
      return mappings.some(r => String(r.accountCode) === String(a) && cropAccountMap.has(String(r.mainAccount)))
    })

    mappingSummary = {
      sourceRows: rows.length,
      uniqueMappings: mappings.length,
      centersInJson: centers.length,
      centersMissingInDb: missingCenters.length,
      sourceSupplierCodesInCenterColumn: supplierLikeCenterCodes,
      accountsInJson: accounts.length,
      accountsMissingInDb: unresolvedAccounts.length,
      sourceAccountsResolvedViaMapping,
      sampleMissingCenters: missingCenters.slice(0, 10),
      sampleMissingAccounts: unresolvedAccounts.slice(0, 10),
      sampleMappings: mappings.slice(0, 20),
    }
  } catch (e) {
    mappingSummary = { ...mappingSummary, parseError: String(e) }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    workerBaseUrl: WORKER_BASE_URL,
    dbName: DB_NAME,
    companyId: COMPANY_ID,
    endpointMatrix: {
      total: endpoints.length,
      read: endpoints.filter(e => e.type === 'read').length,
      write: endpoints.filter(e => e.type === 'write').length,
      byMethod: endpointsByMethod,
      endpoints,
    },
    probes,
    getEndpointCoverage: {
      totalGetEndpoints: getEndpoints.length,
      uniqueGetPaths: uniqueGetPaths.length,
      statusSummary: getProbeStatusSummary,
      probes: getCoverageProbes,
    },
    dataQualityAndAccounting: {
      kpis: kpiQuery.ok ? (kpiQuery.rows[0] || null) : { error: kpiQuery.error },
      accountingBalance: unbalancedQuery.ok ? (unbalancedQuery.rows[0] || null) : { error: unbalancedQuery.error },
    },
    writeAndEndpointTests: {
      phase4_test_simple: {
        ok: phase4Simple.ok,
        code: phase4Simple.code,
        outputTail: (phase4Simple.stdout || '').slice(-4000),
        error: phase4Simple.stderr || null,
      },
      write_test_delete_final: {
        ok: writeCycle.ok,
        code: writeCycle.code,
        outputTail: (writeCycle.stdout || '').slice(-4000),
        error: writeCycle.stderr || null,
      },
    },
    realDataMappingCheck: mappingSummary,
  }

  const outJson = path.join(outDir, `endpoint_matrix_run_${stamp}.json`)
  fs.writeFileSync(outJson, JSON.stringify(result, null, 2))

  const compact = {
    report: path.relative(ROOT, outJson).replace(/\\/g, '/'),
    endpoints: result.endpointMatrix.total,
    readEndpoints: result.endpointMatrix.read,
    writeEndpoints: result.endpointMatrix.write,
    be_link_pct: result.dataQualityAndAccounting.kpis?.be_link_pct,
    be_material_link_pct: result.dataQualityAndAccounting.kpis?.be_material_link_pct,
    unbalanced_entries: result.dataQualityAndAccounting.accountingBalance?.unbalanced_entries,
    inv_missing_field_operational: result.dataQualityAndAccounting.kpis?.inv_missing_field_operational,
    cash_missing_field_operational: result.dataQualityAndAccounting.kpis?.cash_missing_field_operational,
    json_centers_missing_in_db: result.realDataMappingCheck.centersMissingInDb,
    json_accounts_missing_in_db: result.realDataMappingCheck.accountsMissingInDb,
    write_cycle_ok: result.writeAndEndpointTests.write_test_delete_final.ok,
  }

  console.log(JSON.stringify(compact, null, 2))
}

main().catch((e) => {
  console.error(String(e))
  process.exit(1)
})
