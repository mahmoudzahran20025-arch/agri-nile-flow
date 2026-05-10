/**
 * تحليل شامل لتكاليف البيفوتات - نواة المستقبل 2025-2026
 * ===================================================
 * المصادر:
 *   1. نواة_المستقبل_2025-2026.json    → الموردين والعملاء (ميكنة، عمالة، خدمات)
 *   2. مخازن_نواة_المستقبل_2025-2026.json → الأسمدة والمبيدات والتقاوي وقطع الغيار
 *   3. خزينة_نواة_المستقبل_2025-2026.json → حركات الدفعات النقدية والصرف
 * 
 * المخرجات:
 *   - إجمالي تكاليف كل بيفوت
 *   - تصنيف المصروفات (ميكنة / عمالة / أسمدة / مبيدات / تقاوي / ...)
 *   - الموردين مع تفصيل المستندات (مستخلص / محضر / إذن صرف)
 *   - مركز التكلفة + الحساب الرئيسي (المحصول)
 *   - أنواع الوحدات والكميات
 */

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');

// ─── خريطة البيفوتات ─────────────────────────────────────────────────────────
const PIVOT_MAP = {
  1006001: 'بيفوت رقم 718 بوستر129',
  1006002: 'بيفوت رقم 719 بوستر129',
  1006003: 'بيفوت رقم 720 بوستر129',
  1006004: 'بيفوت رقم 722 بوستر129',
  1006005: 'بيفوت رقم 723 بوستر129',
  1006006: 'بيفوت رقم 1044 بوستر128',
  1006007: 'بيفوت رقم 1047 بوستر128',
  1006008: 'بيفوت رقم 1048 بوستر128',
  1006009: 'بيفوت رقم 1049 بوستر128',
  1006010: 'بيفوت رقم 1050 بوستر128',
  1006011: 'ادارية ارض الدلتا الجديدة',
};

// ─── هيكل تجميع البيفوت ─────────────────────────────────────────────────────
function newPivot(code) {
  return {
    كود: code,
    الاسم: PIVOT_MAP[code] || `مركز ${code}`,
    الإجمالي: 0,
    حركات_الموردين: { الإجمالي: 0, حسب_التصنيف: {}, حسب_المورد: {}, المستندات: [] },
    حركات_المخازن:  { الإجمالي: 0, حسب_الصنف: {}, حسب_نوع_المخزن: {}, المستندات: [] },
    حركات_الخزينة:  { الإجمالي: 0, حسب_المصروف: {}, المستندات: [] },
    الحسابات_الرئيسية: {},
  };
}

const pivots = {};
function getPivot(code) {
  if (!pivots[code]) pivots[code] = newPivot(code);
  return pivots[code];
}

function addTo(obj, key, val) {
  obj[key] = (obj[key] || 0) + val;
}

// ─── 1. قراءة ملف الموردين (نواة_المستقبل) ──────────────────────────────────
console.log('\n📂 قراءة ملف الموردين والعملاء...');
const nuwa = JSON.parse(fs.readFileSync(path.join(BASE, 'نواة_المستقبل_2025-2026.json'), 'utf8'));
const nuwaRows = nuwa.البيان_الرئيسي?.المعاملات || [];

let supplierPivotRows = 0;
for (const row of nuwaRows) {
  const pivotCode = row['كود البيقوت'];
  if (!pivotCode || !PIVOT_MAP[pivotCode]) continue;

  // فقط معاملات الدين (تكلفة فعلية)، النوع "د" = دائن (استحقاق على الشركة)
  const amount = row['دائن'] || 0;
  if (amount === 0) continue;

  const p = getPivot(pivotCode);
  const mainAcct = row['الحساب الرئيسي'] || 'غير محدد';
  const expense = row['المصروف'] || 'غير محدد';
  const supplier = row['المورد / العميل'] || 'غير محدد';
  const docType = row['نوع المستند'] || 'غير محدد';
  const docNo = row['رقم المستند'];
  const unit = row['الوحدة'] || '';
  const qty = row['الكميه'] || 0;
  const price = row['السعر'] || 0;

  p.حركات_الموردين.الإجمالي += amount;
  p.الإجمالي += amount;

  addTo(p.حركات_الموردين.حسب_التصنيف, expense, amount);
  addTo(p.حركات_الموردين.حسب_المورد, supplier, amount);
  addTo(p.الحسابات_الرئيسية, mainAcct, amount);

  p.حركات_الموردين.المستندات.push({
    تاريخ: row['التاريخ']?.split('T')[0] || row['التاريخ'] || '',
    نوع_المستند: docType,
    رقم_المستند: docNo,
    المورد: supplier,
    البيان: row['البيان'] || '',
    المصروف: expense,
    المعدة: row['المعدة'] || '',
    الحساب_الرئيسي: mainAcct,
    كود_الحساب: row['كود الحساب'],
    الوحدة: unit,
    الكمية: qty,
    السعر: price,
    القيمة: amount,
  });
  supplierPivotRows++;
}
console.log(`   ✅ صفوف البيفوتات من ملف الموردين: ${supplierPivotRows}`);

// ─── 2. قراءة ملف المخازن ────────────────────────────────────────────────────
console.log('\n📂 قراءة ملف المخازن...');
const makhazin = JSON.parse(fs.readFileSync(path.join(BASE, 'مخازن_نواة_المستقبل_2025-2026.json'), 'utf8'));

// خريطة عكسية: اسم البيفوت النصي → الكود
const PIVOT_NAME_TO_CODE = {};
for (const [code, name] of Object.entries(PIVOT_MAP)) {
  PIVOT_NAME_TO_CODE[name.trim()] = Number(code);
}
// أيضًا بدون مسافة بادئة
for (const [code, name] of Object.entries(PIVOT_MAP)) {
  PIVOT_NAME_TO_CODE[name.replace(/^\s+/,'').trim()] = Number(code);
}

function pivotCodeFromName(name) {
  if (!name) return null;
  const n = String(name).trim();
  return PIVOT_NAME_TO_CODE[n] || null;
}

let storagePivotRows = 0;

// ── 2أ. تكاليف_مراكز_التكلفة (مجمّعة حسب صنف × بيفوت) ──────────────────────
const centerCostRows = makhazin.تكاليف_مراكز_التكلفة?.البيانات || [];
for (const row of centerCostRows) {
  const pivotCode = pivotCodeFromName(row['مركز_التكلفة']);
  if (!pivotCode) continue;
  const amount = row['الإجمالي'] || 0;
  if (amount === 0) continue;

  const p = getPivot(pivotCode);
  const itemName = row['الصنف'] || 'غير محدد';
  const mainAcct = row['الحساب_الرئيسي'] || 'بنجر السكر';

  p.حركات_المخازن.الإجمالي += amount;
  p.الإجمالي += amount;
  addTo(p.حركات_المخازن.حسب_الصنف, itemName, amount);
  addTo(p.الحسابات_الرئيسية, mainAcct, amount);

  // تصنيف نوع الصنف للمخزن
  const storeType = guessStoreType(itemName);
  addTo(p.حركات_المخازن.حسب_نوع_المخزن, storeType, amount);

  p.حركات_المخازن.المستندات.push({
    المصدر: 'تكاليف_مراكز',
    الصنف: itemName,
    الوحدة: row['الوحدة'] || '',
    الفئة_السعر: row['الفئة_السعر'] || 0,
    القيمة: amount,
    نوع_المخزن: storeType,
    الحساب_الرئيسي: mainAcct,
  });
  storagePivotRows++;
}

// ── 2ب. البيان_اليومي (صرف فعلي مع كمية) ──────────────────────────────────
const dailyRows = makhazin.البيان_اليومي?.البيانات || [];
for (const row of dailyRows) {
  if (row['النوع'] !== 'صرف') continue;
  const pivotCode = pivotCodeFromName(row['مركز_التكلفة']);
  if (!pivotCode) continue;
  const qty = row['كمية_المنصرف'] || 0;
  if (qty === 0) continue;

  const p = getPivot(pivotCode);
  const itemName = row['الصنف'] || 'غير محدد';
  p.حركات_المخازن.المستندات.push({
    المصدر: 'بيان_يومي_صرف',
    المورد: row['المورد'] || '',
    الصنف: itemName,
    الوحدة: row['الوحدة'] || '',
    كمية_منصرف: qty,
    القيمة: 0,  // البيان اليومي ليس له قيمة مالية مباشرة (الكمية فقط)
  });
}

// ── 2ج. البيانات_الرئيسية (حركات مفصلة) ──────────────────────────────────
const mainRows = makhazin.البيانات_الرئيسية?.المعاملات || [];
for (const row of mainRows) {
  if (row['النوع'] !== 'صرف') continue;
  const pivotCode = pivotCodeFromName(row['البيفوت'] || row['مركز_التكلفة']);
  if (!pivotCode) continue;
  const amount = row['قيمة_المنصرف'] || row['القيمة'] || 0;
  if (amount === 0) continue;
  const p = getPivot(pivotCode);
  const itemName = row['الصنف'] || 'غير محدد';
  const storeType = row['المخزن'] || guessStoreType(itemName);
  const mainAcct = row['الحساب_الرئيسي'] || 'بنجر السكر';

  p.حركات_المخازن.الإجمالي += amount;
  p.الإجمالي += amount;
  addTo(p.حركات_المخازن.حسب_الصنف, itemName, amount);
  addTo(p.حركات_المخازن.حسب_نوع_المخزن, storeType, amount);
  addTo(p.الحسابات_الرئيسية, mainAcct, amount);
  storagePivotRows++;
}

console.log(`   ✅ صفوف البيفوتات من ملف المخازن: ${storagePivotRows}`);

// دالة تخمين نوع المخزن من اسم الصنف
function guessStoreType(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('سماد') || n.includes('نترات') || n.includes('فوسفات') || n.includes('بوتاسيوم') || n.includes('كالسيوم') || n.includes('سلفات') || n.includes('ماب') || n.includes('حمض') || n.includes('يوريا')) return 'أسمدة';
  if (n.includes('تقاوي') || n.includes('تقاو') || n.includes('بذر') || n.includes('بذور')) return 'تقاوي';
  if (n.includes('مبيد') || n.includes('آفات') || n.includes('افات') || n.includes('حشر')) return 'مبيدات';
  if (n.includes('قطع') || n.includes('غيار') || n.includes('ري') || n.includes('شبكة') || n.includes('خرطوم') || n.includes('موتور')) return 'قطع_غيار_ري';
  if (n.includes('وقود') || n.includes('سولار') || n.includes('بنزين')) return 'وقود';
  return 'متنوعات';
}

// ─── 3. قراءة ملف الخزينة ────────────────────────────────────────────────────
console.log('\n📂 قراءة ملف الخزينة...');
const khazina = JSON.parse(fs.readFileSync(path.join(BASE, 'خزينة_نواة_المستقبل_2025-2026.json'), 'utf8'));
const khazRows = khazina.البيان_الرئيسي?.المعاملات || [];

let cashPivotRows = 0;

// الخزينة: المدفوعات لموردين البيفوتات (غير مرتبطة ببيفوت واحد، إجمالية)
// والمصروفات المرتبطة بـ "ادارية ارض الدلتا الجديدة" → 1006011
const ADMIN_PIVOT_CODE = 1006011;

for (const row of khazRows) {
  const amount = row['مدين'] || 0;  // منصرف من الخزينة
  if (amount === 0) continue;

  const center = row['المركز'] || '';
  let pivotCode = null;

  // ربط بمركز الادارية
  if (center.includes('ادارية') || center.includes('الدلتا الجديدة')) {
    pivotCode = ADMIN_PIVOT_CODE;
  } else {
    // محاولة ربط نصي
    pivotCode = pivotCodeFromName(center);
  }

  if (!pivotCode) continue;

  const p = getPivot(pivotCode);
  const expense = row['المصروف'] || row['البيان'] || 'مصروف نقدي';
  const mainAcct = 'خدمات ادارية';

  p.حركات_الخزينة.الإجمالي += amount;
  p.الإجمالي += amount;

  addTo(p.حركات_الخزينة.حسب_المصروف, expense, amount);
  addTo(p.الحسابات_الرئيسية, mainAcct, amount);

  p.حركات_الخزينة.المستندات.push({
    تاريخ: row['التاريخ'] || '',
    رقم_المستند: row['رقم المستند'],
    المستلم: row['المستلم / المسلم'] || '',
    البيان: row['البيان'] || '',
    المصروف: expense,
    المركز: center,
    القيمة: amount,
  });
  cashPivotRows++;
}

// دفعات لموردين البيفوتات من نواة (مستخلص أعمال اذن صرف - تم رصدها في ملف الموردين)
// كشف_حساب_دفعات_مورد للمرجع فقط
const supplierPayments = khazina.كشف_حساب_دفعات_مورد?.البيانات || [];
console.log(`   📋 دفعات موردين مسجلة في الخزينة (مرجعية): ${supplierPayments.length} صنف`);

console.log(`   ✅ صفوف مرتبطة ببيفوتات من ملف الخزينة: ${cashPivotRows}`);

// ─── 4. البيانات الإضافية من المخازن (أصناف مصروفة لكل بيفوت) ──────────────
// تم التعامل معها مسبقًا في القسم 2
console.log('\n📂 اكتمل تحليل ملفات المخازن (البيانات اليومية مُدمجة).');
const storageItemRows = 0;

// ─── 5. إنتاج التقرير ────────────────────────────────────────────────────────

const sortedPivots = Object.values(pivots).sort((a, b) => b.الإجمالي - a.الإجمالي);

// ─── 5أ. ملخص تنفيذي ─────────────────────────────────────────────────────────
const grandTotal = sortedPivots.reduce((s, p) => s + p.الإجمالي, 0);
const supplierTotal = sortedPivots.reduce((s, p) => s + p.حركات_الموردين.الإجمالي, 0);
const storageTotal  = sortedPivots.reduce((s, p) => s + p.حركات_المخازن.الإجمالي, 0);
const cashTotal     = sortedPivots.reduce((s, p) => s + p.حركات_الخزينة.الإجمالي, 0);

console.log('\n' + '═'.repeat(80));
console.log('  📊 تقرير تكاليف البيفوتات - نواة المستقبل 2025/2026');
console.log('═'.repeat(80));
console.log(`  إجمالي التكاليف الكلية :  ${fmt(grandTotal)}`);
console.log(`  ├─ موردين وعملاء (ميكنة/عمالة/خدمات) : ${fmt(supplierTotal)}`);
console.log(`  ├─ مخازن (أسمدة/مبيدات/تقاوي/قطع غيار): ${fmt(storageTotal)}`);
console.log(`  └─ خزينة (مصروفات نقدية مباشرة)       : ${fmt(cashTotal)}`);
console.log(`\n  عدد البيفوتات النشطة: ${sortedPivots.length}`);
console.log(`  إجمالي السجلات المحللة: ${supplierPivotRows + storagePivotRows + cashPivotRows + storageItemRows}`);

// ─── 5ب. جدول ملخص البيفوتات ─────────────────────────────────────────────────
console.log('\n' + '─'.repeat(80));
console.log('  📋 ملخص التكاليف حسب البيفوت');
console.log('─'.repeat(80));
console.log(
  padL('البيفوت', 35) +
  padL('موردين', 14) +
  padL('مخازن', 14) +
  padL('خزينة', 14) +
  padL('الإجمالي', 14)
);
console.log('─'.repeat(80));

for (const p of sortedPivots) {
  const pct = grandTotal > 0 ? ((p.الإجمالي / grandTotal) * 100).toFixed(1) : '0.0';
  console.log(
    padL(p.الاسم, 35) +
    padL(fmt(p.حركات_الموردين.الإجمالي), 14) +
    padL(fmt(p.حركات_المخازن.الإجمالي), 14) +
    padL(fmt(p.حركات_الخزينة.الإجمالي), 14) +
    padL(fmt(p.الإجمالي) + `  [${pct}%]`, 18)
  );
}
console.log('─'.repeat(80));
console.log(
  padL('الإجمالي', 35) +
  padL(fmt(supplierTotal), 14) +
  padL(fmt(storageTotal), 14) +
  padL(fmt(cashTotal), 14) +
  padL(fmt(grandTotal), 14)
);

// ─── 5ج. تفصيل كل بيفوت ───────────────────────────────────────────────────────
for (const p of sortedPivots) {
  if (p.الإجمالي === 0) continue;

  console.log('\n' + '═'.repeat(80));
  console.log(`  🔵 ${p.الاسم}  [كود: ${p.كود}]`);
  console.log(`  الإجمالي الكلي: ${fmt(p.الإجمالي)}`);
  console.log('═'.repeat(80));

  // الحسابات الرئيسية (المحاصيل)
  const accts = Object.entries(p.الحسابات_الرئيسية).sort((a, b) => b[1] - a[1]);
  if (accts.length > 0) {
    console.log('\n  📌 الحساب الرئيسي (المحصول):');
    for (const [k, v] of accts) {
      console.log(`      ${padL(k, 25)} ${fmt(v)}`);
    }
  }

  // موردين حسب التصنيف
  const byClass = Object.entries(p.حركات_الموردين.حسب_التصنيف).sort((a, b) => b[1] - a[1]);
  if (byClass.length > 0) {
    console.log('\n  🔧 تصنيف المصروفات (موردين):');
    for (const [k, v] of byClass) {
      console.log(`      ${padL(k, 25)} ${fmt(v)}`);
    }
  }

  // موردين حسب المورد
  const bySupplier = Object.entries(p.حركات_الموردين.حسب_المورد).sort((a, b) => b[1] - a[1]);
  if (bySupplier.length > 0) {
    console.log('\n  🏭 تفصيل الموردين:');
    for (const [k, v] of bySupplier) {
      console.log(`      ${padL(k, 35)} ${fmt(v)}`);
    }
  }

  // أنواع المخزن
  const byStore = Object.entries(p.حركات_المخازن.حسب_نوع_المخزن).sort((a, b) => b[1] - a[1]);
  if (byStore.length > 0) {
    console.log('\n  📦 مصروفات المخازن حسب النوع:');
    for (const [k, v] of byStore) {
      console.log(`      ${padL(k, 25)} ${fmt(v)}`);
    }
  }

  // أصناف المخزن
  const byItem = Object.entries(p.حركات_المخازن.حسب_الصنف).sort((a, b) => b[1] - a[1]);
  if (byItem.length > 0) {
    console.log('\n  🌿 أصناف المخزن المصروفة (أعلى 10):');
    for (const [k, v] of byItem.slice(0, 10)) {
      console.log(`      ${padL(k, 35)} ${fmt(v)}`);
    }
    if (byItem.length > 10) console.log(`      ... و${byItem.length - 10} صنف آخر`);
  }

  // خزينة
  const byCash = Object.entries(p.حركات_الخزينة.حسب_المصروف).sort((a, b) => b[1] - a[1]);
  if (byCash.length > 0) {
    console.log('\n  💰 مصروفات الخزينة النقدية:');
    for (const [k, v] of byCash) {
      console.log(`      ${padL(k, 25)} ${fmt(v)}`);
    }
  }

  // تفصيل المستندات (آخر 5 فقط في الكونسول - الكامل في JSON)
  const allDocs = [
    ...p.حركات_الموردين.المستندات.map(d => ({ ...d, المصدر: 'موردين' })),
    ...p.حركات_المخازن.المستندات.map(d => ({ ...d, المصدر: 'مخازن' })),
    ...p.حركات_الخزينة.المستندات.map(d => ({ ...d, المصدر: 'خزينة' })),
  ].sort((a, b) => (a.تاريخ || '').localeCompare(b.تاريخ || ''));

  if (allDocs.length > 0) {
    console.log(`\n  📄 إجمالي المستندات: ${allDocs.length} (أحدث 5):`);
    for (const d of allDocs.slice(-5)) {
      const desc = d.البيان || d.الصنف || d.المصروف || '';
      console.log(`      ${d.تاريخ}  [${d.نوع_المستند}#${d.رقم_المستند}]  ${d.المصدر}  ${desc}  → ${fmt(d.القيمة)}`);
    }
  }
}

// ─── 5د. حفظ التقرير الكامل JSON ─────────────────────────────────────────────
const outDir = path.join(BASE, 'reports', 'pivot_costs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.join(outDir, `pivot_costs_${stamp}.json`);

const report = {
  تاريخ_التقرير: now.toISOString(),
  ملخص: {
    إجمالي_الكل: grandTotal,
    موردين: supplierTotal,
    مخازن: storageTotal,
    خزينة: cashTotal,
    عدد_البيفوتات: sortedPivots.length,
    إجمالي_السجلات: supplierPivotRows + storagePivotRows + cashPivotRows + storageItemRows,
  },
  البيفوتات: sortedPivots,
};

fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
console.log('\n' + '═'.repeat(80));
console.log(`  ✅ تم حفظ التقرير الكامل في:\n     ${outFile}`);
console.log('═'.repeat(80) + '\n');

// ─── أدوات تنسيق ─────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function padL(str, len) {
  const s = String(str || '');
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}
