const fs = require('fs');
const data = JSON.parse(fs.readFileSync('نواة_المستقبل_2025-2026.json', 'utf8'));

function search(obj, path = '') {
  if (!obj || typeof obj !== 'object') return;
  
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => search(v, `${path}[${i}]`));
  } else {
    for (const k in obj) {
      if (typeof obj[k] === 'number' && (obj[k] === 100 || obj[k] === 75 || obj[k] === 125)) {
         // Check if nearby keys indicate area
         if (k.toLowerCase().includes('area') || k.includes('مساحة') || k.includes('فدان') || path.includes('مركز')) {
           console.log(`POTENTIAL AREA at ${path}.${k}:`, obj[k]);
         }
      }
      search(obj[k], `${path}.${k}`);
    }
  }
}

search(data);
