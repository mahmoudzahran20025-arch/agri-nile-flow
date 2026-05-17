/**
 * test_movements_regression.js
 * ────────────────────────────
 * Regression test for POST /inventory/movements and POST /inventory/movements/batch
 * covering both typed codes (GRN, ISSUE, RETURN_SUPPLIER, RETURN_CUSTOMER,
 * ADJUSTMENT_PROFIT, ADJUSTMENT_LOSS) and the legacy Arabic literals.
 *
 * Usage:
 *   node test_movements_regression.js
 *   node test_movements_regression.js --base-url https://agri-nile-flow.mahm-zahran22.workers.dev
 *
 * Requires a valid JWT in env var API_TOKEN (or set TOKEN below).
 */

const BASE_URL = process.argv.find(a => a.startsWith('--base-url='))?.split('=')[1]
  ?? 'https://agri-nile-flow.mahm-zahran22.workers.dev'

const TOKEN = process.env.API_TOKEN ?? ''

if (!TOKEN) {
  console.error('❌  Set API_TOKEN env var to a valid JWT before running.')
  process.exit(1)
}

const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
}

// ── helpers ───────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { _raw: text } }
  return { status: res.status, json }
}

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅  ${name}`)
    passed++
  } else {
    console.error(`  ❌  ${name}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

// ── shared movement body builder ──────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10)

function singleBody(movementType, overrides = {}) {
  return {
    movement_type: movementType,
    warehouse: 'MAIN',
    movement_date: TODAY,
    notes: `regression test — ${movementType}`,
    items: [
      { item_code: 'TEST-ITEM-001', quantity: 1, unit_cost: 100 },
    ],
    ...overrides,
  }
}

function batchBody(movementType, overrides = {}) {
  return {
    movement_type: movementType,
    warehouse: 'MAIN',
    movement_date: TODAY,
    notes: `batch regression — ${movementType}`,
    lines: [
      { item_code: 'TEST-ITEM-001', quantity: 1, unit_cost: 100 },
    ],
    ...overrides,
  }
}

// ── test cases ────────────────────────────────────────────────────────────────

async function testSingleEndpoint() {
  console.log('\n── POST /inventory/movements (single) ──────────────────────────')

  const cases = [
    { type: 'GRN',               expectOk: true  },
    { type: 'ISSUE',             expectOk: true  },
    { type: 'RETURN_SUPPLIER',   expectOk: true  },
    { type: 'RETURN_CUSTOMER',   expectOk: true  },
    { type: 'ADJUSTMENT_PROFIT', expectOk: true  },
    { type: 'ADJUSTMENT_LOSS',   expectOk: true  },
    { type: 'اضافة',             expectOk: true  },  // legacy Arabic — must still work
    { type: 'BOGUS_TYPE',        expectOk: false },  // unknown type — must reject
  ]

  for (const { type, expectOk } of cases) {
    const { status, json } = await post('/api/inventory/movements', singleBody(type))
    if (expectOk) {
      // Accept 201 (created), 200 (ok), or 409 (period/lock conflicts) as "type was recognised"
      // We specifically want to rule out 400 "unsupported movement type"
      const typeRecognised = status !== 400 || !json?.error?.toLowerCase().includes('unsupported')
      assert(
        `single ${type} → type recognised (status ${status})`,
        typeRecognised,
        JSON.stringify(json).slice(0, 120),
      )
    } else {
      assert(
        `single ${type} → rejected (status ${status})`,
        status === 400,
        JSON.stringify(json).slice(0, 120),
      )
    }
  }
}

async function testBatchEndpoint() {
  console.log('\n── POST /inventory/movements/batch ─────────────────────────────')

  const cases = [
    { type: 'GRN',               expectOk: true  },
    { type: 'ISSUE',             expectOk: true  },
    { type: 'RETURN_SUPPLIER',   expectOk: true  },
    { type: 'RETURN_CUSTOMER',   expectOk: true  },
    { type: 'ADJUSTMENT_PROFIT', expectOk: true  },
    { type: 'ADJUSTMENT_LOSS',   expectOk: true  },
    { type: 'اضافة',             expectOk: true  },  // legacy Arabic
    { type: 'BOGUS_TYPE',        expectOk: false },  // must reject
  ]

  for (const { type, expectOk } of cases) {
    const { status, json } = await post('/api/inventory/movements/batch', batchBody(type))
    if (expectOk) {
      const typeRecognised = status !== 400 || !json?.error?.toLowerCase().includes('unsupported')
      assert(
        `batch  ${type} → type recognised (status ${status})`,
        typeRecognised,
        JSON.stringify(json).slice(0, 120),
      )
    } else {
      assert(
        `batch  ${type} → rejected (status ${status})`,
        status === 400,
        JSON.stringify(json).slice(0, 120),
      )
    }
  }
}

async function testDirectionMapping() {
  console.log('\n── Direction mapping sanity (inbound types must not be treated as outbound) ──')

  // We can infer direction from the response if the API echoes `is_inbound` or similar.
  // As a proxy, we check that ISSUE/RETURN_SUPPLIER/ADJUSTMENT_LOSS are not accepted with
  // a negative balance check that only triggers for inbound movements, and vice-versa.
  // Lightweight — just confirm the response is not a direction-related 400 error.

  const inboundTypes  = ['GRN', 'RETURN_CUSTOMER', 'ADJUSTMENT_PROFIT']
  const outboundTypes = ['ISSUE', 'RETURN_SUPPLIER', 'ADJUSTMENT_LOSS']

  for (const type of [...inboundTypes, ...outboundTypes]) {
    const { status, json } = await post('/api/inventory/movements', singleBody(type))
    const noDirectionError = !(
      typeof json?.error === 'string' &&
      (json.error.includes('direction') || json.error.includes('اتجاه'))
    )
    assert(
      `direction  ${type} → no direction error (status ${status})`,
      noDirectionError,
      JSON.stringify(json).slice(0, 120),
    )
  }
}

// ── run all ───────────────────────────────────────────────────────────────────

;(async () => {
  console.log(`\nRunning movements regression tests against: ${BASE_URL}`)
  console.log(`Date: ${TODAY}\n`)

  await testSingleEndpoint()
  await testBatchEndpoint()
  await testDirectionMapping()

  console.log(`\n────────────────────────────────────────`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.error('REGRESSION DETECTED — see failures above.')
    process.exit(1)
  } else {
    console.log('All checks passed.')
  }
})()
