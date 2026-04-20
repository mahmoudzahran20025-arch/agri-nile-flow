// ════════════════════════════════════════════════════════════════
//  نواة المستقبل — 2025-2026 — خريطة البيانات الفعلية
// ════════════════════════════════════════════════════════════════

export const DB = {
  database_name: 'agri-nile-flow-data-lake',
}

export const COMPANY_ID = 1

// ─── ملف الموردين والعملاء ──────────────────────────────────
export const SUPPLIERS_CONFIG = {
  file: 'الموردين والعملاء نواة المستقبل2025-2026.xlsx',

  // الأكواس — البيانات الأساسية للموردين
  masterSheet: {
    name:     'الكود',
    startRow: 1,                    // row 1 = الهيدر، البيانات من row 1
    columns: {
      code:     'الكود',
      name:     'المورد',
      activity: 'النشاط',
    },
  },

  // حركات الموردين من sheet البيان
  transSheet: {
    name:     'البيان',
    startRow: 3,                    // Row 1 = summary, Row 2 = headers, Row 3+ = data
    columns: {
      transaction_date: 0,          // Column 0: التاريخ
      supplier_code:    2,          // Column 2: كود المورد
      debit_amount:     21,         // Column 21: مدين
      credit_amount:    20,         // Column 20: دائن
      quantity:         17,         // Column 17: الكمية
      unit_price:       18,         // Column 18: السعر
      amount:           19,         // Column 19: القيمة
      notes:            30,         // Column 30 (تقريبي): ملاحظات
    },
  },
}

// ─── ملف الخزينة (دفتر اليومية) ─────────────────────────────
export const TREASURY_CONFIG = {
  file: 'خزينة نواة المستقبل 2025-2026.xlsx',
  sheet: {
    name:     'البيان',
    startRow: 2,                    // Skip row 1 (summary)، البيانات من row 2
    columns: {
      transaction_date: '__EMPTY',      // التاريخ
      amount_in:        '__EMPTY_5',    // الوارد (استلام مبلغ)
      amount_out:       '__EMPTY_6',    // المنصرف (صرف مبلغ)
      balance:          '__EMPTY_7',    // الرصيد
      narration:        '__EMPTY_3',    // البيان (اختياري)
    },
  },
}

// ─── ملف المخازن ────────────────────────────────────────────
export const INVENTORY_CONFIG = {
  file: 'مخازن نواة المستقبل2025-2026.xlsx',
  sheet: {
    name:     'البيانات',
    startRow: 2,                    // Skip row 1 (summary)، البيانات من row 2
    columns: {
      warehouse:        '__EMPTY_4',    // المخزن
      movement_type:    'اضافة',       // النوع (من column اضافة: اضافة/صرف)
      item_code:        '__EMPTY_10',   // كود الصنف
      item_name:        '__EMPTY_11',   // الصنف
      unit:             '__EMPTY_12',   // الوحدة
      quantity_in:      '__EMPTY_24',   // كمية الوارد
      quantity_out:     '__EMPTY_25',   // كمية المنصرف
      quantity_balance: '__EMPTY_26',   // الرصيد (quantity)
      value_in:         '__EMPTY_27',   // قيمة الوارد
      value_out:        '__EMPTY_28',   // قيمة المنصرف
      value_balance:    '__EMPTY_29',   // قيمة الرصيد
    },
  },
}
