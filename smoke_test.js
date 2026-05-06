const BASE = 'https://agri-nile-flow.mahm-zahran22.workers.dev/api';

async function run() {
  const lr = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@nawa.eg', password: 'Admin@2025', company_id: 1 }),
  });
  const ld = await lr.json();
  if (!ld.data?.token) { console.log('LOGIN FAILED', JSON.stringify(ld)); return; }
  const token = ld.data.token;
  console.log('LOGIN OK —', ld.data.user?.full_name ?? 'user');
  const H = { Authorization: 'Bearer ' + token };

  const tests = [
    ['/config/equipment_types',            'EQUIP_TYPES (new endpoint)'],
    ['/assets',                            'ASSETS (+journal_entry_id)'],
    ['/gl/orphans?limit=5',                'GL_UNBALANCED_ENTRIES (redesigned)'],
    ['/gl/reconciliation/integrity',       'GL_RECONCILE_INTEGRITY'],
    ['/suppliers?limit=5',                 'SUPPLIERS (enriched fields)'],
    ['/suppliers/aging',                   'SUPPLIERS_AGING_SUMMARY'],
  ];

  let pass = 0, fail = 0;
  for (const [path, label] of tests) {
    try {
      const r = await fetch(BASE + path, { headers: H });
      const d = await r.json();
      const extra =
        d.total != null      ? 'total=' + d.total :
        d.data?.length != null ? 'count=' + d.data.length :
        d.rows?.length != null ? 'rows=' + d.rows.length : '';
      const ok = d.success;
      if (ok) pass++; else fail++;
      console.log((ok ? 'PASS' : 'FAIL') + ' [' + r.status + '] ' + label + ' ' + extra);
    } catch (e) {
      fail++;
      console.log('ERR  ' + label + ' — ' + e.message);
    }
  }
  console.log('\n--- ' + pass + '/' + (pass + fail) + ' passed ---');
}

run().catch(e => console.error('RUN_ERR', e));
