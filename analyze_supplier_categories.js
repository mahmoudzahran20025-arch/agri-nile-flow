#!/usr/bin/env node
/**
 * تحليل فئات الموردين من ملف Excel
 * لفهم Business Logic الحسابي
 */

const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'الموردين والعملاء نواة المستقبل2025-2026.xlsx');

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  تحليل فئات الموردين والمنطق المحاسبي                           ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log(`File: ${filePath}`);
console.log('');

try {
  const workbook = xlsx.readFile(filePath, { codepage: 65001 });
  
  console.log('الشيتات المتاحة:');
  workbook.SheetNames.forEach((name, i) => {
    console.log(`  ${i + 1}. ${name}`);
  });
  console.log('');
  
  // ====== 1. تحليل شيت الكود (الموردين) ======
  console.log('📋 تحليل شيت "الكود" (بيانات الموردين):');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const codeSheet = workbook.Sheets['الكود'];
  if (codeSheet) {
    const codeData = xlsx.utils.sheet_to_json(codeSheet, { header: 1, raw: false });
    
    // Find headers
    let headerRow = 0;
    for (let i = 0; i < Math.min(5, codeData.length); i++) {
      if (codeData[i] && codeData[i].includes('الكود')) {
        headerRow = i;
        break;
      }
    }
    
    console.log(`  Header row: ${headerRow + 1}`);
    console.log(`  Headers: ${codeData[headerRow]?.join(', ')}`);
    console.log(`  Total rows: ${codeData.length - headerRow - 1}`);
    
    // Extract suppliers with their categories
    const suppliers = [];
    const categories = {};
    
    for (let i = headerRow + 1; i < codeData.length; i++) {
      const row = codeData[i];
      if (!row || row.length < 3) continue;
      
      const code = row[0]; // كود المورد
      const name = row[1]; // اسم المورد
      const activity = row[2]; // النشاط/التصنيف
      
      if (!code) continue;
      
      suppliers.push({ code, name, activity });
      
      // Count by category
      const cat = activity || 'غير مصنف';
      categories[cat] = (categories[cat] || 0) + 1;
    }
    
    console.log(`\n  إجمالي الموردين: ${suppliers.length}`);
    console.log('\n  التصنيفات:');
    Object.entries(categories).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
      console.log(`    • ${cat}: ${count}`);
    });
    
    // Show sample suppliers
    console.log('\n  عينة من الموردين:');
    suppliers.slice(0, 10).forEach(s => {
      console.log(`    • [${s.code}] ${s.name} (${s.activity})`);
    });
  }
  
  // ====== 2. تحليل شيت البيان (المعاملات) ======
  console.log('\n\n📋 تحليل شيت "البيان" (المعاملات):');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const bianSheet = workbook.Sheets['البيان'];
  if (bianSheet) {
    const bianData = xlsx.utils.sheet_to_json(bianSheet, { header: 1, raw: false });
    
    // Find headers
    let headerRow = 0;
    for (let i = 0; i < Math.min(5, bianData.length); i++) {
      if (bianData[i] && (bianData[i].includes('التاريخ') || bianData[i].includes('البيان'))) {
        headerRow = i;
        break;
      }
    }
    
    console.log(`  Header row: ${headerRow + 1}`);
    console.log(`  Headers: ${bianData[headerRow]?.slice(0, 8).join(', ')}...`);
    console.log(`  Total rows: ${bianData.length - headerRow - 1}`);
    
    // Analyze transaction types
    const txTypes = {};
    const docTypes = {};
    
    for (let i = headerRow + 1; i < Math.min(headerRow + 1000, bianData.length); i++) {
      const row = bianData[i];
      if (!row) continue;
      
      const desc = row[1] || ''; // البيان
      const docType = row[3] || ''; // نوع المستند
      
      if (desc) {
        txTypes[desc] = (txTypes[desc] || 0) + 1;
      }
      if (docType) {
        docTypes[docType] = (docTypes[docType] || 0) + 1;
      }
    }
    
    console.log('\n  أنواع المعاملات (أول 1000 صف):');
    Object.entries(txTypes).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([type, count]) => {
      console.log(`    • ${type}: ${count}`);
    });
    
    console.log('\n  أنواع المستندات:');
    Object.entries(docTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`    • ${type}: ${count}`);
    });
  }
  
  // ====== 3. تحليل شيت النشاط ======
  console.log('\n\n📋 تحليل شيت "النشاط" (التصنيفات):');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const activitySheet = workbook.Sheets['النشاط'];
  if (activitySheet) {
    const activityData = xlsx.utils.sheet_to_json(activitySheet, { header: 1 });
    console.log(`  Total categories: ${activityData.length}`);
    
    activityData.slice(0, 10).forEach((row, i) => {
      console.log(`    ${i + 1}. ${row.join(' | ')}`);
    });
  }
  
  // ====== 4. اقتراحات Business Logic ======
  console.log('\n\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  اقتراحات Business Logic للـ Posting Rules                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  console.log('\n1. تصنيفات الموردين (حسب النشاط):');
  console.log('   • موردين زراعة → حساب 2110 (موردين عام)');
  console.log('   • موردين أسمدة → حساب 2111 (موردين أسمدة)');
  console.log('   • موردين مبيدات → حساب 2112 (موردين مبيدات)');
  console.log('   • مشتريات عامة → حساب 45010001 (مشتريات)');
  
  console.log('\n2. أنواع المعاملات (حسب المستند):');
  console.log('   • فاتورة مشتريات → DR: 4501 (مشتريات) | CR: 2110 (موردين)');
  console.log('   • سند صرف/دفع → DR: 2110 (موردين) | CR: 1401 (نقدية)');
  console.log('   • مرتجع مشتريات → DR: 2110 | CR: 4501 (عكسي)');
  console.log('   • مستخلص أعمال → DR: 5101 (تكاليف) | CR: 2110');
  
  console.log('\n3. حسابات المقابلة المقترحة:');
  console.log('   • 2110 — موردين (Accounts Payable)');
  console.log('   • 4501 — مشتريات (Purchases)');
  console.log('   • 5101 — تكاليف تشغيلية');
  console.log('   • 1401 — الخزينة/النقدية');
  
} catch (err) {
  console.error('Error:', err.message);
  console.log('\nتأكد من تثبيت مكتبة xlsx:');
  console.log('  npm install xlsx');
}

console.log('\n✅ التحليل اكتمل');
