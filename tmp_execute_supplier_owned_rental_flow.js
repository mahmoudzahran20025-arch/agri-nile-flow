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
  try {
    data = await res.json()
  } catch {
    data = { success: false, error: 'Non-JSON response' }
  }

  return { res, data }
}

function assertStep(label, condition, details = '') {
  const line = `${condition ? 'PASS' : 'FAIL'} ${label}${details ? ` -- ${details}` : ''}`
  console.log(line)
  if (!condition) throw new Error(line)
}

async function login() {
  const { res, data } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: AUTH_EMAIL,
      password: AUTH_PASSWORD,
      company_id: AUTH_COMPANY_ID,
    }),
  })

  assertStep('LOGIN', res.ok && !!data?.data?.token, `status=${res.status}`)
  return data.data.token
}

async function ensureBankAccount(token, runId) {
  const bankAccounts = await api('/finance/bank-accounts', {}, token)
  assertStep('LOAD_BANK_ACCOUNTS', bankAccounts.res.ok && bankAccounts.data?.success, `status=${bankAccounts.res.status}`)

  const active = (bankAccounts.data?.data || []).find((row) => Number(row.is_active) === 1)
  if (active) return active

  const created = await api('/finance/bank-accounts', {
    method: 'POST',
    body: JSON.stringify({
      bank_name: 'E2E Bank',
      account_name: `Supplier Flow ${runId}`,
      account_number: `E2E-${runId}`,
      currency: 'EGP',
      opening_balance: 500000,
      notes: `Created by tmp_execute_supplier_owned_rental_flow ${runId}`,
    }),
  }, token)

  assertStep('CREATE_BANK_ACCOUNT', created.res.ok && created.data?.success, `status=${created.res.status}`)

  const refreshed = await api('/finance/bank-accounts', {}, token)
  const createdRow = (refreshed.data?.data || []).find((row) => Number(row.id) === Number(created.data?.data?.id))
  assertStep('REFRESH_BANK_ACCOUNT', !!createdRow)
  return createdRow
}

async function loadDims(token) {
  const [seasons, centers, equipmentTypes] = await Promise.all([
    api('/config/seasons', {}, token),
    api('/config/cost_centers', {}, token),
    api('/config/equipment_types', {}, token),
  ])

  assertStep('LOAD_SEASONS', seasons.res.ok && seasons.data?.success, `status=${seasons.res.status}`)
  assertStep('LOAD_COST_CENTERS', centers.res.ok && centers.data?.success, `status=${centers.res.status}`)
  assertStep('LOAD_EQUIPMENT_TYPES', equipmentTypes.res.ok && equipmentTypes.data?.success, `status=${equipmentTypes.res.status}`)

  const season = (seasons.data?.data || []).find((row) => String(row.status).toLowerCase() === 'active') || (seasons.data?.data || [])[0]
  const center = (centers.data?.data || [])[0]
  const capitalEquipment = (equipmentTypes.data?.data || []).find((row) => Number(row.is_active) === 1 && row.asset_nature === 'capital')

  assertStep('ACTIVE_SEASON_PRESENT', !!season)
  assertStep('COST_CENTER_PRESENT', !!center)
  assertStep('CAPITAL_EQUIPMENT_PRESENT', !!capitalEquipment)

  return {
    season_id: Number(season.id),
    center_code: Number(center.code),
    equipment_type_id: Number(capitalEquipment.id),
    equipment_name: String(capitalEquipment.name || capitalEquipment.code || capitalEquipment.id),
  }
}

async function createSupplier(token, runId) {
  const supplierCode = 99100000 + (runId % 800000)
  const supplierName = `E2E Supplier ${runId}`
  const created = await api('/suppliers', {
    method: 'POST',
    body: JSON.stringify({
      code: supplierCode,
      name: supplierName,
      activity: 'Owned vs rental execution flow',
      phone: '01000000000',
      payment_terms: 30,
      supplier_type: 'supplier',
      notes: `RUN:${runId}`,
    }),
  }, token)

  assertStep('CREATE_SUPPLIER', created.res.ok && created.data?.success, `status=${created.res.status}`)
  return { supplierCode, supplierName }
}

async function addTransaction(token, supplierCode, body, label) {
  const result = await api(`/suppliers/${supplierCode}/transactions`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, token)

  assertStep(label, result.res.ok && result.data?.success, `status=${result.res.status}${result.data?.error ? ` error=${result.data.error}` : ''}`)
  return result
}

async function run() {
  const runId = Date.now()
  console.log(`RUN_ID ${runId}`)

  const token = await login()
  const dims = await loadDims(token)
  const bankAccount = await ensureBankAccount(token, runId)
  const { supplierCode, supplierName } = await createSupplier(token, runId)

  const draftWithoutDims = await api(`/suppliers/${supplierCode}/transactions`, {
    method: 'POST',
    body: JSON.stringify({
      transaction_date: new Date().toISOString().slice(0, 10),
      entry_type: 'د',
      amount: 500,
      document_type: 'أخرى',
      expense_category: 'Smoke Draft',
      notes: `DRAFT_NO_DIMS:${runId}`,
      status: 'draft',
    }),
  }, token)
  assertStep('CREATE_DRAFT_WITHOUT_DIMS', draftWithoutDims.res.ok && draftWithoutDims.data?.success, `status=${draftWithoutDims.res.status}`)

  await addTransaction(token, supplierCode, {
    transaction_date: new Date().toISOString().slice(0, 10),
    entry_type: 'د',
    amount: 120000,
    document_type: 'فاتورة',
    expense_category: 'معدات مملوكة',
    equipment_type_id: dims.equipment_type_id,
    equipment_usage_mode: 'owned',
    quantity: 1,
    unit: 'قطعة',
    unit_price: 120000,
    notes: `OWNED:${runId}`,
    season_id: dims.season_id,
    center_code: dims.center_code,
    status: 'posted',
  }, 'POST_OWNED_EQUIPMENT')

  await addTransaction(token, supplierCode, {
    transaction_date: new Date().toISOString().slice(0, 10),
    entry_type: 'د',
    amount: 7000,
    document_type: 'فاتورة',
    expense_category: 'معدات إيجار',
    equipment_type_id: dims.equipment_type_id,
    equipment_usage_mode: 'rental',
    quantity: 1,
    unit: 'يوم',
    unit_price: 7000,
    notes: `RENTAL:${runId}`,
    season_id: dims.season_id,
    center_code: dims.center_code,
    status: 'posted',
  }, 'POST_RENTAL_EQUIPMENT')

  await addTransaction(token, supplierCode, {
    transaction_date: new Date().toISOString().slice(0, 10),
    entry_type: 'م',
    amount: 5000,
    document_type: 'تحويل بنكي',
    expense_category: 'سداد مورد',
    financial_account_id: Number(bankAccount.id),
    notes: `PAYMENT:${runId}`,
    season_id: dims.season_id,
    center_code: dims.center_code,
    status: 'posted',
  }, 'POST_SUPPLIER_PAYMENT')

  const statement = await api(`/suppliers/${supplierCode}/statement?page=1&size=200`, {}, token)
  assertStep('LOAD_STATEMENT', statement.res.ok && statement.data?.success, `status=${statement.res.status}`)

  const rows = statement.data?.data || []
  const ownedRow = rows.find((row) => String(row.notes || '').includes(`OWNED:${runId}`))
  const rentalRow = rows.find((row) => String(row.notes || '').includes(`RENTAL:${runId}`))
  const paymentRow = rows.find((row) => String(row.notes || '').includes(`PAYMENT:${runId}`))
  const draftRow = rows.find((row) => String(row.notes || '').includes(`DRAFT_NO_DIMS:${runId}`))

  assertStep('OWNED_ROW_PRESENT', !!ownedRow)
  assertStep('RENTAL_ROW_PRESENT', !!rentalRow)
  assertStep('PAYMENT_ROW_PRESENT', !!paymentRow)
  assertStep('DRAFT_ROW_PRESENT', !!draftRow)
  assertStep('OWNED_USAGE_MODE_RECORDED', ownedRow?.equipment_usage_mode === 'owned', `mode=${ownedRow?.equipment_usage_mode}`)
  assertStep('RENTAL_USAGE_MODE_RECORDED', rentalRow?.equipment_usage_mode === 'rental', `mode=${rentalRow?.equipment_usage_mode}`)
  assertStep('PAYMENT_ACCOUNT_RECORDED', Number(paymentRow?.financial_account_id) === Number(bankAccount.id), `account=${paymentRow?.financial_account_id}`)
  assertStep('POSTED_JOURNALS_CREATED', !!ownedRow?.journal_entry_id && !!rentalRow?.journal_entry_id && !!paymentRow?.journal_entry_id)

  const assets = await api('/assets', {}, token)
  assertStep('LOAD_ASSETS', assets.res.ok && assets.data?.success, `status=${assets.res.status}`)
  const assetRows = assets.data?.data || []
  const ownedAsset = assetRows.find((row) => Number(row.supplier_transaction_id) === Number(ownedRow?.id))
  const rentalAsset = assetRows.find((row) => Number(row.supplier_transaction_id) === Number(rentalRow?.id))
  assertStep('OWNED_CREATED_FIXED_ASSET', !!ownedAsset, `assetId=${ownedAsset?.id || '—'}`)
  assertStep('RENTAL_DID_NOT_CREATE_FIXED_ASSET', !rentalAsset)

  const treasuryPayments = await api(`/treasury/supplier-payments?supplier_code=${supplierCode}`, {}, token)
  assertStep('LOAD_TREASURY_SUPPLIER_PAYMENTS', treasuryPayments.res.ok && treasuryPayments.data?.success, `status=${treasuryPayments.res.status}`)
  const mirroredPayment = (treasuryPayments.data?.data || []).find((row) => Number(row.amount) === 5000)
  assertStep('PAYMENT_MIRRORED_TO_TREASURY', !!mirroredPayment)

  const summary = await api(`/suppliers/${supplierCode}/summary`, {}, token)
  assertStep('LOAD_SUPPLIER_SUMMARY', summary.res.ok && summary.data?.success, `status=${summary.res.status}`)
  const summaryData = summary.data?.data || {}
  assertStep('SUPPLIER_BALANCE_EXPECTED', Number(summaryData.open_balance) === 122000, `open_balance=${summaryData.open_balance}`)
  assertStep('PAYMENT_COUNT_UPDATED', Number(summaryData.payments_count) >= 1, `payments_count=${summaryData.payments_count}`)

  console.log('RESULT')
  console.log(JSON.stringify({
    supplierCode,
    supplierName,
    bankAccountId: bankAccount.id,
    equipmentTypeId: dims.equipment_type_id,
    equipmentName: dims.equipment_name,
    ownedTransactionId: ownedRow?.id ?? null,
    rentalTransactionId: rentalRow?.id ?? null,
    paymentTransactionId: paymentRow?.id ?? null,
    ownedJournalEntryId: ownedRow?.journal_entry_id ?? null,
    rentalJournalEntryId: rentalRow?.journal_entry_id ?? null,
    paymentJournalEntryId: paymentRow?.journal_entry_id ?? null,
    ownedAssetId: ownedAsset?.id ?? null,
    pagesUrl: `https://feature-posting-engine-v2.agri-nile-flow-lake.pages.dev/suppliers/${supplierCode}`,
  }, null, 2))
}

run().catch((error) => {
  console.error('EXECUTION_FAILED', error.message)
  process.exit(1)
})