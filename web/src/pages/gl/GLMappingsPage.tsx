import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Loader2, CheckCircle2, AlertTriangle, Save, Settings2 } from 'lucide-react'
import { glApi } from '../../api/client'
import { Link } from 'react-router-dom'

// ── Known mapping keys ────────────────────────────────────────
const MAPPING_KEYS: Array<{
  key: string; label: string; group: string
  description: string; required: boolean
}> = [
  // Assets
  { key: 'cash',             label: 'الخزينة الرئيسية',       group: 'أصول',       description: 'يُستخدم في قيود المقبوضات والمدفوعات النقدية',           required: true },
  { key: 'bank',             label: 'حساب البنك',              group: 'أصول',       description: 'يُستخدم في مطابقة كشوف البنك والتحويلات',                required: false },
  { key: 'inventory',        label: 'المخزون',                 group: 'أصول',       description: 'يُستخدم في إضافة وصرف المخزون',                         required: true },
  // Liabilities
  { key: 'accounts_payable', label: 'الدائنون / الموردون',    group: 'التزامات',   description: 'يُستخدم في فواتير الموردين وأوامر الشراء',               required: true },
  // Revenue
  { key: 'revenue_default',  label: 'الإيرادات (افتراضي)',    group: 'إيرادات',    description: 'يُستخدم في المقبوضات النقدية غير المصنّفة',              required: true },
  // Expenses
  { key: 'expense_default',  label: 'المصروفات (افتراضي)',    group: 'مصروفات',    description: 'يُستخدم في المدفوعات النقدية وصرف المخزون غير المصنّف',  required: true },
  { key: 'purchases',        label: 'المشتريات',               group: 'مصروفات',    description: 'يُستخدم في فواتير الموردين (DR المشتريات / CR الموردون)', required: true },
  { key: 'wages',            label: 'أجور ورواتب',             group: 'مصروفات',    description: 'يُستخدم في اعتماد مسيرات الرواتب (DR أجور / CR مستحقات)',  required: true },
  { key: 'cogs',             label: 'تكلفة البضاعة المباعة',   group: 'مصروفات',    description: 'يُستخدم في تكلفة عمالة الحقول وأوامر العمل (DR تكلفة / CR مستحقات)', required: true },
  // Liabilities
  { key: 'wages_payable',    label: 'مستحقات الرواتب',         group: 'التزامات',   description: 'الالتزام المقابل عند اعتماد الرواتب قبل الصرف (CR مستحقات)', required: true },
  { key: 'deferred_revenue', label: 'إيرادات مؤجلة',           group: 'التزامات',   description: 'يُستخدم عند استلام دفعات مقدمة من عقود البيع (CR مؤجل)',   required: false },
  // Equity
  { key: 'equity',           label: 'حقوق الملكية',            group: 'حقوق ملكية', description: 'يُستخدم عند إضافة رأس مال شريك جديد (CR ملكية)',            required: false },
  // Harvest GL — only needed when harvest integration is enabled
  { key: 'receivable_default', label: 'الذمم المدينة / عملاء', group: 'حصاد (اختياري)', description: 'الجانب المدين لقيد إيراد الحصاد (DR ذمم عملاء أو صندوق)',   required: false },
  { key: 'harvest_revenue',   label: 'إيراد الحصاد',           group: 'حصاد (اختياري)', description: 'الجانب الدائن لقيد إيراد الحصاد (CR إيرادات الموسم)',       required: false },
  { key: 'harvest_cogs',      label: 'تكلفة الحصاد (COGS)',    group: 'حصاد (اختياري)', description: 'الجانب المدين لقيد تكلفة الحصاد — مطلوب مع حساب المخزون',  required: false },
]

interface Mapping { mapping_key: string; account_code: string }
interface Account  { code: string; name: string; account_type: string; is_header: number }

const GROUPS = [...new Set(MAPPING_KEYS.map(k => k.group))]

// ════════════════════════════════════════════════════════════
export default function GLMappingsPage() {
  const qc = useQueryClient()
  const [local, setLocal] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string[]>([])

  const { data: mappings = [], isLoading: mappingLoading } = useQuery({
    queryKey: ['gl-mappings'],
    queryFn:  glApi.mappings,
    staleTime: 60_000,
    select: (d) => d as Mapping[],
  })

  const { data: accounts = [], isLoading: acctLoading } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn:  () => glApi.accounts(),
    staleTime: 120_000,
    select: (d) => (d as Account[]).filter(a => !a.is_header),
  })

  const saveMut = useMutation({
    mutationFn: (rows: { mapping_key: string; account_code: string }[]) =>
      glApi.saveMappings(rows),
    onSuccess: (_, rows) => {
      qc.invalidateQueries({ queryKey: ['gl-mappings'] })
      setSaved(rows.map(r => r.mapping_key))
      setLocal({})
      setTimeout(() => setSaved([]), 3000)
    },
  })

  function getValue(key: string): string {
    if (local[key] !== undefined) return local[key]
    return mappings.find(m => m.mapping_key === key)?.account_code ?? ''
  }

  function isDirty() {
    return Object.keys(local).length > 0
  }

  function handleSave() {
    const rows = Object.entries(local)
      .filter(([, v]) => v)
      .map(([mapping_key, account_code]) => ({ mapping_key, account_code }))
    if (rows.length > 0) saveMut.mutate(rows)
  }

  // Coverage check
  const configured  = MAPPING_KEYS.filter(k => getValue(k.key)).length
  const required    = MAPPING_KEYS.filter(k => k.required)
  const missingReq  = required.filter(k => !getValue(k.key))
  const coverage    = Math.round((configured / MAPPING_KEYS.length) * 100)

  const isLoading = mappingLoading || acctLoading

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center shadow-sm">
              <Link2 size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">ربط الحسابات التلقائية</h1>
              <p className="text-sm text-gray-500 mt-0.5">تحديد الحسابات المستخدمة في الترحيل التلقائي للقيود</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/gl/integrations"
            className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors border border-indigo-200"
          >
            <Settings2 size={15} />
            حوكمة الربط
          </Link>
          <button
            onClick={handleSave}
            disabled={!isDirty() || saveMut.isPending}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-sm"
          >
            {saveMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            حفظ التغييرات
          </button>
        </div>
      </div>

      {/* Coverage banner */}
      <div className={`rounded-2xl border p-4 flex items-center gap-4 ${
        missingReq.length === 0
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-amber-50 border-amber-200'
      }`}>
        {missingReq.length === 0 ? (
          <CheckCircle2 size={22} className="text-emerald-600 shrink-0" />
        ) : (
          <AlertTriangle size={22} className="text-amber-600 shrink-0" />
        )}
        <div className="flex-1">
          <p className={`text-sm font-bold ${missingReq.length === 0 ? 'text-emerald-800' : 'text-amber-800'}`}>
            {missingReq.length === 0
              ? 'جميع الحسابات مُعيَّنة — الترحيل التلقائي يعمل بالكامل'
              : `${missingReq.length} حساب ${missingReq.length === 1 ? 'مطلوب' : 'مطلوبة'} غير مُعيَّن — بعض القيود لن تُرحَّل`}
          </p>
          {missingReq.length > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">
              غير مُعيَّن: {missingReq.map(k => k.label).join(' · ')}
            </p>
          )}
        </div>
        <div className="shrink-0 text-left">
          <p className={`text-2xl font-bold ${missingReq.length === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {coverage}%
          </p>
          <p className="text-xs text-gray-500">{configured}/{MAPPING_KEYS.length} مُعيَّن</p>
        </div>
      </div>

      {/* Mapping groups */}
      {isLoading ? (
        <div className="flex justify-center py-16 text-gray-400"><Loader2 className="animate-spin" size={32} /></div>
      ) : (
        <div className="space-y-6">
          {GROUPS.map(group => (
            <div key={group}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{group}</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
              <div className="space-y-2">
                {MAPPING_KEYS.filter(k => k.group === group).map(item => {
                  const val     = getValue(item.key)
                  const isSaved = saved.includes(item.key)
                  const isDirtyRow = local[item.key] !== undefined
                  const selectedAcct = accounts.find(a => a.code === val)

                  return (
                    <div
                      key={item.key}
                      className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                        isSaved       ? 'border-emerald-300 bg-emerald-50' :
                        isDirtyRow    ? 'border-teal-300 bg-teal-50/50' :
                        !val && item.required ? 'border-red-200 bg-red-50/50' :
                        'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      {/* Key info */}
                      <div className="w-52 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                          {item.required && (
                            <span className="text-[10px] text-red-500 font-bold">*</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{item.description}</p>
                        <code className="text-[10px] text-gray-300 font-mono">{item.key}</code>
                      </div>

                      {/* Account selector */}
                      <div className="flex-1">
                        <select
                          className={`w-full border rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-teal-500 transition-colors ${
                            !val && item.required
                              ? 'border-red-300 focus:border-red-400'
                              : isDirtyRow
                              ? 'border-teal-400'
                              : 'border-gray-200'
                          }`}
                          value={val}
                          onChange={e => setLocal(l => ({ ...l, [item.key]: e.target.value }))}
                        >
                          <option value="">— اختر حساباً —</option>
                          {accounts
                            .sort((a, b) => a.code.localeCompare(b.code))
                            .map(a => (
                              <option key={a.code} value={a.code}>
                                {a.code} — {a.name}
                              </option>
                            ))}
                        </select>
                      </div>

                      {/* Status */}
                      <div className="w-32 shrink-0 text-left">
                        {isSaved ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium justify-end">
                            <CheckCircle2 size={13} /> محفوظ
                          </span>
                        ) : val && selectedAcct ? (
                          <div className="text-left">
                            <p className="text-xs font-medium text-gray-700">{selectedAcct.code}</p>
                            <p className="text-[11px] text-gray-400 truncate">{selectedAcct.name}</p>
                          </div>
                        ) : item.required ? (
                          <span className="text-xs text-red-500 font-medium">مطلوب</span>
                        ) : (
                          <span className="text-xs text-gray-300">اختياري</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save bar */}
      {isDirty() && (
        <div className="sticky bottom-4 flex justify-center">
          <div className="flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-xl">
            <span className="text-sm">{Object.keys(local).length} تغيير غير محفوظ</span>
            <button
              onClick={handleSave}
              disabled={saveMut.isPending}
              className="flex items-center gap-1.5 bg-teal-500 hover:bg-teal-400 rounded-xl px-4 py-1.5 text-sm font-semibold transition-colors"
            >
              {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              حفظ الآن
            </button>
            <button
              onClick={() => setLocal({})}
              className="text-gray-400 hover:text-white transition-colors text-sm"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
