const fs = require('fs');

const data = JSON.parse(fs.readFileSync('.gemini/antigravity/brain/8681556d-a49a-4be0-a0b7-b2741785eeba/scratch/excel_data_dump.json', 'utf8'));

const results = [];

function search(obj, path = '') {
  if (!obj || typeof obj !== 'object') return;
  
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => search(v, `${path}[${i}]`));
  } else {
    for (const k in obj) {
      const val = obj[k];
      if (typeof val === 'string' && (val.includes('مساحة') || val.includes('فدان'))) {
        results.push({ path: `${path}.${k}`, value: val, context: obj });
      }
      if (path.split('.').length < 6) search(val, `${path}.${k}`);
    }
  }
}

search(data);
console.log(`Found ${results.length} occurrences.`);
// Filter for unique contexts that look like master data
const uniqueContexts = new Set();
results.forEach(r => {
  const ctxStr = JSON.stringify(r.context);
  if (!uniqueContexts.has(ctxStr)) {
    uniqueContexts.add(ctxStr);
    console.log(`\n--- Context at ${r.path} ---`);
    console.log(r.context);
  }
});
