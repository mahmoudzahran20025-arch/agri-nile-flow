// Phase 1b: Deep column analysis of key sheets
const XLSX = require('xlsx');
const path = require('path');

const BASE = 'C:\\Users\\mahmo\\Contacts\\CLAUDE_CO WORK MY WORK\\agri-nile-flow';

const TARGETS = [
  { file: 'الموردين والعملاء نواة المستقبل2025-2026.xlsx', sheet: 'الكود', label: 'Supplier Master' },
  { file: 'الموردين والعملاء نواة المستقبل2025-2026.xlsx', sheet: 'أرصدة الموردين', label: 'Supplier Balances' },
  { file: 'الموردين والعملاء نواة المستقبل2025-2026.xlsx', sheet: 'البيان', label: 'Supplier Transactions (first 5)', maxRows: 5 },
  { file: 'الموردين والعملاء نواة المستقبل2025-2026.xlsx', sheet: 'مركز التكلفة', label: 'Cost Center' },
  { file: 'خزينة نواة المستقبل 2025-2026.xlsx', sheet: 'البيان', label: 'Treasury Transactions (first 5)', maxRows: 5 },
  { file: 'خزينة نواة المستقبل 2025-2026.xlsx', sheet: 'الأكواد', label: 'Treasury Codes (first 10)', maxRows: 10 },
  { file: 'خزينة نواة المستقبل 2025-2026.xlsx', sheet: 'اجمالي الموردين', label: 'Treasury Supplier Totals' },
  { file: 'خزينة نواة المستقبل 2025-2026.xlsx', sheet: 'مساهمة الشركاء', label: 'Partner Contributions' },
  { file: 'مخازن نواة المستقبل2025-2026.xlsx', sheet: 'الكود', label: 'Item Master (first 10)', maxRows: 10 },
  { file: 'مخازن نواة المستقبل2025-2026.xlsx', sheet: 'أرصدة المخازن', label: 'Inventory Balances' },
  { file: 'مخازن نواة المستقبل2025-2026.xlsx', sheet: 'البيانات', label: 'Inventory Movements (first 5)', maxRows: 5 },
  { file: 'مخازن نواة المستقبل2025-2026.xlsx', sheet: 'Sheet1', label: 'Inventory Sheet1 (item categories)' },
  { file: 'شجرة نواة المستقبل (1).xlsx', sheet: 'final', label: 'COA (first 10)', maxRows: 10 },
];

for (const t of TARGETS) {
  const filePath = path.join(BASE, t.file);
  const wb = XLSX.readFile(filePath, { cellDates: true, raw: false });
  const ws = wb.Sheets[t.sheet];
  if (!ws) { console.log(`MISSING sheet: ${t.sheet} in ${t.file}`); continue; }

  const data = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  const rawData = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

  const maxR = t.maxRows || data.length;
  const sample = data.slice(0, maxR);

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`[${t.label}] — Sheet: "${t.sheet}" in "${t.file}"`);
  console.log(`Total rows: ${data.length}`);

  if (data.length > 0) {
    const cols = Object.keys(data[0]);
    console.log(`Columns (${cols.length}):`);
    cols.forEach((c, i) => console.log(`  ${i + 1}. "${c}"`));

    console.log(`\nSample rows:`);
    sample.forEach((row, i) => {
      console.log(`  Row ${i + 1}:`, JSON.stringify(row));
    });
  }

  // Special: for transactions, detect date/amount patterns
  if (t.maxRows && data.length > 0) {
    const cols = Object.keys(data[0]);
    const amountCols = cols.filter(c => {
      const vals = rawData.slice(0, 20).map(r => r[c]).filter(v => v !== null);
      return vals.length > 0 && vals.filter(v => typeof v === 'number').length / vals.length > 0.5;
    });
    const dateCols = cols.filter(c => c.includes('تاريخ') || c.includes('date') || c.includes('Date'));
    console.log(`  Likely amount columns: ${amountCols.join(', ')}`);
    console.log(`  Likely date columns: ${dateCols.join(', ')}`);
  }
}
