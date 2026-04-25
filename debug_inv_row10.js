const XLSX = require('xlsx');
const wb = XLSX.readFile('مخازن نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets["البيانات"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log(`Row 10:`, JSON.stringify(rows[10]));
