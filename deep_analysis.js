const XLSX = require('xlsx');

console.log('='.repeat(80));
console.log('تحليل تفصيلي للبيانات');
console.log('='.repeat(80));

// 1. تحليل شجرة الحسابات
console.log('\n📊 1. شجرة الحسابات (Chart of Accounts)');
console.log('-'.repeat(80));
const coaWb = XLSX.readFile('شجرة نواة المستقبل (1).xlsx');
const coaSheet = coaWb.Sheets['final'];
const coaData = XLSX.utils.sheet_to_json(coaSheet, { defval: null });
console.log(`عدد الحسابات: ${coaData.length}`);
console.log('عينة من الحسابات:');
coaData.slice(0, 10).forEach(row => {
  console.log(JSON.stringify(row, null, 2));
});

// 2. تحليل الموردين والعملاء
console.log('\n\n📊 2. الموردين والعملاء');
console.log('-'.repeat(80));
const suppWb = XLSX.readFile('الموردين والعملاء نواة المستقبل2025-2026.xlsx');
const suppCodeSheet = suppWb.Sheets['الكود'];
const suppCodeData = XLSX.utils.sheet_to_json(suppCodeSheet, { defval: null });
console.log(`عدد الموردين/العملاء: ${suppCodeData.length}`);
console.log('عينة من الموردين:');
suppCodeData.slice(0, 5).forEach(row => {
  console.log(JSON.stringify(row, null, 2));
});

// تحليل البيان (المعاملات)
const suppTransSheet = suppWb.Sheets['البيان'];
const suppTransData = XLSX.utils.sheet_to_json(suppTransSheet, { defval: null });
console.log(`\nعدد معاملات الموردين: ${suppTransData.length}`);
console.log('عينة من المعاملات:');
suppTransData.slice(0, 3).forEach(row => {
  console.log(JSON.stringify(row, null, 2));
});

// 3. تحليل المخازن
console.log('\n\n📊 3. المخازن (Inventory)');
console.log('-'.repeat(80));
const invWb = XLSX.readFile('مخازن نواة المستقبل2025-2026.xlsx');
const invCodeSheet = invWb.Sheets['الكود'];
const invCodeData = XLSX.utils.sheet_to_json(invCodeSheet, { defval: null });
console.log(`عدد الأصناف: ${invCodeData.length}`);
console.log('عينة من الأصناف:');
invCodeData.slice(0, 5).forEach(row => {
  console.log(JSON.stringify(row, null, 2));
});

// تحليل حركات المخزن
const invTransSheet = invWb.Sheets['البيانات'];
const invTransData = XLSX.utils.sheet_to_json(invTransSheet, { defval: null });
console.log(`\nعدد حركات المخزن: ${invTransData.length}`);
console.log('عينة من الحركات:');
invTransData.slice(0, 3).forEach(row => {
  console.log(JSON.stringify(row, null, 2));
});

// 4. تحليل الخزينة
console.log('\n\n📊 4. الخزينة (Cash)');
console.log('-'.repeat(80));
const cashWb = XLSX.readFile('خزينة نواة المستقبل 2025-2026.xlsx');
const cashTransSheet = cashWb.Sheets['البيان'];
const cashTransData = XLSX.utils.sheet_to_json(cashTransSheet, { defval: null });
console.log(`عدد حركات الخزينة: ${cashTransData.length}`);
console.log('عينة من الحركات:');
cashTransData.slice(0, 5).forEach(row => {
  console.log(JSON.stringify(row, null, 2));
});

console.log('\n' + '='.repeat(80));
console.log('✅ انتهى التحليل التفصيلي');
console.log('='.repeat(80));
