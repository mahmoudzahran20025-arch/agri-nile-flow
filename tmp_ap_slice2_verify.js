const BASE = 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'

async function run() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@nawa.eg', password: 'Admin@2025', company_id: 1 }),
  }).then(r => r.json())

  const token = login?.data?.token
  if (!token) throw new Error('login failed')

  const H = { Authorization: `Bearer ${token}` }
  const supplier_code = 98788172

  const payments = await fetch(`${BASE}/reports/supplier-payments?supplier_code=${supplier_code}`, { headers: H }).then(r => r.json())
  const balances = await fetch(`${BASE}/reports/suppliers-balance`, { headers: H }).then(r => r.json())

  const pSummary = (payments.summary || [])[0]
  const bRow = (balances.data || []).find(r => Number(r.code) === supplier_code)

  console.log('payments.success', payments.success)
  console.log('balances.success', balances.success)
  console.log('payments.legacy_coverage', payments.legacy_coverage)
  console.log('balances.legacy_coverage', balances.legacy_coverage)
  console.log('payments.summary.row', pSummary)
  console.log('balances.row', bRow)

  if (pSummary && bRow) {
    const same =
      Number(pSummary.total_credit) === Number(bRow.total_credit) &&
      Number(pSummary.total_debit) === Number(bRow.total_debit) &&
      Number(pSummary.balance) === Number(bRow.balance)
    console.log('projection_consistent', same)
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
