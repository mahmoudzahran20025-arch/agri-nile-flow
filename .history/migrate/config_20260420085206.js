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
    startRow: 2,                    // Row 1 = headers, Row 2+ = data
    columns: {
      code:     0,                  // Column 0: الكود
      name:     1,                  // Column 1: المورد
      activity: 2,                  // Column 2: النشاط
    },
  },

  // حركات الموردين من sheet البيان
  transSheet: {
    name:     'البيان',
    startRow: 4,                    // Row 1-2 = summary, Row 3 = headers, Row 4+ = data
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
    startRow: 6,                    // Row 5 = headers, Row 6+ = data
    columns: {
      transaction_date: 0,          // Column 0: التاريخ
      direction:        1,          // Column 1: الحالة (د/م)
      document_number:  2,          // Column 2: رقم المستند
      recipient_name:   3,          // Column 3: المستلم / المسلم
      narration:        4,          // Column 4: البيان
      season_service:   5,          // Column 5: الموسم / الخدمة
      notes:            6,          // Column 6: ملاحظات
      supplier_code:    7,          // Column 7: كود المورد
      center_code:      8,          // Column 8: كود المركز
      expense_code:     9,          // Column 9: كود المصروف
      sub_code:         10,         // Column 10: كود SUB
      unit:             11,         // Column 11: الوحدة
      quantity:         12,         // Column 12: الكمية
      unit_price:       13,         // Column 13: السعر
      amount:           14,         // Column 14: القيمة
      debit:            15,         // Column 15: مدين
      credit:           16,         // Column 16: دائن
      running_balance:  17,         // Column 17: الرصيد
      year:             23,         // Column 23: عام الانشاء
      month:            24,         // Column 24: شهر الانشاء
    },
  },
}

// ─── ملف المخازن ────────────────────────────────────────────
export const INVENTORY_CONFIG = {
  file: 'مخازن نواة المستقبل2025-2026.xlsx',
  sheet: {
    name:     'البيانات',
    startRow: 4,                    // Row 3 = headers, Row 4+ = data
    columns: {
      year:             1,          // Column 1: السنة
      month:            2,          // Column 2: الشهر
      movement_date:    3,          // Column 3: التاريخ
      warehouse:        4,          // Column 4: المخزن
      movement_type:    5,          // Column 5: النوع (اضافة/صرف)
      document_number:  6,          // Column 6: رقم المستند
      supplier_code:    9,          // Column 9: كود المورد
      item_code:        11,         // Column 11: كود الصنف
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
