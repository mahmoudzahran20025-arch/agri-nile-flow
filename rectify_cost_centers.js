const fs = require('fs');
const { execSync } = require('child_process');

const DB_NAME = 'agri-nile-flow-data-lake';

function runD1(sql) {
  const compactSql = sql.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --command "${compactSql}"`;
  return execSync(cmd, { encoding: 'utf8' });
}

async function fixMaster() {
  console.log('--- Phase 1: Master Data Alignment ---');
  
  const sql = `
    -- Update Areas to 100 (as per task evidence)
    UPDATE fields SET area_feddan = 100.0 WHERE company_id = 1 AND center_code BETWEEN 1006001 AND 1006010;
    
    -- Sync Names with JSON (Standardizing Hamzas/Spaces)
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 718 بوستر129' WHERE code = '1006001';
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 719 بوستر129' WHERE code = '1006002';
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 720 بوستر129' WHERE code = '1006003';
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 722 بوستر129' WHERE code = '1006004';
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 723 بوستر129' WHERE code = '1006005';
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 1044 بوستر128' WHERE code = '1006006';
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 1047 بوستر128' WHERE code = '1006007';
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 1048 بوستر128' WHERE code = '1006008';
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 1049 بوستر128' WHERE code = '1006009';
    UPDATE cost_centers SET name_ar = ' بيفوت رقم 1050 بوستر128' WHERE code = '1006010';
    UPDATE cost_centers SET name_ar = ' ادارية ارض الدلتا الجديدة' WHERE code = '1006011';

    -- Also sync field names
    UPDATE fields SET name = (SELECT name_ar FROM cost_centers WHERE cost_centers.code = fields.center_code)
    WHERE company_id = 1 AND center_code >= 1006001;

    -- Purge Legacy/Orphans
    DELETE FROM cost_centers WHERE company_id = 1 AND code IN ('210101', '2104');
  `;

  fs.writeFileSync('temp_master_fix.sql', sql);
  execSync(`npx wrangler d1 execute ${DB_NAME} --remote --yes --file temp_master_fix.sql`, { stdio: 'inherit' });
  fs.unlinkSync('temp_master_fix.sql');
}

async function fixTransactions() {
  console.log('\n--- Phase 2: Transaction Link Repair ---');
  
  // Mapping labels to codes for parsing
  const map = {
    "718": "1006001", "719": "1006002", "720": "1006003",
    "722": "1006004", "723": "1006005", "1044": "1006006",
    "1047": "1006007", "1048": "1006008", "1049": "1006009",
    "1050": "1006010"
  };

  let treasuryUpdates = [];
  for (const pivot in map) {
    treasuryUpdates.push(`UPDATE cash_transactions SET center_code = '${map[pivot]}' WHERE center_code IS NULL AND narration LIKE '%${pivot}%';`);
    treasuryUpdates.push(`UPDATE supplier_transactions SET center_code = '${map[pivot]}' WHERE center_code IS NULL AND description LIKE '%${pivot}%';`);
  }

  // Fallback for general admin payments
  treasuryUpdates.push(`UPDATE cash_transactions SET center_code = '1006011' WHERE center_code IS NULL AND (narration LIKE '%ادارية%' OR narration LIKE '%بوفيه%' OR narration LIKE '%مكتب%');`);

  fs.writeFileSync('temp_txn_repair.sql', treasuryUpdates.join('\n'));
  execSync(`npx wrangler d1 execute ${DB_NAME} --remote --yes --file temp_txn_repair.sql`, { stdio: 'inherit' });
  fs.unlinkSync('temp_txn_repair.sql');
}

async function run() {
  await fixMaster();
  await fixTransactions();
  console.log('\nRectification complete.');
}

run();
