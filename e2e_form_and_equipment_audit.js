const BASE = process.env.API_BASE || 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@nawa.eg'
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'Admin@2025'
const AUTH_COMPANY_ID = Number(process.env.AUTH_COMPANY_ID || '1')

function ymd(d) { return d.toISOString().slice(0, 10) }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d) }

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

function logOk(label, ok, details = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${details ? ` -- ${details}` : ''}`)
  return ok
}

async function login() {
  const { res, data } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD, company_id: AUTH_COMPANY_ID }),
  })
  if (!res.ok || !data?.data?.token) throw new Error(`Login failed: status=${res.status}`)
  return data.data.token
}

async function getDims(token) {
  const [seasonsR, ccR, eqR] = await Promise.all([
    api('/config/seasons', {}, token),
    api('/config/cost_centers', {}, token),
    api('/config/equipment_types', {}, token),
  ])
  const seasons = seasonsR.data?.data || []
  const centers = ccR.data?.data || []
  const eqTypes = eqR.data?.data || []

  const season = seasons.find(s => String(s.status || '').toLowerCase() === 'active') || seasons[0]
  const center = centers[0]
  const eqType = eqTypes.find(e => Number(e.is_active) === 1) || eqTypes[0]

  if (!season || !center || !eqType) {
    throw new Error(`Missing dims: season=${!!season}, center=${!!center}, equipmentType=${!!eqType}`)
  }

  return {
    season_id: Number(season.id),
    center_code: Number(String(center.code)),
    equipment_type_id: Number(eqType.id),
    equipment_type_name: eqType.name,
  }
}

async function createSupplier(token, runId) {
  const code = 98000000 + (runId % 900000)
  const body = {
    code,
    name: `E2E Supplier ${runId}`,
    phone: '01000000000',
    activity: 'E2E test supplier',
    payment_terms: 30,
    supplier_type: 'supplier',
  }
  const { res, data } = await api('/suppliers', { method: 'POST', body: JSON.stringify(body) }, token)
  if (!res.ok || !data?.success) throw new Error(`Create supplier failed: status=${res.status} error=${data?.error}`)
  return code
}

async function createTxn(token, supplierCode, body) {
  return api(`/suppliers/${supplierCode}/transactions`, {
    method: 'POST', body: JSON.stringify(body),
  }, token)
}

async function statement(token, supplierCode) {
  return api(`/suppliers/${supplierCode}/statement?page=1&size=200`, {}, token)
}

async function postDraft(token, supplierCode, id) {
  return api(`/suppliers/${supplierCode}/transactions/${id}/post`, { method: 'PATCH', body: JSON.stringify({}) }, token)
}

async function trace(token, entryId) {
  return api(`/gl/entries/${entryId}/trace`, {}, token)
}

async function run() {
  const token = await login()
  const dims = await getDims(token)
  const runId = Date.now()
  const supplierCode = await createSupplier(token, runId)

  console.log(`RUN supplier=${supplierCode} season=${dims.season_id} center=${dims.center_code} eqType=${dims.equipment_type_name}`)

  // 1) Form test: invoice posted
  const invTag = `E2E_FORM_INV_${runId}`
  const inv = await createTxn(token, supplierCode, {
    transaction_date: daysAgo(6),
    entry_type: 'د',
    amount: 40000,
    document_type: 'فاتورة',
    expense_category: 'خدمات زراعية',
    notes: invTag,
    season_id: dims.season_id,
    center_code: dims.center_code,
    status: 'posted',
  })
  logOk('FORM_INVOICE_POSTED', inv.res.ok && inv.data?.success, `status=${inv.res.status}`)

  // 2) Form test: payment posted
  const payTag = `E2E_FORM_PAY_${runId}`
  const pay = await createTxn(token, supplierCode, {
    transaction_date: daysAgo(3),
    entry_type: 'م',
    amount: 15000,
    document_type: 'نقداً',
    expense_category: 'سداد جزئي',
    notes: payTag,
    season_id: dims.season_id,
    center_code: dims.center_code,
    status: 'posted',
  })
  logOk('FORM_PAYMENT_POSTED', pay.res.ok && pay.data?.success, `status=${pay.res.status}`)

  // 3) Form test: draft then post
  const draftTag = `E2E_FORM_DRAFT_${runId}`
  const dr = await createTxn(token, supplierCode, {
    transaction_date: ymd(new Date()),
    entry_type: 'م',
    amount: 2000,
    document_type: 'شيك',
    expense_category: 'دفعة شيك',
    notes: draftTag,
    season_id: dims.season_id,
    center_code: dims.center_code,
    status: 'draft',
  })
  logOk('FORM_DRAFT_CREATED', dr.res.ok && dr.data?.success, `status=${dr.res.status}`)

  const st1 = await statement(token, supplierCode)
  const rows1 = st1.data?.data || []
  const draftRow = rows1.find(r => String(r.notes || '').includes(draftTag) && r.status === 'draft')
  const hasDraftRow = !!draftRow?.id
  logOk('FORM_DRAFT_VISIBLE_IN_STATEMENT', hasDraftRow)

  if (hasDraftRow) {
    const pr = await postDraft(token, supplierCode, draftRow.id)
    logOk('FORM_DRAFT_POSTED', pr.res.ok && pr.data?.success, `status=${pr.res.status}`)
  }

  // 4) Equipment test: posted equipment invoice must create fixed asset
  const eqTag = `E2E_EQ_${runId}`
  const eqInv = await createTxn(token, supplierCode, {
    transaction_date: daysAgo(1),
    entry_type: 'د',
    amount: 120000,
    document_type: 'فاتورة',
    expense_category: 'معدات رأسمالية',
    equipment_type_id: dims.equipment_type_id,
    notes: eqTag,
    season_id: dims.season_id,
    center_code: dims.center_code,
    status: 'posted',
  })
  logOk('EQUIPMENT_INVOICE_POSTED', eqInv.res.ok && eqInv.data?.success, `status=${eqInv.res.status}`)

  // 5) Verify statement + journal links
  const st2 = await statement(token, supplierCode)
  const rows2 = st2.data?.data || []
  const invRow = rows2.find(r => String(r.notes || '').includes(invTag))
  const payRow = rows2.find(r => String(r.notes || '').includes(payTag))
  const eqRow = rows2.find(r => String(r.notes || '').includes(eqTag))
  const postedDraftRow = rows2.find(r => String(r.notes || '').includes(draftTag))

  logOk('STATEMENT_HAS_INVOICE', !!invRow)
  logOk('STATEMENT_HAS_PAYMENT', !!payRow)
  logOk('STATEMENT_HAS_EQUIPMENT_TXN', !!eqRow)
  logOk('STATEMENT_DRAFT_NOW_POSTED', !!postedDraftRow && postedDraftRow.status === 'posted', `status=${postedDraftRow?.status}`)

  logOk('INVOICE_HAS_JOURNAL', !!invRow?.journal_entry_id, `je=${invRow?.journal_entry_id || '—'}`)
  logOk('PAYMENT_HAS_JOURNAL', !!payRow?.journal_entry_id, `je=${payRow?.journal_entry_id || '—'}`)
  logOk('EQUIPMENT_HAS_JOURNAL', !!eqRow?.journal_entry_id, `je=${eqRow?.journal_entry_id || '—'}`)

  // 6) Verify trace endpoint for at least one new journal entry
  const entryIds = [invRow?.journal_entry_id, payRow?.journal_entry_id, eqRow?.journal_entry_id].filter(Boolean)
  let tracePass = false
  for (const id of entryIds) {
    const tr = await trace(token, Number(id))
    const ok = tr.res.ok && tr.data?.success && !!tr.data?.data
    const hasTrace = !!tr.data?.data?.has_trace
    const hasSource = !!tr.data?.data?.source_event || !!tr.data?.data?.source_document
    logOk(`TRACE_ENTRY_${id}`, ok, `hasTrace=${hasTrace} hasSource=${hasSource}`)
    if (ok) tracePass = true
  }

  // 7) Verify equipment created in /assets
  const assetsR = await api('/assets', {}, token)
  const assets = assetsR.data?.data || []
  const eqAsset = assets.find(a => Number(a.supplier_transaction_id) === Number(eqRow?.id))
  logOk('EQUIPMENT_ASSET_CREATED', !!eqAsset, `assetId=${eqAsset?.id || '—'} txnId=${eqRow?.id || '—'}`)

  // 8) GL integrity
  const orphans = await api('/gl/orphans?limit=5', {}, token)
  const noOrphans = orphans.res.ok && orphans.data?.success && (orphans.data?.data || []).length === 0
  logOk('GL_ORPHANS_EMPTY', noOrphans, `rows=${(orphans.data?.data || []).length}`)

  console.log('\nSUMMARY')
  console.log(JSON.stringify({
    supplierCode,
    entryIds,
    equipmentAssetId: eqAsset?.id || null,
    traceVerified: tracePass,
    frontURL: `https://feature-posting-engine-v2.agri-nile-flow-lake.pages.dev/suppliers/${supplierCode}`,
  }, null, 2))
}

run().catch((e) => {
  console.error('E2E_FORM_EQUIP_ERR', e)
  process.exit(1)
})
