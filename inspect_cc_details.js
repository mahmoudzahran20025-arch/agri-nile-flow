const fs = require('fs');

const data = JSON.parse(fs.readFileSync('مخازن_نواة_المستقبل_2025-2026.json', 'utf8'));

console.log('--- مراكز_التكلفة (Inventory) ---');
const refs = data['الأكواد_المرجعية'];
const cc = refs['مراكز_التكلفة'];
console.log('Type:', typeof cc);
if (Array.isArray(cc)) {
  console.log('Count:', cc.length);
  console.log('Sample:', JSON.stringify(cc.slice(0, 5), null, 2));
} else {
  console.log('Keys:', Object.keys(cc));
  const subKey = Object.keys(cc).find(k => Array.isArray(cc[k]));
  if (subKey) {
    console.log(`Sample from ${subKey}:`, JSON.stringify(cc[subKey].slice(0, 5), null, 2));
  }
}

// Search for area info
console.log('\n--- Searching for Area/Feddan info across all keys ---');
function findKeys(obj, pattern) {
  for (const k in obj) {
    if (k.includes(pattern)) console.log(`Found key: ${k}`);
    if (typeof obj[k] === 'object' && obj[k] !== null) findKeys(obj[k], pattern);
  }
}
findKeys(data, 'مساحة');
findKeys(data, 'فدان');
