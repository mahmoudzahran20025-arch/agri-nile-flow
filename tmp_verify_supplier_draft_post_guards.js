const BASE = process.env.API_BASE || 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@nawa.eg'
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'Admin@2025'
const AUTH_COMPANY_ID = Number(process.env.AUTH_COMPANY_ID || '1')

async function api(path, opts = {}, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  let data = null
  try { data = await res.json() } catch { data = { success: false, error: 'Non-JSON response' } }
  return { res, data }
}

function ok(label, pass, details = '') {
  const line = `${pass ? 'PASS' : 'FAIL'} ${label}${details ? ` -- ${details}` : ''}`
  console.log(line)
  if (!pass) throw new Error(line)
}

async function run() {
  const runId = Date.now()

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD, company_id: AUTH_COMPANY_ID }),
  })
  ok('LOGIN', login.res.ok && !!login.data?.data?.token, `status=${login.res.status}`)
  const token = login.data.data.token

  const supplierCode = 99300000 + (runId % 700000)
  const supplier = await api('/suppliers', {
    method: 'POST',
    body: JSON.stringify({
      code: supplierCode,
      name: `Guard Supplier ${runId}`,
      activity: 'Guard checks',
      supplier_type: 'supplier',
      payment_terms: 30,
    }),
  }, token)
  ok('CREATE_SUPPLIER', supplier.res.ok && supplier.data?.success, `status=${supplier.res.status}`)

  const draftNoDims = await api(`/suppliers/${supplierCode}/transactions`, {
    method: 'POST',
    body: JSON.stringify({
      transaction_date: new Date().toISOString().slice(0, 10),
      entry_type: 'د',
      amount: 1000,
      document_type: 'أخرى',
      notes: `DRAFT_NO_DIMS:${runId}`,
      status: 'draft',
    }),
  }, token)
  ok('CREATE_DRAFT_NO_DIMS', draftNoDims.res.ok && draftNoDims.data?.success, `status=${draftNoDims.res.status}`)

  const statement = await api(`/suppliers/${supplierCode}/statement?page=1&size=50`, {}, token)
  ok('LOAD_STATEMENT', statement.res.ok && statement.data?.success, `status=${statement.res.status}`)
  const draftRow = (statement.data?.data || []).find((r) => String(r.notes || '').includes(`DRAFT_NO_DIMS:${runId}`))
  ok('DRAFT_FOUND', !!draftRow, `id=${draftRow?.id || '—'}`)

  const postNoDims = await api(`/suppliers/${supplierCode}/transactions/${draftRow.id}/post`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }, token)
  ok('POST_DRAFT_NO_DIMS_BLOCKED', postNoDims.res.status === 422 && postNoDims.data?.success === false, `status=${postNoDims.res.status}`)

  const seasons = await api('/config/seasons', {}, token)
  const centers = await api('/config/cost_centers', {}, token)
  const season = (seasons.data?.data || []).find((s) => String(s.status).toLowerCase() === 'active') || (seasons.data?.data || [])[0]
  const center = (centers.data?.data || [])[0]
  ok('SEASON_AND_CENTER', !!season && !!center)

  const paymentDraft = await api(`/suppliers/${supplierCode}/transactions`, {
    method: 'POST',
    body: JSON.stringify({
      transaction_date: new Date().toISOString().slice(0, 10),
      entry_type: 'م',
      amount: 600,
      document_type: 'نقداً',
      notes: `PAY_DRAFT_NO_BANK:${runId}`,
      season_id: Number(season.id),
      center_code: Number(center.code),
      status: 'draft',
    }),
  }, token)
  ok('CREATE_PAYMENT_DRAFT_NO_BANK', paymentDraft.res.ok && paymentDraft.data?.success, `status=${paymentDraft.res.status}`)

  const statement2 = await api(`/suppliers/${supplierCode}/statement?page=1&size=100`, {}, token)
  const paymentDraftRow = (statement2.data?.data || []).find((r) => String(r.notes || '').includes(`PAY_DRAFT_NO_BANK:${runId}`))
  ok('PAYMENT_DRAFT_FOUND', !!paymentDraftRow, `id=${paymentDraftRow?.id || '—'}`)

  const postPaymentNoBank = await api(`/suppliers/${supplierCode}/transactions/${paymentDraftRow.id}/post`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  }, token)
  ok('POST_PAYMENT_DRAFT_NO_BANK_BLOCKED', postPaymentNoBank.res.status === 422 && postPaymentNoBank.data?.success === false, `status=${postPaymentNoBank.res.status}`)

  console.log('GUARD_RESULT')
  console.log(JSON.stringify({ supplierCode, draftId: draftRow.id, paymentDraftId: paymentDraftRow.id }, null, 2))
}

run().catch((e) => {
  console.error('GUARD_TEST_FAILED', e.message)
  process.exit(1)
})
