// Central GL schema — single source of truth for all mapping keys.
// Import from here instead of defining local arrays in individual pages.

export interface GlMappingKeyDef {
  key:         string
  label:       string
  group:       string
  description: string
  required:    boolean
}

export const GL_MAPPING_KEYS: GlMappingKeyDef[] = [
  // Assets
  { key: 'cash',             label: 'الخزينة الرئيسية',       group: 'أصول',              description: 'يُستخدم في قيود المقبوضات والمدفوعات النقدية',                                    required: true  },
  { key: 'bank',             label: 'حساب البنك',              group: 'أصول',              description: 'يُستخدم في مطابقة كشوف البنك والتحويلات',                                         required: false },
  { key: 'inventory',        label: 'المخزون',                 group: 'أصول',              description: 'يُستخدم في إضافة وصرف المخزون',                                                   required: true  },
  // Liabilities
  { key: 'accounts_payable', label: 'الدائنون / الموردون',    group: 'التزامات',           description: 'يُستخدم في فواتير الموردين وأوامر الشراء',                                        required: true  },
  { key: 'wages_payable',    label: 'مستحقات الرواتب',         group: 'التزامات',           description: 'الالتزام المقابل عند اعتماد الرواتب قبل الصرف (CR مستحقات)',                      required: true  },
  { key: 'deferred_revenue', label: 'إيرادات مؤجلة',           group: 'التزامات',           description: 'يُستخدم عند استلام دفعات مقدمة من عقود البيع (CR مؤجل)',                         required: false },
  // Equity
  { key: 'equity',               label: 'حقوق الملكية',               group: 'حقوق ملكية',       description: 'يُستخدم عند إضافة رأس مال شريك جديد (CR ملكية)',                                required: false },
  { key: 'partner_current_acct', label: 'حساب الشريك الجاري',         group: 'حقوق ملكية',       description: 'الحساب الجاري للشريك — يفصل بين رأس المال والسحوبات الجارية (CR/DR)',           required: false },
  // Revenue
  { key: 'revenue_default',  label: 'الإيرادات (افتراضي)',    group: 'إيرادات',            description: 'يُستخدم في المقبوضات النقدية غير المصنّفة',                                       required: true  },
  // Expenses
  { key: 'expense_default',  label: 'المصروفات (افتراضي)',    group: 'مصروفات',            description: 'يُستخدم في المدفوعات النقدية وصرف المخزون غير المصنّف',                          required: true  },
  { key: 'purchases',        label: 'المشتريات',               group: 'مصروفات',            description: 'يُستخدم في فواتير الموردين (DR المشتريات / CR الموردون)',                         required: true  },
  { key: 'wages',            label: 'أجور ورواتب',             group: 'مصروفات',            description: 'يُستخدم في اعتماد مسيرات الرواتب (DR أجور / CR مستحقات)',                        required: true  },
  { key: 'cogs',             label: 'تكلفة البضاعة المباعة',   group: 'مصروفات',            description: 'يُستخدم في تكلفة عمالة الحقول وأوامر العمل (DR تكلفة / CR مستحقات)',             required: true  },
  // Harvest GL — only needed when harvest integration is enabled
  { key: 'receivable_default', label: 'الذمم المدينة / عملاء', group: 'حصاد (اختياري)',    description: 'الجانب المدين لقيد إيراد الحصاد (DR ذمم عملاء أو صندوق)',                        required: false },
  { key: 'harvest_revenue',    label: 'إيراد الحصاد',           group: 'حصاد (اختياري)',    description: 'الجانب الدائن لقيد إيراد الحصاد (CR إيرادات الموسم)',                             required: false },
  { key: 'harvest_cogs',       label: 'تكلفة الحصاد (COGS)',    group: 'حصاد (اختياري)',    description: 'الجانب المدين لقيد تكلفة الحصاد — مطلوب مع حساب المخزون',                        required: false },
]

export const GL_MAPPING_GROUPS = [...new Set(GL_MAPPING_KEYS.map(k => k.group))]

export const GL_REQUIRED_KEYS = GL_MAPPING_KEYS.filter(k => k.required)

export function glMappingByKey(key: string): GlMappingKeyDef | undefined {
  return GL_MAPPING_KEYS.find(k => k.key === key)
}

export interface SavedMapping { mapping_key: string; account_code: string }

/**
 * Merge pending edits over the persisted mapping list and return the API payload.
 * This is the single place where "edits win over existing" logic lives.
 * UI components must call this rather than inlining the transform.
 */
export function buildMappingPayload(
  edits:    Record<string, string>,
  existing: SavedMapping[],
): SavedMapping[] {
  return GL_MAPPING_KEYS
    .map(k => ({
      mapping_key:  k.key,
      account_code: edits[k.key] ?? existing.find(m => m.mapping_key === k.key)?.account_code ?? '',
    }))
    .filter((m): m is SavedMapping => !!m.account_code)
}

export function validateMappingCoverage(configuredKeys: string[]): {
  configured: number
  total:      number
  coverage:   number
  missingRequired: GlMappingKeyDef[]
} {
  const configuredSet  = new Set(configuredKeys)
  const configured     = GL_MAPPING_KEYS.filter(k => configuredSet.has(k.key)).length
  const missingRequired = GL_REQUIRED_KEYS.filter(k => !configuredSet.has(k.key))
  return {
    configured,
    total:    GL_MAPPING_KEYS.length,
    coverage: Math.round((configured / GL_MAPPING_KEYS.length) * 100),
    missingRequired,
  }
}
