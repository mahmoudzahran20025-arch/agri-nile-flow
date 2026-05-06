const BASE = 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'

async function run() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@nawa.eg', password: 'Admin@2025', company_id: 1 }),
  }).then(r => r.json())

  const token = login?.data?.token
  if (!token) throw new Error('login failed')

  const headers = { Authorization: `Bearer ${token}` }
  const supplierCode = 98788172

  const all = await fetch(`${BASE}/reports/supplier-payments?supplier_code=${supplierCode}`, { headers }).then(r => r.json())
  const txOnly = await fetch(`${BASE}/reports/supplier-payments?supplier_code=${supplierCode}&source_table=supplier_transactions`, { headers }).then(r => r.json())
  const invOnly = await fetch(`${BASE}/reports/supplier-payments?supplier_code=${supplierCode}&source_table=supplier_invoices`, { headers }).then(r => r.json())

  const countSource = (rows) => (rows || []).reduce((acc, r) => {
    const key = r.source_table || 'unknown'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  console.log('all.success', all.success, 'legacy', all.legacy_coverage?.coverage_rate_pct)
  console.log('all.by_source', countSource(all.data))
  console.log('tx.success', txOnly.success, 'tx.by_source', countSource(txOnly.data))
  console.log('inv.success', invOnly.success, 'inv.by_source', countSource(invOnly.data))
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
