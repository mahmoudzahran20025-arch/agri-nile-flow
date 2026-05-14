const fs = require('fs');

const inventoryRaw = JSON.parse(fs.readFileSync('مخازن_نواة_المستقبل_2025-2026.json', 'utf8')).البيانات_الرئيسية.المعاملات;
const suppliersRaw = JSON.parse(fs.readFileSync('نواة_المستقبل_2025-2026.json', 'utf8')).البيان_الرئيسي.المعاملات;
const cashRaw = JSON.parse(fs.readFileSync('خزينة_نواة_المستقبل_2025-2026.json', 'utf8')).البيان_الرئيسي.المعاملات;
const excelDump = JSON.parse(fs.readFileSync('.gemini/antigravity/brain/8681556d-a49a-4be0-a0b7-b2741785eeba/scratch/excel_data_dump.json', 'utf8'));

const CENTER_MAP = {
  "718": "1006001", "719": "1006002", "720": "1006003",
  "722": "1006004", "723": "1006005", "1044": "1006006",
  "1047": "1006007", "1048": "1006008", "1049": "1006009",
  "1050": "1006010", "ادارية": "1006011", "بوفيه": "1006011", "لودر": "1006011"
};

function getCenterData(list, centerKey) {
  const stats = {};
  list.forEach(t => {
    const text = t[centerKey];
    if (text) {
      stats[text] = (stats[text] || 0) + 1;
    }
  });
  return stats;
}

console.log('\n--- COST CENTER MASTER DATA (JSON) ---');
const codesSheet = excelDump['الكود'];
const pivots = codesSheet.filter(r => r['الكود_1']).map(r => ({ code: r['الكود_1'], name: r['البيفوت'] }));
console.log('Pivots in Reference:', pivots);

// Find Area
const bian = excelDump['البيان'];
const areasMap = new Map();
bian.forEach(r => {
  const code = r['__EMPTY_11'];
  const unit = r['__EMPTY_15'];
  const qty = r['__EMPTY_16'];
  if (code && unit && unit.trim() === 'فدان' && qty > 0) {
    // Collect all areas seen for this code
    if (!areasMap.has(String(code))) areasMap.set(String(code), new Set());
    areasMap.get(String(code)).add(qty);
  }
});

console.log('\n--- ESTIMATED AREAS FROM TASKS ---');
areasMap.forEach((set, code) => {
  console.log(`Code ${code}: Values seen ${Array.from(set).join(', ')}`);
});

console.log('\n--- UNRESOLVED LABELS IN TRANSACTIONS ---');
function audit(list, name, centerKey) {
  const labels = {};
  list.forEach(t => {
    const text = t[centerKey];
    let found = false;
    if (text) {
      for (const k in CENTER_MAP) {
        if (String(text).includes(k)) { found = true; break; }
      }
    }
    if (!found) {
      const label = text || 'MISSING';
      labels[label] = (labels[label] || 0) + 1;
    }
  });
  console.log(`${name}:`, labels);
}

audit(inventoryRaw, 'Inventory', 'مركز التكلفة');
audit(suppliersRaw, 'Suppliers', 'البيفوت');
audit(cashRaw, 'Cash', 'المركز');
