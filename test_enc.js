// Test Arabic encoding via execSync --command
const { execSync } = require('child_process');
const { spawnSync } = require('child_process');

const DB = 'agri-nile-flow-data-lake';
const sql = "UPDATE suppliers SET notes='ENCTEST_عيد_شعبان' WHERE company_id=1 AND code=20300086;";

console.log('Testing spawnSync approach...');
const r = spawnSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--command', sql], {
  encoding: 'utf8',
  cwd: __dirname,
  timeout: 30000,
  stdio: ['pipe', 'pipe', 'pipe'],
  input: '',
  shell: true
});

if (r.error) { console.log('spawnSync error:', r.error.message); }
else { console.log('Status:', r.status, 'stdout:', (r.stdout||'').slice(0,100)); }

// Now check what was stored
setTimeout(() => {
  console.log('Checking stored value...');
  const r2 = spawnSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json',
    '--command', "SELECT notes, hex(substr(notes,9,6)) as hx FROM suppliers WHERE company_id=1 AND code=20300086"], {
    encoding: 'utf8',
    cwd: __dirname,
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
    input: '',
    shell: true
  });
  if (r2.error) { console.log('Error:', r2.error.message); }
  else {
    try {
      const data = JSON.parse(r2.stdout);
      const row = data[0]?.results?.[0];
      console.log('notes:', row?.notes);
      console.log('hex(after ENCTEST_):', row?.hx);
      console.log('Expected hex for عيد (UTF-8): D8B9D98AD8AF');
      console.log('Got double-encoded (bad): C398C2B9...');
    } catch(e) { console.log('Parse err:', r2.stdout.slice(0,200)); }
  }
}, 1000);
