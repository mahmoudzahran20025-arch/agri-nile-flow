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
    startRow: 3,                    // Row 1 = summary, Row 2 = headers, Row 3+ = data
    columns: {
      transaction_date: 0,          // Column 0: التاريخ
      amount_in:        5,          // Column 5: الوارد (استلام مبلغ)
      amount_out:       6,          // Column 6: المنصرف (صرف مبلغ)
      balance:          7,          // Column 7: الرصيد
      narration:        3,          // Column 3: البيان (اختياري)
    },
  },
}

// ─── ملف المخازن ────────────────────────────────────────────
export const INVENTORY_CONFIG = {
  file: 'مخازن نواة المستقبل2025-2026.xlsx',
  sheet: {
    name:     'البيانات',
    startRow: 3,                    // Row 1 = summary, Row 2 = headers, Row 3+ = data
    columns: {
      warehouse:        4,          // Column 4: المخزن
      movement_type:    5,          // Column 5: النوع (اضافة/صرف)
      item_code:        10,         // Column 10: كود الصنف
      item_name:        11,         // Column 11: الصنف
      unit:             12,         // Column 12: الوحدة
      quantity_in:      24,         // Column 24: كمية الوارد
      quantity_out:     25,         // Column 25: كمية المنصرف
      quantity_balance: 26,         // Column 26: الرصيد (quantity)
      value_in:         27,         // Column 27: قيمة الوارد
      value_out:        28,         // Column 28: قيمة المنصرف
      value_balance:    29,         // Column 29: قيمة الرصيد
    },
  },
}
