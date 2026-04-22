const XLSX = require('xlsx');

// ══════════════════════════════════════════════════════════════
//  استخراج بيانات البيفوتات والموردين والمصروفات من ملفات الإكسيل
// ══════════════════════════════════════════════════════════════

function printSection(title) {
  console.log('\n' + '═'.repeat(60));
  console.log('  ' + title);
  console.log('═'.repeat(60));
}

function parseCodesSheet(wsName, ws) {
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  // Find header rows — each table starts with a row that has code + name pattern
  const tables = [];
  let currentTable = null;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Skip completely empty rows
    if (!row.some(c => String(c).trim() !== '')) continue;
    
    // Detect header: row where col contains "كود" or "رقم"
    const rowStr = row.map(c => String(c).trim()).join('|');
    if (rowStr.includes('كود') || rowStr.includes('رقم') || rowStr.includes('اسم') || rowStr.includes('المورد')) {
      currentTable = { header: row, rows: [] };
      tables.push(currentTable);
    } else if (currentTable) {
      // Check if row has numeric code in first non-empty cell
      const nonEmpty = row.filter(c => String(c).trim() !== '');
      if (nonEmpty.length >= 2) {
        currentTable.rows.push(row);
      }
    }
  }
  return tables;
}

// ──────────────────────────────────────────────────────────────
// 1. خزينة — شيت الاكواد
// ──────────────────────────────────────────────────────────────
printSection('1. خزينة — شيت الاكواد (الموردين + المصروفات + مراكز التكلفة)');
try {
  const wb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx', {raw: false});
  console.log('الشيتات:', wb.SheetNames.join(', '));
  
  const ws = wb.Sheets['الاكواد'];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:false});
    let nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== ''));
    console.log(`\nإجمالي الصفوف غير الفارغة: ${nonEmpty.length}`);
    console.log('\n--- أول 120 صف ---');
    nonEmpty.slice(0, 120).forEach((r, i) => {
      const clean = r.map(c => String(c).trim()).filter(c => c !== '');
      if (clean.length > 0) console.log(`[${i}]`, clean.join('  |  '));
    });
  }
} catch(e) { console.error('خطأ:', e.message); }

// ──────────────────────────────────────────────────────────────
// 2. خزينة — شيت البيان (أول 80 حركة حقيقية)
// ──────────────────────────────────────────────────────────────
printSection('2. خزينة — شيت البيان (عينة الحركات الحقيقية)');
try {
  const wb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx', {raw: false});
  const ws = wb.Sheets['البيان'];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:false});
    // Find real header row (has التاريخ)
    let headerIdx = rows.findIndex(r => r.some(c => String(c).includes('التاريخ')));
    if (headerIdx >= 0) {
      console.log('\nالعناوين:', rows[headerIdx].map(c=>String(c).trim()).filter(c=>c).join(' | '));
      let realRows = rows.slice(headerIdx + 1).filter(r => r[0] && String(r[0]).trim() && !String(r[0]).includes('#'));
      console.log(`\nصفوف حقيقية: ${realRows.length}`);
      realRows.slice(0, 80).forEach((r, i) => {
        const date = String(r[0]).trim();
        const dir = String(r[1]).trim();
        const docNum = String(r[2]).trim();
        const recipient = String(r[3]).trim();
        const narr = String(r[4]).trim();
        const supplierCode = r[7] ? String(r[7]).trim() : '';
        const centerCode = r[8] ? String(r[8]).trim() : '';
        const expCode = r[9] ? String(r[9]).trim() : '';
        const amount = r[14] ? String(r[14]).trim() : '';
        const debit = r[15] ? String(r[15]).trim() : '';
        const credit = r[16] ? String(r[16]).trim() : '';
        console.log(`[${i+1}] ${date} | ${dir} | doc:${docNum} | to:${recipient} | ${narr.substring(0,30)} | sup:${supplierCode} | center:${centerCode} | exp:${expCode} | مبلغ:${amount} | د:${debit} | ر:${credit}`);
      });
    }
  }
} catch(e) { console.error('خطأ:', e.message); }

// ──────────────────────────────────────────────────────────────
// 3. موردين — شيت الكود
// ──────────────────────────────────────────────────────────────
printSection('3. الموردين والعملاء — شيت الكود (الأكواد الرئيسية)');
try {
  const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx', {raw: false});
  console.log('الشيتات:', wb.SheetNames.join(', '));
  const ws = wb.Sheets['الكود'];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:false});
    let nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== ''));
    console.log(`\nإجمالي الصفوف: ${nonEmpty.length}`);
    nonEmpty.slice(0, 120).forEach((r, i) => {
      const clean = r.map(c => String(c).trim()).filter(c => c !== '');
      if (clean.length >= 2) console.log(`[${i}]`, clean.slice(0,6).join('  |  '));
    });
  }
} catch(e) { console.error('خطأ:', e.message); }

// ──────────────────────────────────────────────────────────────
// 4. مخازن — شيت الكود
// ──────────────────────────────────────────────────────────────
printSection('4. مخازن — شيت الكود (أصناف + موردين + مراكز + SUB)');
try {
  const wb = XLSX.readFile('مخازن نواة المستقبل2025-2026.xlsx', {raw: false});
  console.log('الشيتات:', wb.SheetNames.join(', '));
  const ws = wb.Sheets['الكود'];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:false});
    let nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== ''));
    console.log(`\nإجمالي الصفوف: ${nonEmpty.length}`);
    nonEmpty.slice(0, 150).forEach((r, i) => {
      const clean = r.map(c => String(c).trim()).filter(c => c !== '');
      if (clean.length >= 2) console.log(`[${i}]`, clean.slice(0,8).join('  |  '));
    });
  }
} catch(e) { console.error('خطأ:', e.message); }
