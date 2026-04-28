import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, Loader2, CheckCircle2, AlertTriangle, Settings2, Save, RotateCcw } from 'lucide-react'
import { glApi } from '../../api/client'
import { Link } from 'react-router-dom'
import { useToast } from '../../contexts/ToastContext'
import { useAppStore } from '../../store/appStore'
import { GL_MAPPING_KEYS, GL_MAPPING_GROUPS, validateMappingCoverage, buildMappingPayload, SavedMapping } from '../../lib/gl/glSchema'
import AccountPicker from '../../components/gl/AccountPicker'

// Groups and keys sourced from GL_MAPPING_GROUPS / GL_MAPPING_KEYS in glSchema.

// ════════════════════════════════════════════════════════════
export default function GLMappingsPage() {
  const qc        = useQueryClient()
  const { toast } = useToast()
  const companyId = useAppStore(s => s.company?.id)
  const scope     = companyId ? String(companyId) : undefined
  const [edits, setEdits] = useState<Record<string, string>>({})

  const { data: mappings = [], isLoading: mappingLoading } = useQuery({
    queryKey: ['gl-mappings'],
    queryFn:  glApi.mappings,
    staleTime: 60_000,
    select: (d) => d as SavedMapping[],
  })
  // AccountPicker loads its own account list; no separate query needed here.

  const saveMut = useMutation({
    mutationFn: () => glApi.saveMappings({ mappings: buildMappingPayload(edits, mappings) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-mappings'] })
      setEdits({})
      toast('تم حفظ ربط الحسابات بنجاح', 'success')
    },
    onError: () => toast('فشل حفظ ربط الحسابات — تحقق من الاتصال', 'error'),
  })

  const isDirty = Object.keys(edits).length > 0

  function getValue(key: string): string {
    return edits[key] ?? mappings.find(m => m.mapping_key === key)?.account_code ?? ''
  }

  function handleChange(key: string, value: string) {
    setEdits(prev => ({ ...prev, [key]: value }))
  }

  function discardEdits() {
    setEdits({})
  }

  // Coverage check
  const { configured, total, coverage, missingRequired: missingReq } = validateMappingCoverage(
    GL_MAPPING_KEYS.map(k => k.key).filter(key => getValue(key))
  )


  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto" dir="rtl">

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        هذا المسار قديم وموجود للتوافق فقط. مسار الترحيل المعتمد الآن هو
        {' '}
        <Link to="/gl/posting-setup" className="font-semibold underline">إعداد الترحيل</Link>
        {' '}
        مع
        {' '}
        <Link to="/gl/posting-groups" className="font-semibold underline">مجموعات الترحيل</Link>.
      </div>

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
          {isDirty && (
            <>
              <button
                onClick={discardEdits}
                disabled={saveMut.isPending}
                className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
              >
                <RotateCcw size={14} />
                تجاهل التغييرات
              </button>
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors shadow-sm"
              >
                {saveMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {saveMut.isPending ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}
              </button>
            </>
          )}
          <Link
            to="/gl/integrations"
            className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors border border-indigo-200"
          >
            <Settings2 size={15} />
            حوكمة الربط
          </Link>
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
              غير مُعيَّن: {(missingReq || []).map(k => k.label).join(' · ')}
            </p>
          )}
        </div>
        <div className="shrink-0 text-left">
          <p className={`text-2xl font-bold ${missingReq.length === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {coverage}%
          </p>
          <p className="text-xs text-gray-500">{configured}/{total} مُعيَّن</p>
        </div>
      </div>

      {/* Mapping groups */}
      {mappingLoading ? (
        <div className="flex justify-center py-16 text-gray-400"><Loader2 className="animate-spin" size={32} /></div>
      ) : (
        <div className="space-y-6">
          {GL_MAPPING_GROUPS.map(group => (
            <div key={group}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{group}</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
              <div className="space-y-2">
                {GL_MAPPING_KEYS.filter(k => k.group === group).map(item => {
                  const val = getValue(item.key)
                  return (
                    <div
                      key={item.key}
                      className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                        !val && item.required ? 'border-red-200 bg-red-50/50' :
                        edits[item.key] !== undefined ? 'border-teal-200 bg-teal-50/20' :
                        'border-gray-100 bg-white hover:border-gray-200'
                      }`}
                    >
                      {/* Key info */}
                      <div className="w-52 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                          {item.required && <span className="text-[10px] text-red-500 font-bold">*</span>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{item.description}</p>
                        <code className="text-[10px] text-gray-300 font-mono">{item.key}</code>
                      </div>

                      {/* Account picker — search + favorites built-in */}
                      <div className="flex-1">
                        <AccountPicker
                          value={val || null}
                          onChange={v => handleChange(item.key, v ?? '')}
                          storageScope={scope}
                          showFavorites
                        />
                        {edits[item.key] !== undefined && (
                          <p className="text-[10px] text-teal-600 mt-1 font-medium">● تم التعديل — لم يُحفظ بعد</p>
                        )}
                      </div>

                      {/* Required / optional badge */}
                      <div className="w-24 shrink-0 text-left">
                        {item.required ? (
                          val
                            ? <span className="text-xs text-emerald-600 font-medium">✓ مُعيَّن</span>
                            : <span className="text-xs text-red-500 font-medium">مطلوب</span>
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
    </div>
  )
}
