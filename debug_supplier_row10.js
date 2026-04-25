const XLSX = require('xlsx');
const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets["البيان"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log(`Row 10:`, JSON.stringify(rows[10]));
