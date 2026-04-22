const XLSX = require('xlsx');

// الأكواد التي أحتاج أسماءها الصحيحة من Excel
const TARGET_ITEM_CODES = [
  1010002,1010004,1010006,1010023,1010060,1010062,1010066,1010071,
  1010074,1010075,1010095,1010132,1010189,1010327,1010366,1010374,
  1010436,1010437,1010438,1010439,1010449,
  1020259,1020288,1020361,1020362,1020380,1020393,1020401,
  1030002,1030003,1030008,1030229,1030233,1030234,1030259,1030260,
  1030264,1030265,1030266,1030267,1030274,1030277,
  1040001,
  1050092,1050095,1050149,1050197,1050316,1050364,1050401,
  1070010,1070238,1070245,1070317,1070786,1070844,
  1080035,
  1090043,1090168,1090228,1090230
];

const wb = XLSX.readFile('مخازن نواة المستقبل2025-2026.xlsx', {raw: false});
const ws = wb.Sheets['الكود'];
const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:false});

// Build item map from ALL rows
const itemMap = {};
rows.forEach(r => {
  // Look for pattern: code (numeric 7-digit starting with 10), name, unit, warehouse
  for (let i = 0; i < r.length - 2; i++) {
    const cell = String(r[i]).trim();
    if (/^10[0-9]{5}$/.test(cell)) {
      const name = String(r[i+1]).trim();
      const unit = String(r[i+2]).trim();
      if (name && unit && !name.match(/^[0-9]+$/) && unit.length < 10) {
        itemMap[parseInt(cell)] = { name, unit };
      }
    }
  }
});

console.log('\n=== أسماء الأصناف الصحيحة ===');
TARGET_ITEM_CODES.forEach(code => {
  const item = itemMap[code];
  if (item) {
    console.log(`(${code}, 1, '${item.name}', '${item.unit}'),`);
  } else {
    console.log(`-- لم يوجد: ${code}`);
  }
});

// مبيدات - ابحث عنها
console.log('\n=== مبيدات ===');
rows.forEach(r => {
  for (let i = 0; i < r.length - 1; i++) {
    const cell = String(r[i]).trim();
    if (/^102[0-9]{4}$/.test(cell)) {
      const name = String(r[i+1]).trim();
      const unit = String(r[i+2]).trim();
      if (name && !name.match(/^[0-9]+$/)) {
        console.log(`  ${cell}: ${name} (${unit})`);
      }
    }
  }
});

// تقاوي
console.log('\n=== تقاوي وبذور ===');
rows.forEach(r => {
  for (let i = 0; i < r.length - 1; i++) {
    const cell = String(r[i]).trim();
    if (/^103[0-9]{4}$/.test(cell)) {
      const name = String(r[i+1]).trim();
      const unit = String(r[i+2]).trim();
      if (name && !name.match(/^[0-9]+$/)) {
        console.log(`  ${cell}: ${name} (${unit})`);
      }
    }
  }
});

// شبكات ري
console.log('\n=== شبكات ري ===');
rows.forEach(r => {
  for (let i = 0; i < r.length - 1; i++) {
    const cell = String(r[i]).trim();
    if (/^105[0-9]{4}$/.test(cell)) {
      const name = String(r[i+1]).trim();
      const unit = String(r[i+2]).trim();
      if (name && !name.match(/^[0-9]+$/)) {
        console.log(`  ${cell}: ${name} (${unit})`);
      }
    }
  }
});

// قطع غيار
console.log('\n=== قطع غيار وزيوت ومتنوعات ===');
rows.forEach(r => {
  for (let i = 0; i < r.length - 1; i++) {
    const cell = String(r[i]).trim();
    if (/^1(04|05|07|08|09)[0-9]{4}$/.test(cell)) {
      const name = String(r[i+1]).trim();
      const unit = String(r[i+2]).trim();
      if (name && !name.match(/^[0-9]+$/)) {
        console.log(`  ${cell}: ${name} (${unit})`);
      }
    }
  }
});
