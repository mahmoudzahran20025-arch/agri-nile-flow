const BASE = 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'

async function run() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@nawa.eg', password: 'Admin@2025', company_id: 1 }),
  })
  const login = await loginRes.json()
  if (!login?.data?.token) {
    console.error('login failed', login)
    process.exit(1)
  }

  const token = login.data.token
  const ids = [4521, 4522, 4519, 1]

  for (const id of ids) {
    const res = await fetch(`${BASE}/gl/entries/${id}/trace`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    console.log(
      JSON.stringify({
        id,
        http: res.status,
        success: data?.success,
        hasData: !!data?.data,
        hasTrace: data?.data?.has_trace,
        hasSourceEvent: !!data?.data?.source_event,
        hasSourceDocument: !!data?.data?.source_document,
        error: data?.error || null,
      })
    )
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
