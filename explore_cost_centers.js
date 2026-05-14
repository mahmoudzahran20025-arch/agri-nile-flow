const fs = require('fs');

const files = {
  inventory: 'مخازن_نواة_المستقبل_2025-2026.json',
  suppliers: 'نواة_المستقبل_2025-2026.json'
};

function explore(filePath) {
  console.log(`\n=== Exploring: ${filePath} ===`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const refs = data['الأكواد_المرجعية'] || data['الأكواد_المرجعية'];
  if (refs) {
    console.log('Reference keys:', Object.keys(refs));
    // Look for anything related to cost centers, pivots, or centers
    const ccKeys = Object.keys(refs).filter(k => k.includes('مركز') || k.includes('بيفوت') || k.includes('مركز_التكلفة'));
    ccKeys.forEach(k => {
      console.log(`\n--- Key: ${k} ---`);
      const val = refs[k];
      if (Array.isArray(val)) {
        console.log(`Count: ${val.length}`);
        console.log('Sample:', JSON.stringify(val.slice(0, 3), null, 2));
      } else if (typeof val === 'object') {
         console.log('Keys:', Object.keys(val));
         const subKey = Object.keys(val).find(sk => Array.isArray(val[subKey]));
         if (subKey) console.log('Sample from subkey:', JSON.stringify(val[subKey].slice(0, 2), null, 2));
      }
    });
  }
}

explore(files.inventory);
explore(files.suppliers);
