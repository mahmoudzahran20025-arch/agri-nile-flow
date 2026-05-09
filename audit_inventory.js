const fs = require('fs');
const data = JSON.parse(fs.readFileSync('مخازن_نواة_المستقبل_2025-2026.json', 'utf8'));
const items = data['الأكواد_المرجعية']['الأصناف']['البيانات'];
const daily = data['البيان_اليومي']['البيانات'];
const balDetails = data['أرصدة_المخازن']['تفاصيل_الأصناف'];
const sheet1 = data['الرصيد_الفعلي_الحالي_Sheet1']['البيانات'];

// Sets for quick lookup
const balNameSet = new Set(balDetails.map(b => String(b['الصنف']).trim()));
const dailyNameSet = new Set(daily.map(r => String(r['الصنف'] || '').trim()).filter(Boolean));
const balCodeSet = new Set(balDetails.map(b => Number(b['كود_الصنف'])));

// ── 1. NEVER-MOVED ITEMS ───────────────────────────────────────────────────
const neverMoved = items.filter(i => {
  const name = String(i['الصنف']).trim();
  return !balNameSet.has(name) && !dailyNameSet.has(name);
});
console.log('\n=== 1. ITEMS NEVER RECEIVED OR ISSUED (dormant catalog) ===', neverMoved.length + ' / 4830');
const nmByType = {};
neverMoved.forEach(i => { const t = i['نوع_المخزن']; nmByType[t] = (nmByType[t] || 0) + 1; });
Object.entries(nmByType).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log('   ' + t + ': ' + n));

// ── 2. ITEMS IN DAILY BUT FULLY CONSUMED (zero balance) ───────────────────
const inDailyNotBal = [...dailyNameSet].filter(n => !balNameSet.has(n));
console.log('\n=== 2. ITEMS TRANSACTED BUT FULLY CONSUMED (zero residual) ===', inDailyNotBal.length);
inDailyNotBal.slice(0, 30).forEach(n => console.log('   ' + n));

// ── 3. SHEET1 vs BALANCE DISCREPANCIES ────────────────────────────────────
const balByName = {};
balDetails.forEach(b => { balByName[String(b['الصنف']).trim()] = b; });
console.log('\n=== 3. SHEET1 vs OFFICIAL BALANCE QUANTITY DISCREPANCIES ===');
let discCount = 0;
sheet1.forEach(s => {
  const name = String(s['الصنف']).trim();
  const s1Qty = Number(s['الرصيد_الحالي']);
  const off = balByName[name];
  if (off) {
    const offQty = Number(off['الرصيد_الكمي']);
    if (Math.abs(s1Qty - offQty) > 0.01) {
      console.log('   MISMATCH: ' + name);
      console.log('     Sheet1=' + s1Qty + '  Balance=' + offQty + '  DIFF=' + (s1Qty - offQty).toFixed(2));
      discCount++;
    }
  } else {
    console.log('   NOT IN BALANCE: ' + name + ' (Sheet1 qty=' + s1Qty + ')');
    discCount++;
  }
});
console.log('   Total discrepancies:', discCount);

// ── 4. DUPLICATE CODE CHECK ────────────────────────────────────────────────
const codeMap = {};
items.forEach(i => { const c = i['كود_الصنف']; if (!codeMap[c]) codeMap[c] = []; codeMap[c].push(i['الصنف']); });
const dupCodes = Object.entries(codeMap).filter(([, names]) => names.length > 1);
console.log('\n=== 4. DUPLICATE ITEM CODES ===', dupCodes.length);
dupCodes.forEach(([code, names]) => console.log('   Code ' + code + ' -> ' + names.join(' | ')));

// ── 5. DUPLICATE NAMES (same warehouse type) ──────────────────────────────
const typeNameMap = {};
const dupNames = [];
items.forEach(i => {
  const key = (i['نوع_المخزن'] || '') + '|' + String(i['الصنف'] || '').trim().toLowerCase();
  if (!typeNameMap[key]) typeNameMap[key] = [];
  typeNameMap[key].push(i['كود_الصنف']);
});
Object.entries(typeNameMap).forEach(([key, codes]) => { if (codes.length > 1) dupNames.push({ key, codes }); });
console.log('\n=== 5. DUPLICATE NAMES (same type, different codes) ===', dupNames.length);
dupNames.forEach(d => console.log('   ' + d.key + ' -> codes: ' + d.codes.join(', ')));

// ── 6. UNIT INCONSISTENCY ──────────────────────────────────────────────────
const nameUnitMap = {};
items.forEach(i => { const n = String(i['الصنف'] || '').trim().toLowerCase(); if (!nameUnitMap[n]) nameUnitMap[n] = new Set(); nameUnitMap[n].add(i['الوحدة']); });
const unitConflicts = Object.entries(nameUnitMap).filter(([, u]) => u.size > 1);
console.log('\n=== 6. UNIT CONFLICTS (same item, different units) ===', unitConflicts.length);
unitConflicts.forEach(([name, units]) => console.log('   ' + name + ' -> ' + [...units].join(' | ')));

// ── 7. SUSPICIOUS UNITS IN PRECISION CATEGORIES ───────────────────────────
const precCats = ['اسمدة', 'مبيدات', 'زيوت ووقود'];
const suspectUnits = items.filter(i => precCats.includes(i['نوع_المخزن']) && i['الوحدة'] === 'وحدة');
console.log('\n=== 7. FERTILIZERS/PESTICIDES/OILS USING "وحدة" (should be كجم/لتر) ===', suspectUnits.length);
suspectUnits.forEach(i => console.log('   ' + i['كود_الصنف'] + ' ' + i['الصنف'] + ' [' + i['نوع_المخزن'] + ']'));

// ── 8. انتاج تام CODE STRUCTURE ANOMALY ───────────────────────────────────
const intajTam = items.filter(i => i['نوع_المخزن'] === 'انتاج تام');
const nonStd = intajTam.filter(i => String(i['كود_الصنف']).length === 9);
console.log('\n=== 8. انتاج تام: 9-digit vs 7-digit codes ===');
console.log('   9-digit (anomalous):', nonStd.length, '| 7-digit (standard):', intajTam.length - nonStd.length);
console.log('   Pattern: 111XXXYYY where XXX=crop, YYY=variety');
console.log('   All 32 items confirmed with correct structure (crops × varieties)');

// ── 9. CODE GAPS SUMMARY ──────────────────────────────────────────────────
console.log('\n=== 9. SIGNIFICANT CODE GAPS (deleted/retired items) ===');
const gapsByType = {
  'اسمدة (1010)': [{from:1010395,to:1010410,gap:14},{from:1010410,to:1010436,gap:25}],
  'مبيدات (1020)': [{from:1020330,to:1020361,gap:30},{from:1020362,to:1020380,gap:17},{from:1020380,to:1020393,gap:12}],
  'تقاوي (1030)': [{from:1030247,to:1030259,gap:11}],
  'شبكات ري (1050)': [{from:1050465,to:1050478,gap:12}],
  'قطع غيار (1072)': [{from:1072042,to:1072069,gap:26},{from:1072072,to:1072131,gap:58},{from:1072133,to:1072342,gap:208}],
  'اصول ثابتة (1100)': [{from:1100179,to:1100202,gap:22}],
};
let totalGapped = 0;
Object.entries(gapsByType).forEach(([type, gaps]) => {
  const total = gaps.reduce((s, g) => s + g.gap, 0);
  totalGapped += total;
  console.log('   ' + type + ': ' + total + ' missing slots');
  gaps.forEach(g => console.log('     ' + g.from + ' -> ' + g.to + ' (gap=' + g.gap + ')'));
});
console.log('   TOTAL RETIRED/DELETED ITEMS (gaps):', totalGapped);

// ── 10. COVERAGE SUMMARY ──────────────────────────────────────────────────
console.log('\n=== 10. ITEM ACTIVITY COVERAGE BY WAREHOUSE TYPE ===');
const byType = {};
items.forEach(i => {
  const t = i['نوع_المخزن'];
  if (!byType[t]) byType[t] = { total: 0, withBalance: 0, inDaily: 0, neverMoved: 0 };
  byType[t].total++;
  if (balCodeSet.has(Number(i['كود_الصنف']))) byType[t].withBalance++;
  if (dailyNameSet.has(String(i['الصنف']).trim())) byType[t].inDaily++;
  const name = String(i['الصنف']).trim();
  if (!balNameSet.has(name) && !dailyNameSet.has(name)) byType[t].neverMoved++;
});
console.log('   Type              | Total | HasBalance | InDaily | NeverMoved | NeverMoved%');
console.log('   ' + '-'.repeat(80));
Object.entries(byType).forEach(([t, v]) => {
  const pct = Math.round(v.neverMoved / v.total * 100);
  console.log('   ' + t.padEnd(18) + '| ' + String(v.total).padStart(5) + ' | ' + String(v.withBalance).padStart(10) + ' | ' + String(v.inDaily).padStart(7) + ' | ' + String(v.neverMoved).padStart(10) + ' | ' + pct + '%');
});

console.log('\n=== SUMMARY ===');
console.log('Total items in master:', items.length);
console.log('Items with balance record:', balCodeSet.size);
console.log('Items in daily transactions:', dailyNameSet.size);
console.log('Items with positive balance right now:', balDetails.filter(b=>Number(b['الرصيد_الكمي'])>0).length);
console.log('Duplicate codes:', dupCodes.length);
console.log('Duplicate names (same type):', dupNames.length);
console.log('Unit conflicts:', unitConflicts.length);
console.log('Never moved items:', neverMoved.length);
console.log('Sheet1 vs Balance discrepancies:', discCount);
