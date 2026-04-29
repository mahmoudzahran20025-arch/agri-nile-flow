const fs = require('fs');

console.log('=== إعداد فترة مالية واحدة للموسم ===\n');

// تاريخ بداية ونهاية الموسم الشتوي 2025-2026
const seasonStart = '2025-10-01';
const seasonEnd = '2026-03-31';

let sql = `-- Single Financial Period Setup SQL\n`;
sql += `-- Generated: ${new Date().toISOString()}\n`;
sql += `-- Season: 2025-2026 (Winter Season)\n\n`;
sql += `BEGIN TRANSACTION;\n\n`;

// حذف الفترات القديمة
sql += `-- Clean up old periods\n`;
sql += `DELETE FROM financial_periods WHERE company_id = 1 AND season_id = 1;\n`;
sql += `DELETE FROM accounting_periods WHERE company_id = 1;\n\n`;

// إنشاء فترة مالية واحدة للموسم
sql += `-- Create single period for entire season\n`;
sql += `INSERT INTO financial_periods (company_id, season_id, period_number, name, start_date, end_date, status, is_open, created_at) `;
sql += `VALUES (1, 1, 1, 'الموسم الشتوي 2025-2026', '${seasonStart}', '${seasonEnd}', 'open', 1, datetime('now'));\n\n`;

// إنشاء فترات شهرية فرعية (اختياري - للتقارير)
sql += `-- Create monthly sub-periods (for reporting)\n`;
const months = [
  { num: 10, name: 'أكتوبر 2025' },
  { num: 11, name: 'نوفمبر 2025' },
  { num: 12, name: 'ديسمبر 2025' },
  { num: 1, name: 'يناير 2026' },
  { num: 2, name: 'فبراير 2026' },
  { num: 3, name: 'مارس 2026' }
];

for (const m of months) {
  const year = m.num >= 10 ? 2025 : 2026;
  const start = `${year}-${String(m.num).padStart(2, '0')}-01`;
  const end = `${year}-${String(m.num).padStart(2, '0')}-31`; // simplified
  
  sql += `INSERT INTO accounting_periods (company_id, period_code, name, start_date, end_date, fiscal_year, is_closed, created_at) `;
  sql += `VALUES (1, '${year}${String(m.num).padStart(2, '0')}', '${m.name}', '${start}', '${end}', ${year}, 0, datetime('now'));\n`;
}

// إغلاق الفترات القديمة إذا وجدت
sql += `\n-- Close any periods outside the season\n`;
sql += `UPDATE financial_periods SET is_open = 0, status = 'closed' `;
sql += `WHERE company_id = 1 AND (end_date < '${seasonStart}' OR start_date > '${seasonEnd}');\n`;

sql += `\nCOMMIT;\n`;
sql += `-- Period setup complete\n`;

fs.writeFileSync('setup_single_period.sql', sql);
console.log(`✅ تم حفظ SQL في setup_single_period.sql`);

console.log(`\n📅 الفترة المالية الرئيسية:`);
console.log(`   الموسم: 2025-2026 (الشتوي)`);
console.log(`   البداية: ${seasonStart}`);
console.log(`   النهاية: ${seasonEnd}`);
console.log(`   الحالة: مفتوح`);

console.log(`\n📊 الفترات الشهرية الفرعية:`);
for (const m of months) {
  console.log(`   - ${m.name}`);
}

console.log(`\n🎯 الفائدة:`);
console.log(`   - تبسيط العمليات المحاسبية`);
console.log(`   - فترة واحدة مفتوحة = no period conflicts`);
console.log(`   - سهولة استخراج تقارير الموسم`);
