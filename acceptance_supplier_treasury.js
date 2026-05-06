const BASE = process.env.API_BASE || 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'

const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@nawa.eg'
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'Admin@2025'
const AUTH_COMPANY_ID = Number(process.env.AUTH_COMPANY_ID || '1')

const RUN_WRITE_TESTS = process.env.RUN_WRITE_TESTS === '1'
const TEST_SUPPLIER_CODE = process.env.TEST_SUPPLIER_CODE ? Number(process.env.TEST_SUPPLIER_CODE) : null

function ymd(d) {
  return d.toISOString().slice(0, 10)
}

function shiftDays(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return ymd(d)
}

async function api(path, opts = {}, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = { success: false, error: 'Non-JSON response' }
  }
  return { res, data }
}

async function login() {
  const { data, res } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: AUTH_EMAIL,
      password: AUTH_PASSWORD,
      company_id: AUTH_COMPANY_ID,
    }),
  })

  if (!res.ok || !data?.data?.token) {
    throw new Error(`Login failed: status=${res.status} payload=${JSON.stringify(data)}`)
  }

  return data.data.token
}

function assertOk(name, cond, details = '') {
  if (cond) {
    console.log(`PASS ${name}${details ? ` — ${details}` : ''}`)
    return true
  }
  console.log(`FAIL ${name}${details ? ` — ${details}` : ''}`)
  return false
}

async function readOnlyChecks(token) {
  let pass = 0
  let fail = 0

  const checks = [
    ['/suppliers?limit=5', 'SUPPLIERS_LIST'],
    ['/suppliers/aging', 'SUPPLIERS_AGING'],
    ['/reports/supplier-payments', 'SUPPLIER_PAYMENTS_REPORT'],
    ['/treasury/transactions?size=10', 'TREASURY_TXNS'],
    ['/treasury/partners', 'TREASURY_PARTNERS'],
  ]

  for (const [path, label] of checks) {
    const { res, data } = await api(path, {}, token)
    const ok = res.ok && data?.success === true
    if (assertOk(label, ok, `status=${res.status}`)) pass++
    else fail++
  }

  return { pass, fail }
}

async function getFirstSeasonAndCenter(token) {
  const [seasonsResp, ccResp] = await Promise.all([
    api('/config/seasons', {}, token),
    api('/config/cc', {}, token),
  ])

  const seasons = seasonsResp.data?.data || []
  const centers = ccResp.data?.data || []

  const activeSeason = seasons.find((s) => String(s.status || '').toLowerCase() === 'active') || seasons[0] || null
  const firstCenter = centers[0] || null

  return {
    season_id: activeSeason ? Number(activeSeason.id) : null,
    center_code: firstCenter ? Number(firstCenter.code) : null,
  }
}

async function createSupplierTxn(token, code, payload) {
  return api(`/suppliers/${code}/transactions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token)
}

async function listSupplierStatement(token, code, month) {
  const q = month ? `?page=1&size=200&month=${month}` : '?page=1&size=200'
  return api(`/suppliers/${code}/statement${q}`, {}, token)
}

async function postSupplierTxn(token, code, id) {
  return api(`/suppliers/${code}/transactions/${id}/post`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }, token)
}

async function deleteSupplierTxn(token, code, id) {
  return api(`/suppliers/${code}/transactions/${id}`, { method: 'DELETE' }, token)
}

async function writeChecks(token) {
  if (!TEST_SUPPLIER_CODE) {
    console.log('SKIP WRITE_TESTS — missing TEST_SUPPLIER_CODE')
    return { pass: 0, fail: 0, skipped: true }
  }

  let pass = 0
  let fail = 0
  const runId = `acc-${Date.now()}`

  const dims = await getFirstSeasonAndCenter(token)
  if (!dims.season_id || !dims.center_code) {
    console.log('SKIP WRITE_TESTS — missing season_id/center_code from config endpoints')
    return { pass: 0, fail: 1, skipped: true }
  }

  // 1) Backdated rebalance test (drafts so we can clean up)
  const basePayload = {
    entry_type: 'د',
    amount: 0,
    status: 'draft',
    document_type: 'أخرى',
    expense_category: `ACC-${runId}`,
    notes: `ACC_TEST:${runId}`,
  }

  const t1 = await createSupplierTxn(token, TEST_SUPPLIER_CODE, {
    ...basePayload,
    transaction_date: shiftDays(-1),
    amount: 100.11,
  })
  const t2 = await createSupplierTxn(token, TEST_SUPPLIER_CODE, {
    ...basePayload,
    transaction_date: shiftDays(0),
    amount: 50.22,
  })
  const t3 = await createSupplierTxn(token, TEST_SUPPLIER_CODE, {
    ...basePayload,
    transaction_date: shiftDays(-2),
    amount: 25.33,
  })

  const createdOk = t1.res.ok && t2.res.ok && t3.res.ok && t1.data?.success && t2.data?.success && t3.data?.success
  if (assertOk('WRITE_CREATE_BACKDATED_DRAFTS', createdOk)) pass++
  else fail++

  const month = new Date().getMonth() + 1
  const st = await listSupplierStatement(token, TEST_SUPPLIER_CODE, month)
  const rows = st.data?.data || []
  const taggedRows = rows.filter((r) => typeof r.notes === 'string' && r.notes.includes(`ACC_TEST:${runId}`))
  const hasThree = taggedRows.length >= 3
  if (assertOk('WRITE_STATEMENT_CONTAINS_TAGGED_ROWS', hasThree, `found=${taggedRows.length}`)) pass++
  else fail++

  // 2) Ownership check on post/delete with wrong supplier code
  const oneDraft = taggedRows.find((r) => r.status === 'draft')
  if (oneDraft?.id) {
    const wrongCode = TEST_SUPPLIER_CODE + 999999
    const wrongPost = await postSupplierTxn(token, wrongCode, oneDraft.id)
    const wrongDel = await deleteSupplierTxn(token, wrongCode, oneDraft.id)
    const ownershipBlocked = wrongPost.res.status === 404 && wrongDel.res.status === 404
    if (assertOk('WRITE_OWNERSHIP_ENFORCED', ownershipBlocked, `post=${wrongPost.res.status},del=${wrongDel.res.status}`)) pass++
    else fail++
  } else {
    assertOk('WRITE_OWNERSHIP_ENFORCED', false, 'no draft row id found')
    fail++
  }

  // 3) Draft->Post payment mirror to treasury (creates posted records intentionally)
  const payCreate = await createSupplierTxn(token, TEST_SUPPLIER_CODE, {
    transaction_date: shiftDays(0),
    entry_type: 'م',
    amount: 123.45,
    status: 'draft',
    document_type: 'نقداً',
    expense_category: `ACC-PAY-${runId}`,
    notes: `ACC_PAY_TEST:${runId}`,
    season_id: dims.season_id,
    center_code: dims.center_code,
  })

  const payCreated = payCreate.res.ok && payCreate.data?.success
  if (assertOk('WRITE_CREATE_PAYMENT_DRAFT', payCreated, `status=${payCreate.res.status}`)) pass++
  else fail++

  // find created payment draft by note marker
  const st2 = await listSupplierStatement(token, TEST_SUPPLIER_CODE, month)
  const rows2 = st2.data?.data || []
  const payDraft = rows2.find((r) => typeof r.notes === 'string' && r.notes.includes(`ACC_PAY_TEST:${runId}`) && r.status === 'draft')

  if (payDraft?.id) {
    const posted = await postSupplierTxn(token, TEST_SUPPLIER_CODE, payDraft.id)
    const postOk = posted.res.ok && posted.data?.success
    if (assertOk('WRITE_POST_PAYMENT_DRAFT', postOk, `status=${posted.res.status}`)) pass++
    else fail++

    const supPay = await api(`/treasury/supplier-payments?supplier_code=${TEST_SUPPLIER_CODE}`, {}, token)
    const payRows = supPay.data?.data || []
    const mirrored = payRows.some((r) => Number(r.amount) === 123.45 && String(r.transaction_date || '').slice(0, 10) === shiftDays(0))
    if (assertOk('WRITE_PAYMENT_MIRRORED_TO_TREASURY', mirrored, `rows=${payRows.length}`)) pass++
    else fail++
  } else {
    assertOk('WRITE_POST_PAYMENT_DRAFT', false, 'payment draft row not found')
    fail++
  }

  // Cleanup tagged drafts only
  const st3 = await listSupplierStatement(token, TEST_SUPPLIER_CODE, month)
  const rows3 = st3.data?.data || []
  const draftCleanup = rows3.filter((r) => r.status === 'draft' && typeof r.notes === 'string' && r.notes.includes(`ACC_TEST:${runId}`))

  let cleanupDeleted = 0
  for (const row of draftCleanup) {
    const del = await deleteSupplierTxn(token, TEST_SUPPLIER_CODE, row.id)
    if (del.res.ok && del.data?.success) cleanupDeleted++
  }

  if (assertOk('WRITE_CLEANUP_DRAFTS', cleanupDeleted === draftCleanup.length, `deleted=${cleanupDeleted}/${draftCleanup.length}`)) pass++
  else fail++

  return { pass, fail, skipped: false }
}

async function run() {
  console.log(`ACCEPTANCE START base=${BASE}`)
  const token = await login()

  const read = await readOnlyChecks(token)
  const write = RUN_WRITE_TESTS ? await writeChecks(token) : { pass: 0, fail: 0, skipped: true }

  const pass = read.pass + write.pass
  const fail = read.fail + write.fail

  console.log(`\nREAD-ONLY: pass=${read.pass}, fail=${read.fail}`)
  if (write.skipped) {
    console.log('WRITE: skipped (set RUN_WRITE_TESTS=1 and TEST_SUPPLIER_CODE=<code> to enable)')
  } else {
    console.log(`WRITE: pass=${write.pass}, fail=${write.fail}`)
  }

  console.log(`\nTOTAL: pass=${pass}, fail=${fail}`)
  if (fail > 0) process.exitCode = 1
}

run().catch((err) => {
  console.error('ACCEPTANCE_RUN_ERR', err)
  process.exit(1)
})
