/**
 * PostingSetupHealthPage — Dashboard showing posting setup coverage and readiness.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { glApi } from '../../api/gl'
import { useToast } from '../../contexts/ToastContext'

function StatCard({ label, value, sub, color = 'slate' }: { label: string; value: number | string; sub?: string; color?: 'green' | 'amber' | 'red' | 'slate' | 'blue' }) {
  const ring = {
    green: 'ring-emerald-200 bg-emerald-50',
    amber: 'ring-amber-200 bg-amber-50',
    red:   'ring-red-200 bg-red-50',
    slate: 'ring-slate-200 bg-slate-50',
    blue:  'ring-blue-200 bg-blue-50',
  }[color]

  const text = {
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    red:   'text-red-700',
    slate: 'text-slate-700',
    blue:  'text-blue-700',
  }[color]

  return (
    <div className={`rounded-xl ring-1 p-5 ${ring}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${text}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Transaction Flow Reference ──────────────────────────────────
const FLOWS = [
  {
    id: 'supplier_invoice',
    label: 'فاتورة مورد',
    trigger: 'عند استلام فاتورة شراء من مورد',
    engine: 'resolveSupplierInvoice',
    steps: [
      { side: 'DR', account: 'المشتريات (purchases)', source: 'general_posting_setup', code: 'PG-GPS-001' },
      { side: 'CR', account: 'الموردون / الدائنون (accounts_payable)', source: 'gl_account_mappings', code: null },
    ],
    color: 'blue',
  },
  {
    id: 'supplier_payment',
    label: 'دفعة مورد',
    trigger: 'عند تسجيل مدفوعة لمورد',
    engine: 'resolveSupplierPayment',
    steps: [
      { side: 'DR', account: 'الموردون / الدائنون (accounts_payable)', source: 'gl_account_mappings', code: null },
      { side: 'CR', account: 'الخزينة / البنك (cash / bank)', source: 'gl_account_mappings', code: null },
    ],
    color: 'indigo',
  },
  {
    id: 'inventory_in',
    label: 'حركة مخزون وارد',
    trigger: 'عند استلام بضاعة في المستودع',
    engine: 'resolveInventoryMovement',
    steps: [
      { side: 'DR', account: 'حساب المخزون (inventory_account)', source: 'inventory_posting_setup', code: 'PG-INV-001' },
      { side: 'CR', account: 'المشتريات (purchases)', source: 'general_posting_setup', code: 'PG-GPS-001' },
    ],
    color: 'teal',
  },
  {
    id: 'inventory_out',
    label: 'صرف مخزون / تكلفة',
    trigger: 'عند صرف بضاعة من المستودع',
    engine: 'resolveInventoryMovement',
    steps: [
      { side: 'DR', account: 'تكلفة البضاعة المباعة (cogs)', source: 'general_posting_setup', code: 'PG-GPS-002' },
      { side: 'CR', account: 'حساب المخزون (inventory_account)', source: 'inventory_posting_setup', code: 'PG-INV-001' },
    ],
    color: 'orange',
  },
  {
    id: 'expense',
    label: 'مصروف تشغيلي',
    trigger: 'عند تسجيل مدفوعة نقدية أو مصروف',
    engine: 'resolveExpensePosting',
    steps: [
      { side: 'DR', account: 'المصروفات (expense_account)', source: 'general_posting_setup', code: 'PG-GPS-002' },
      { side: 'CR', account: 'الخزينة / البنك (cash / bank)', source: 'gl_account_mappings', code: null },
    ],
    color: 'red',
  },
  {
    id: 'payroll',
    label: 'اعتماد رواتب',
    trigger: 'عند اعتماد مسير الرواتب',
    engine: 'resolvePayrollPosting',
    steps: [
      { side: 'DR', account: 'أجور ورواتب (wages)', source: 'gl_account_mappings', code: null },
      { side: 'CR', account: 'مستحقات الرواتب (wages_payable)', source: 'gl_account_mappings', code: null },
    ],
    color: 'purple',
  },
  {
    id: 'payroll_pay',
    label: 'صرف رواتب',
    trigger: 'عند صرف الرواتب للعمال',
    engine: 'resolvePayrollPosting',
    steps: [
      { side: 'DR', account: 'مستحقات الرواتب (wages_payable)', source: 'gl_account_mappings', code: null },
      { side: 'CR', account: 'الخزينة / البنك (cash / bank)', source: 'gl_account_mappings', code: null },
    ],
    color: 'slate',
  },
]

const COLOR_CLASSES: Record<string, { badge: string; sideDR: string; sideCR: string }> = {
  blue:   { badge: 'bg-blue-100 text-blue-700',     sideDR: 'bg-blue-50 text-blue-800 border-blue-200',   sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  indigo: { badge: 'bg-indigo-100 text-indigo-700', sideDR: 'bg-indigo-50 text-indigo-800 border-indigo-200', sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  teal:   { badge: 'bg-teal-100 text-teal-700',     sideDR: 'bg-teal-50 text-teal-800 border-teal-200',   sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  orange: { badge: 'bg-orange-100 text-orange-700', sideDR: 'bg-orange-50 text-orange-800 border-orange-200', sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  red:    { badge: 'bg-red-100 text-red-700',       sideDR: 'bg-red-50 text-red-800 border-red-200',     sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  purple: { badge: 'bg-purple-100 text-purple-700', sideDR: 'bg-purple-50 text-purple-800 border-purple-200', sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  slate:  { badge: 'bg-slate-100 text-slate-700',   sideDR: 'bg-slate-50 text-slate-800 border-slate-200', sideCR: 'bg-white text-slate-600 border-slate-100' },
}

function TransactionFlowReference() {
  const [open, setOpen] = useState(false)
  return (
    <div className="card overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-5 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-700">مرجع تدفق القيود المحاسبية</h2>
          <p className="text-xs text-slate-400 mt-0.5">كيف يُحوِّل المحرك كل نوع معاملة إلى قيد مدين/دائن</p>
        </div>
        <span className="text-slate-400 text-lg">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {FLOWS.map(flow => {
              const c = COLOR_CLASSES[flow.color] ?? COLOR_CLASSES.slate
              return (
                <div key={flow.id} className="rounded-xl border border-slate-100 bg-white p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${c.badge}`}>
                      {flow.label}
                    </span>
                    <p className="text-xs text-slate-500 leading-relaxed">{flow.trigger}</p>
                  </div>
                  <div className="space-y-1.5">
                    {flow.steps.map((step, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${step.side === 'DR' ? c.sideDR : c.sideCR}`}
                      >
                        <span className="font-black text-[11px] shrink-0 w-6">{step.side}</span>
                        <div className="flex-1">
                          <p className="font-medium leading-snug">{step.account}</p>
                          <p className="text-[10px] opacity-60 mt-0.5">
                            المصدر: {step.source}
                            {step.code && <span className="font-mono mr-1 opacity-80">[{step.code}]</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">engine: {flow.engine}()</p>
                </div>
              )
            })}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 leading-relaxed">
              <strong className="text-slate-700">منطق التسلسل الهرمي (4 مراحل):</strong>{' '}
              يبحث المحرك عن حساب بالترتيب: (1) تطابق تام BPG×PPG → (2) BPG فقط (PPG فارغ) →
              (3) PPG فقط (BPG فارغ) → (4) NULL×NULL (القاعدة الافتراضية). إذا لم يُعثر على حساب في أي مرحلة،
              يُرجع خطأ من نوع <span className="font-mono">PG-GPS-001</span> أو <span className="font-mono">PG-INV-001</span>.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PostingSetupHealthPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['posting-setup-health'],
    queryFn:  () => glApi.postingHealth(),
  })

  // Quick-fix: create catch-all general posting setup row
  const fixGeneral = useMutation({
    mutationFn: () => glApi.createGeneralSetup({
      business_posting_group: null,
      product_posting_group:  null,
    } as Parameters<typeof glApi.createGeneralSetup>[0]),
    onSuccess: (res: { success?: boolean; error?: string } | undefined) => {
      if (res && !res.success) { toast(res.error ?? 'خطأ في الإنشاء', 'error'); return }
      qc.invalidateQueries({ queryKey: ['posting-setup-health'] })
      toast('تم إنشاء قاعدة الافتراضي (General) — أكمل إعداد الحسابات في صفحة الإعداد', 'success')
    },
    onError: () => toast('فشل إنشاء القاعدة — قد تكون موجودة مسبقاً', 'error'),
  })

  // Quick-fix: create catch-all inventory posting setup row
  const fixInventory = useMutation({
    mutationFn: () => glApi.createInventorySetup({
      inventory_posting_group: null,
    } as Parameters<typeof glApi.createInventorySetup>[0]),
    onSuccess: (res: { success?: boolean; error?: string } | undefined) => {
      if (res && !res.success) { toast(res.error ?? 'خطأ في الإنشاء', 'error'); return }
      qc.invalidateQueries({ queryKey: ['posting-setup-health'] })
      toast('تم إنشاء قاعدة الافتراضي (Inventory) — أكمل إعداد الحسابات في صفحة الإعداد', 'success')
    },
    onError: () => toast('فشل إنشاء القاعدة — قد تكون موجودة مسبقاً', 'error'),
  })

  if (isLoading) {
    return (
      <div className="animate-fade-in py-20 text-center text-slate-400">
        جارٍ تحليل إعداد الترحيل...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="animate-fade-in py-20 text-center">
        <p className="text-red-500 mb-4">فشل تحميل تقرير الصحة</p>
        <button className="btn-secondary" onClick={() => refetch()}>إعادة المحاولة</button>
      </div>
    )
  }

  const { groups, setup, entities, issues, warnings, is_ready } = data

  return (
    <div className="animate-fade-in space-y-6">
      <div className="page-header">
        <h1 className="page-title">صحة إعداد الترحيل</h1>
        <p className="text-slate-500 text-sm mt-1">
          مراقبة تغطية مجموعات الترحيل وجاهزية النظام للترحيل التلقائي
        </p>
        <div className="mt-3">
          <Link to="/gl/setup-wizard" className="btn-secondary text-sm">فتح معالج الإعداد</Link>
        </div>
      </div>

      {/* Overall Status Banner */}
      <div className={`rounded-xl p-5 flex items-center gap-4 ${
        is_ready
          ? 'bg-emerald-50 border border-emerald-200'
          : 'bg-amber-50 border border-amber-200'
      }`}>
        <div className="text-3xl">{is_ready ? '✅' : '⚠️'}</div>
        <div>
          <p className={`font-semibold text-lg ${is_ready ? 'text-emerald-800' : 'text-amber-800'}`}>
            {is_ready
              ? 'النظام جاهز للترحيل التلقائي'
              : 'يحتاج الإعداد إلى اكتمال'}
          </p>
          <p className="text-sm text-slate-500">
            {is_ready
              ? 'تم تعريف قواعد الافتراضي (NULL/NULL). يمكن تفعيل محرك الترحيل الآن.'
              : `${issues.length} مشكلة تمنع الترحيل — راجع التفاصيل أدناه.`}
          </p>
        </div>
        <div className="mr-auto">
          <button className="btn-secondary text-sm" onClick={() => refetch()}>تحديث</button>
        </div>
      </div>

      {/* Groups Stats */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">مجموعات الترحيل المعرَّفة</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="مجموعات أعمال (BPG)" value={groups.business_posting_groups}
            color={groups.business_posting_groups > 0 ? 'green' : 'slate'}
            sub="للموردين والعملاء" />
          <StatCard label="مجموعات منتج (PPG)" value={groups.product_posting_groups}
            color={groups.product_posting_groups > 0 ? 'green' : 'slate'}
            sub="للأصناف والفئات" />
          <StatCard label="مجموعات مخزون (IPG)" value={groups.inventory_posting_groups}
            color={groups.inventory_posting_groups > 0 ? 'green' : 'slate'}
            sub="للمستودعات" />
        </div>
      </div>

      {/* Setup Stats */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">إعدادات الترحيل</h2>
        <div className="grid grid-cols-2 gap-4">
          <Link to="/gl/setup-wizard" className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-700">
            معالج الإعداد السريع
          </Link>
          <div className={`rounded-xl ring-1 p-5 ${setup.has_catch_all_general ? 'ring-emerald-200 bg-emerald-50' : 'ring-red-200 bg-red-50'}`}>
            <div className="flex items-start gap-3">
              <span className="text-2xl">{setup.has_catch_all_general ? '✅' : '❌'}</span>
              <div className="flex-1">
                <p className="font-medium text-sm">قاعدة الافتراضي — الإعداد العام</p>
                <p className="text-xs text-slate-500 mt-1">
                  صف NULL × NULL في general_posting_setup
                </p>
                <p className="text-xs font-mono text-slate-400 mt-1">
                  {setup.general_rows} صف إجمالاً
                </p>
              </div>
            </div>
            {!setup.has_catch_all_general && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => fixGeneral.mutate()}
                  disabled={fixGeneral.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {fixGeneral.isPending ? 'جارٍ الإنشاء...' : '⚡ إنشاء قاعدة افتراضية'}
                </button>
                <Link to="/gl/posting-setup?tab=general" className="text-xs text-blue-600 hover:underline">
                  → إعداد يدوي
                </Link>
              </div>
            )}
          </div>

          <div className={`rounded-xl ring-1 p-5 ${setup.has_catch_all_inventory ? 'ring-emerald-200 bg-emerald-50' : 'ring-red-200 bg-red-50'}`}>
            <div className="flex items-start gap-3">
              <span className="text-2xl">{setup.has_catch_all_inventory ? '✅' : '❌'}</span>
              <div className="flex-1">
                <p className="font-medium text-sm">قاعدة الافتراضي — إعداد المخزون</p>
                <p className="text-xs text-slate-500 mt-1">
                  صف NULL × NULL في inventory_posting_setup
                </p>
                <p className="text-xs font-mono text-slate-400 mt-1">
                  {setup.inventory_rows} صف إجمالاً
                </p>
              </div>
            </div>
            {!setup.has_catch_all_inventory && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => fixInventory.mutate()}
                  disabled={fixInventory.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {fixInventory.isPending ? 'جارٍ الإنشاء...' : '⚡ إنشاء قاعدة افتراضية'}
                </button>
                <Link to="/gl/posting-setup?tab=inventory" className="text-xs text-blue-600 hover:underline">
                  → إعداد يدوي
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Entity Coverage */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">تغطية الكيانات</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className={`rounded-xl ring-1 p-5 ${entities.suppliers_missing_group === 0 ? 'ring-emerald-200 bg-emerald-50' : 'ring-amber-200 bg-amber-50'}`}>
            <p className="text-xs text-slate-500 mb-1">موردون بدون مجموعة أعمال</p>
            <p className={`text-2xl font-bold ${entities.suppliers_missing_group === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
              {entities.suppliers_missing_group}
            </p>
            <p className="text-xs text-slate-400 mt-1">سيستخدمون قاعدة الافتراضي عند الترحيل</p>
            {entities.suppliers_missing_group > 0 && (
              <Link to="/suppliers" className="mt-2 block text-xs text-blue-600 hover:underline">
                → إدارة الموردين
              </Link>
            )}
          </div>
          <div className={`rounded-xl ring-1 p-5 ${entities.items_missing_group === 0 ? 'ring-emerald-200 bg-emerald-50' : 'ring-amber-200 bg-amber-50'}`}>
            <p className="text-xs text-slate-500 mb-1">أصناف بدون مجموعة منتج</p>
            <p className={`text-2xl font-bold ${entities.items_missing_group === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
              {entities.items_missing_group}
            </p>
            <p className="text-xs text-slate-400 mt-1">سيستخدمون قاعدة الافتراضي عند الترحيل</p>
            {entities.items_missing_group > 0 && (
              <Link to="/inventory" className="mt-2 block text-xs text-blue-600 hover:underline">
                → إدارة المخزون
              </Link>
            )}
          </div>
          <div className={`rounded-xl ring-1 p-5 ${entities.warehouses_missing_group === 0 ? 'ring-emerald-200 bg-emerald-50' : 'ring-amber-200 bg-amber-50'}`}>
            <p className="text-xs text-slate-500 mb-1">مستودعات بدون مجموعة مخزون</p>
            <p className={`text-2xl font-bold ${entities.warehouses_missing_group === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
              {entities.warehouses_missing_group}
            </p>
            <p className="text-xs text-slate-400 mt-1">سيستخدمون قاعدة الافتراضي عند الترحيل</p>
            {entities.warehouses_missing_group > 0 && (
              <Link to="/inventory/warehouses" className="mt-2 block text-xs text-blue-600 hover:underline">
                → إدارة المستودعات
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Issues (Blocking) */}
      {issues.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-sm font-semibold text-red-700 mb-3">❌ مشاكل تمنع الترحيل ({issues.length})</h2>
          <ul className="space-y-2">
            {issues.map((msg, i) => (
              <li key={i} className="text-sm text-red-700 flex items-start gap-2">
                <span className="mt-0.5 shrink-0">•</span>
                <span>{msg}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings (Advisory) */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-700 mb-3">⚠️ تنبيهات ({warnings.length})</h2>
          <ul className="space-y-2">
            {warnings.map((msg, i) => (
              <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                <span className="mt-0.5 shrink-0">•</span>
                <span>{msg}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-600 mt-3">
            التنبيهات لا تمنع الترحيل — الكيانات بدون مجموعة ستستخدم قاعدة الافتراضي (NULL/NULL).
          </p>
        </div>
      )}

      {/* Quick Links */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-600 mb-4">روابط سريعة</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link to="/gl/posting-groups" className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-700">
            📋 إدارة مجموعات الترحيل
          </Link>
          <Link to="/gl/posting-setup" className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-700">
            ⚙️ إعداد الترحيل (المصفوفة)
          </Link>
          <Link to="/gl/accounts" className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-700">
            📊 شجرة الحسابات
          </Link>
          <Link to="/gl/settings" className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-700">
            🔧 إعدادات المحاسبة
          </Link>
        </div>
      </div>

      {/* Transaction Flow Reference */}
      <TransactionFlowReference />
    </div>
  )
}
