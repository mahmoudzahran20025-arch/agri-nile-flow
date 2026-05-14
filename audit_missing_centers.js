const fs = require('fs');

const inventory = JSON.parse(fs.readFileSync('مخازن_نواة_المستقبل_2025-2026.json', 'utf8')).البيانات_الرئيسية.المعاملات;
const suppliers = JSON.parse(fs.readFileSync('نواة_المستقبل_2025-2026.json', 'utf8')).البيان_الرئيسي[0].المعاملات;
const cash = JSON.parse(fs.readFileSync('خزينة_نواة_المستقبل_2025-2026.json', 'utf8')).البيان_الرئيسي[0].المعاملات;

const CENTER_MAP = {
  "718": "1006001", "719": "1006002", "720": "1006003",
  "722": "1006004", "723": "1006005", "1044": "1006006",
  "1047": "1006007", "1048": "1006008", "1049": "1006009",
  "1050": "1006010", "ادارية": "1006011", "بوفيه": "1006011", "لودر": "1006011"
};

function audit(list, name, centerKey) {
  const missing = [];
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
  
  console.log(`\n--- ${name} Coverage Audit ---`);
  console.log('Unresolved Center Labels:');
  console.log(labels);
}

audit(inventory, 'Inventory', 'مركز التكلفة');
audit(suppliers, 'Suppliers', 'البيفوت');
audit(cash, 'Cash', 'المركز');
