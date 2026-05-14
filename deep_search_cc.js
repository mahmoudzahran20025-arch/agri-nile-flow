const fs = require('fs');

const files = [
  'نواة_المستقبل_2025-2026.json',
  'مخازن_نواة_المستقبل_2025-2026.json',
  '.gemini/antigravity/brain/8681556d-a49a-4be0-a0b7-b2741785eeba/scratch/excel_data_dump.json'
];

files.forEach(f => {
  console.log(`\n=== Analyzing: ${f} ===`);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  
  // Look for any object containing "فدان" or "المساحة"
  function deepSearch(obj, path = '') {
    if (!obj || typeof obj !== 'object') return;
    
    if (Array.isArray(obj)) {
      obj.slice(0, 100).forEach((item, i) => deepSearch(item, `${path}[${i}]`));
    } else {
      const keys = Object.keys(obj);
      for (const k of keys) {
        if (k.includes('فدان') || k.includes('مساحة') || k.includes('المساحة')) {
          console.log(`FOUND at ${path}.${k}:`, obj[k]);
        }
        // If the value is a string and contains "فدان"
        if (typeof obj[k] === 'string' && (obj[k].includes('فدان') || obj[k].includes('مساحة'))) {
           console.log(`FOUND VALUE at ${path}.${k}:`, obj[k]);
        }
        // Limit recursion depth to avoid huge output
        if (path.split('.').length < 5) {
          deepSearch(obj[k], `${path}.${k}`);
        }
      }
    }
  }
  
  deepSearch(data);
});
