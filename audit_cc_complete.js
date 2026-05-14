const fs = require('fs');
const { execSync } = require('child_process');

const DB_NAME = 'agri-nile-flow-data-lake';

function runQuery(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --yes --json --command "${compact}"`;
  const out = execSync(cmd, { encoding: 'utf8' });
  return JSON.parse(out)[0].results;
}

async function audit() {
  const data = JSON.parse(fs.readFileSync('.gemini/antigravity/brain/8681556d-a49a-4be0-a0b7-b2741785eeba/scratch/excel_data_dump.json', 'utf8'));
  
  const codesSheet = data['الكود'];
  const bianSheet = data['البيان'];
  
  const jsonCenters = new Map();
  
  // 1. Extract from Codes sheet
  codesSheet.forEach(row => {
    const code = row['الكود_1'];
    const name = row['البيفوت'];
    if (code && name) {
      jsonCenters.set(String(code), { code, name: name.trim(), area: 0 });
    }
  });
  
  // 2. Extract Area from Bian sheet
  bianSheet.forEach(row => {
    const code = row['__EMPTY_11'];
    const unit = row['__EMPTY_15'];
    const qty = row['__EMPTY_16'];
    if (code && unit === 'فدان' && qty > 0) {
      const existing = jsonCenters.get(String(code));
      if (existing) {
        // Area is usually 100 or 75 for these pivots
        if (qty > existing.area) existing.area = qty;
      }
    }
  });

  console.log('--- JSON COST CENTERS (Source of Truth) ---');
  console.log(Array.from(jsonCenters.values()));

  // 3. Fetch from DB
  const dbCC = runQuery(`SELECT code, name_ar as name FROM cost_centers WHERE company_id = 1`);
  const dbFields = runQuery(`SELECT center_code, name, area_feddan as area FROM fields WHERE company_id = 1`);
  
  console.log('\n--- AUDIT RESULTS ---');
  
  const dbCCMap = new Map(dbCC.map(c => [String(c.code), c]));
  const dbFieldsMap = new Map(dbFields.map(f => [String(f.center_code), f]));
  
  jsonCenters.forEach((json, code) => {
    const dbcc = dbCCMap.get(code);
    const dbf = dbFieldsMap.get(code);
    
    if (!dbcc) {
      console.log(`[MISSING CC] Code ${code} (${json.name}) is missing from cost_centers table.`);
    } else if (dbcc.name !== json.name) {
      console.log(`[NAME MISMATCH CC] Code ${code}: JSON='${json.name}' vs DB='${dbcc.name}'`);
    }
    
    if (!dbf) {
      console.log(`[MISSING FIELD] Code ${code} (${json.name}) is missing from fields table.`);
    } else {
      if (dbf.area !== json.area) {
        console.log(`[AREA MISMATCH] Code ${code}: JSON=${json.area} vs DB=${dbf.area}`);
      }
      if (dbf.name !== json.name) {
        console.log(`[NAME MISMATCH FIELD] Code ${code}: JSON='${json.name}' vs DB='${dbf.name}'`);
      }
    }
  });
  
  // 4. Check for orphaned DB records
  dbCC.forEach(db => {
    if (!jsonCenters.has(String(db.code))) {
      console.log(`[ORPHAN DB CC] Code ${db.code} (${db.name}) exists in DB but not in JSON reference.`);
    }
  });

  // 5. Check transactions missing center_code
  console.log('\n--- TRANSACTION COVERAGE ---');
  const missingSuppliers = runQuery(`SELECT COUNT(*) as c FROM supplier_transactions WHERE center_code IS NULL AND company_id = 1`);
  const missingCash = runQuery(`SELECT COUNT(*) as c FROM cash_transactions WHERE center_code IS NULL AND company_id = 1`);
  const missingInventory = runQuery(`SELECT COUNT(*) as c FROM inventory_movements WHERE center_code IS NULL AND company_id = 1`);
  
  console.log(`Supplier Transactions missing center_code: ${missingSuppliers[0].c}`);
  console.log(`Cash Transactions missing center_code: ${missingCash[0].c}`);
  console.log(`Inventory Movements missing center_code: ${missingInventory[0].c}`);
}

audit();
