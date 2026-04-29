const xlsx = require('xlsx');
const fs = require('fs');

const wb = xlsx.readFile('مخازن نواة المستقبل2025-2026.xlsx', {sheetStubs: true});

console.log('=== مقارنة Pivot Tables مع بيانات الاستيراد ===\n');

// 1. مقارنة أرصدة المخازن
console.log('📊 1. شيت: ارصدة المخازن');
const balancesSheet = wb.Sheets['ارصدة المخازن'];
if (balancesSheet) {
  const data = xlsx.utils.sheet_to_json(balancesSheet, {header: 1});
  console.log(`   الصفوف في Excel: ${data.length}`);
  
  // قراءة SQL المستورد
  const invFiles = [
    'import_sql/06a_inventory_movements_batch001.sql',
    'import_sql/06a_inventory_movements_batch002.sql',
    'import_sql/06a_inventory_movements_batch003.sql',
    'import_sql/06a_inventory_movements_batch004.sql',
    'import_sql/06a_inventory_movements_batch005.sql',
    'import_sql/06a_inventory_movements_batch006.sql',
    'import_sql/06a_inventory_movements_batch007.sql'
  ];
  
  let totalImported = 0;
  invFiles.forEach(file => {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const inserts = (content.match(/INSERT INTO/g) || []).length;
      totalImported += inserts;
    }
  });
  console.log(`   السجلات المستوردة: ${totalImported}`);
  console.log(`   ⚠️ الفرق: ${data.length - totalImported} سجل\n`);
}

// 2. مقارنة تكاليف المراكز
console.log('📊 2. شيت: تكاليف مراكز');
const centersSheet = wb.Sheets['تكاليف مراكز'];
if (centersSheet) {
  const data = xlsx.utils.sheet_to_json(centersSheet, {header: 1});
  console.log(`   الصفوف في Excel: ${data.length}`);
  console.log(`   ⚠️ يجب أن تتوافق مع center_code في inventory_movements\n`);
}

// 3. مقارنة كشف حساب المورد
console.log('📊 3. شيت: كشف حساب مورد');
const supplierSheet = wb.Sheets['كشف حساب مورد'];
if (supplierSheet) {
  const data = xlsx.utils.sheet_to_json(supplierSheet, {header: 1});
  console.log(`   الصفوف في Excel: ${data.length}`);
  
  // قراءة SQL الموردين
  const supFiles = [
    'import_sql/06c_supplier_transactions_batch001.sql',
    'import_sql/06c_supplier_transactions_batch002.sql',
    'import_sql/06c_supplier_transactions_batch003.sql',
    'import_sql/06c_supplier_transactions_batch004.sql'
  ];
  
  let totalSuppliers = 0;
  supFiles.forEach(file => {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const inserts = (content.match(/INSERT INTO/g) || []).length;
      totalSuppliers += inserts;
    }
  });
  console.log(`   السجلات المستوردة: ${totalSuppliers}`);
  console.log(`   ⚠️ الفرق: ${data.length - totalSuppliers} سجل\n`);
}

// 4. تحليل الأصناف (بطاقة صنف)
console.log('📊 4. شيت: بطاقة صنف (Item Card)');
const itemSheet = wb.Sheets['بطاقة صنف'];
if (itemSheet) {
  const data = xlsx.utils.sheet_to_json(itemSheet, {header: 1});
  console.log(`   الصفوف في Excel: ${data.length}`);
  console.log(`   ⚠️ يجب أن تتوافق مع 61 صنف مستورد\n`);
}

// 5. البيان اليومي
console.log('📊 5. شيت: البيان اليومي');
const dailySheet = wb.Sheets['البيان اليومي'];
if (dailySheet) {
  const data = xlsx.utils.sheet_to_json(dailySheet, {header: 1});
  console.log(`   الصفوف في Excel: ${data.length}`);
  console.log(`   ⚠️ يجب أن تتوافق مع حركات اليوم الواحد\n`);
}

console.log('=== ملخص المقارنة ===');
console.log(`
المشاكل المكتشفة:
1. ارصدة المخازن (${971} صف) ≠ حركات المخزن (${totalImported} سجل)
2. تكاليف المراكز (${1307} صف) - مراكز التكلفة غير مكتملة في الاستيراد
3. كشف حساب المورد (${293} صف) ≠ حركات الموردين (${totalSuppliers || 'غير محسوب'})
4. بطاقة الصنف (${2496} صف) ≠ ${61} صنف فقط مستورد
`);
