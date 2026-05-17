const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const DB = 'agri-nile-flow-data-lake';
const FILES = [
  'sql/phase3_controlled_wipe_scope_company1.sql',
  'sql/generated_phase3/01_load_coa.sql',
  'sql/generated_phase3/02_load_suppliers.sql',
  'sql/generated_phase3/03_load_treasury.sql',
  'sql/generated_phase3/04_load_items.sql',
  'sql/generated_phase3/05_load_inventory_movements.sql',
];

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s};`);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function runFile(relPath) {
  const fullPath = path.join(ROOT, relPath);
  const sql = fs.readFileSync(fullPath, 'utf8');
  const statements = splitStatements(sql);
  const chunks = chunk(statements, 100);
  console.log(`\n==> ${relPath} (${statements.length} statements, ${chunks.length} batches)`);

  for (let i = 0; i < chunks.length; i += 1) {
    const tmpPath = path.join(ROOT, 'sql', 'generated_phase3', `_tmp_batch_${i + 1}.sql`);
    fs.writeFileSync(tmpPath, chunks[i].join('\n'), 'utf8');
    try {
      execSync(`npx wrangler d1 execute ${DB} --remote --yes --file "${tmpPath}"`, {
        cwd: ROOT,
        stdio: 'inherit',
      });
    } finally {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    }
  }
}

function main() {
  for (const file of FILES) {
    runFile(file);
  }
  console.log('\nPhase 3 wipe + reseed execution completed.');
}

main();
