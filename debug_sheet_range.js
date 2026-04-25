const XLSX = require('xlsx');
const wb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const ws = wb.Sheets['النشاط'];
console.log('Sheet !ref:', ws['!ref']);
console.log('Sheet !range:', ws['!range']);
console.log('Keys:', Object.keys(ws).filter(k => k[0] !== '!').slice(0, 10));
