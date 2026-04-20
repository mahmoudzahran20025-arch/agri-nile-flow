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
    startRow: 1,                    // Data starts from row 1
    columns: {
      code:     'الكود',             // Column: الكود
      name:     'المورد',            // Column: المورد
      activity: 'النشاط',           // Column: النشاط
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
    startRow: 6,                    // Data starts at Row 6 (index 5)
    columns: {
      transaction_date: 0,          // Column 0: التاريخ (Excel serial)
      direction:        1,          // Column 1: نوع (د=وارد، م=منصرف)
      document_number:  2,          // Column 2: رقم المستند
      recipient_name:   3,          // Column 3: المستلم / المسلم
      narration:        4,          // Column 4: البيان
      amount:           14,         // Column 14: القيمة
      debit:            15,         // Column 15: مدين
      credit:           16,         // Column 16: دائن
      balance:          17,         // Column 17: الرصيد
    },
  },
}

// ─── ملف المخازن ────────────────────────────────────────────
export const INVENTORY_CONFIG = {
  file: 'مخازن نواة المستقبل2025-2026.xlsx',
  sheet: {
    name:     'البيانات',
    startRow: 4,                    // Data starts at Row 4 (index 3)
    columns: {
      movement_date:    3,          // Column 3: التاريخ (Excel serial)
      warehouse:        4,          // Column 4: المخزن
      movement_type:    5,          // Column 5: النوع (اضافة/صرف)
      item_name:        12,         // Column 12: الصنف
      unit:             13,         // Column 13: الوحدة
      quantity:         23,         // Column 23: الكمية
      unit_price:       24,         // Column 24: الفئة / السعر
      quantity_in:      25,         // Column 25: كمية الوارد
      quantity_out:     26,         // Column 26: كمية المنصرف
      value_in:         28,         // Column 28: قيمة الوارد
      value_out:        29,         // Column 29: قيمة المنصرف
    },
  },
}
