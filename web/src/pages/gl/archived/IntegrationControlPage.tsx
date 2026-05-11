import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  ShieldCheck, Loader2, Power, Settings2, AlertCircle, ArrowLeft, 
  CheckCircle2, LayoutGrid, Info, Zap
} from 'lucide-react'
import { configApi, glApi } from '../../api/client'
import { Link } from 'react-router-dom'

const MODULE_INFO: Record<string, { label: string; description: string; icon: string; relatedKeys: string[] }> = {
  inventory: { 
    label: 'حوكمة المخزون', 
    description: 'الأتمتة الكاملة لحركات الإضافة، الصرف، والشراء المخزني مع الربط المباشر بحسابات الأصول.',
    icon: '📦',
    relatedKeys: ['inventory', 'purchases']
  },
  operations: { 
    label: 'حوكمة التكاليف التشغيلية', 
    description: 'تحويل أوامر العمل والعمالة الميدانية إلى قيود تكاليف إنتاج (COGS) ومركز تكلفة.',
    icon: '🚜',
    relatedKeys: ['cogs', 'wages_payable']
  },
  hr_payroll: { 
    label: 'حوكمة الرواتب', 
    description: 'معالجة مسيرات الرواتب وإثبات الالتزامات والمدفوعات في دفتر الأستاذ العام.',
    icon: '👥',
    relatedKeys: ['wages', 'wages_payable']
  },
  harvest: { 
    label: 'حوكمة الحصاد والمبيعات', 
    description: 'إثبات إيرادات المواسم وتكلفة الإنتاج المباع وربطها بمديونيات العملاء.',
    icon: '🌾',
    relatedKeys: ['harvest_revenue', 'harvest_cogs', 'receivable_default']
  },
}

export default function IntegrationControlPage() {
  const qc = useQueryClient()
  const [updating, setUpdating] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  const { data: integrations = [], isLoading: intLoading } = useQuery({
    queryKey: ['gl-integrations'],
    queryFn:  configApi.integrations,
  })

  const { data: postingHealth, isLoading: healthLoading } = useQuery({
    queryKey: ['gl-posting-health'],
    queryFn:  glApi.postingHealth,
  })

  const toggleMut = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      configApi.updateIntegration(key, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-integrations'] })
      setUpdating(null)
    },
    onError: () => setUpdating(null),
  })

  const handleToggle = (key: string, currentStatus: number, isReady: boolean) => {
    const enabling = currentStatus === 0
    if (enabling && !isReady) {
      // Show confirmation before enabling a module that lacks setup
      setConfirmKey(key)
      return
    }
    setUpdating(key)
    toggleMut.mutate({ key, enabled: enabling })
  }

  const isLoading = intLoading || healthLoading
  const activeCount = integrations.filter(i => i.is_enabled === 1).length
  const moduleCount = integrations.length
  const readinessChecks = [
    postingHealth?.setup?.has_catch_all_general === true,
    postingHealth?.setup?.has_catch_all_inventory === true,
    (postingHealth?.entities?.suppliers_missing_group ?? 1) === 0,
    (postingHealth?.entities?.items_missing_group ?? 1) === 0,
    (postingHealth?.entities?.warehouses_missing_group ?? 1) === 0,
  ]
  const readinessScore = Math.round((readinessChecks.filter(Boolean).length / readinessChecks.length) * 100)

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 md:p-8 space-y-10 max-w-6xl mx-auto font-sans" dir="rtl">
      
      {/* ── Header Section ────────────────────────────────────────── */}
      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-teal-500 rounded-3xl blur opacity-10 group-hover:opacity-20 transition duration-1000"></div>
        <div className="relative bg-white rounded-3xl p-6 md:p-10 border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-2xl shadow-indigo-200">
              <ShieldCheck size={32} className="text-white" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">مركز حوكمة الربط المالي</h1>
              <p className="text-slate-500 font-medium">التحكم المؤسسي في الأتمتة بين العمليات ودفتر الأستاذ</p>
            </div>
          </div>

          <div className="flex gap-4">
              <div className="bg-indigo-50 px-5 py-3 rounded-2xl border border-indigo-100 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-indigo-400 font-bold mb-1">الموديولات النشطة</p>
                    <p className="text-2xl font-black text-indigo-700">{activeCount} / {moduleCount || 0}</p>
              </div>
              <div className="bg-teal-50 px-5 py-3 rounded-2xl border border-teal-100 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-teal-400 font-bold mb-1">جاهزية التهيئة</p>
                  <p className="text-2xl font-black text-teal-700">{readinessScore}%</p>
              </div>
          </div>
        </div>
      </div>

      {/* ── Status Banner ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-gradient-to-br from-slate-900 to-slate-800 rounded-[2.5rem] p-8 text-white relative overflow-hidden shadow-2xl">
              <div className="absolute -right-20 -top-20 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl"></div>
              <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
                  <div className="w-20 h-20 bg-white/10 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/20">
                    <Zap size={32} className="text-amber-400" />
                  </div>
                  <div className="space-y-3 text-center md:text-right">
                      <h3 className="text-xl font-bold">السيادة المالية والرقابة الذاتية</h3>
                      <p className="text-slate-300 text-sm leading-relaxed max-w-xl">
                          تضمن حوكمة الربط عدم خروج أي مبالغ أو دخول أي بضائع للمخازن دون إثبات محاسبي تلقائي. 
                          هذا النظام يمنع الثغرات المالية ويضمن توازن الميزانية لحظة بلحظة.
                      </p>
                      <div className="flex flex-wrap gap-3 pt-2 justify-center md:justify-start">
                          <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-3 py-1 rounded-full border border-emerald-500/30">دقة بنسبة 100%</span>
                          <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold px-3 py-1 rounded-full border border-indigo-500/30">ترحيل فوري</span>
                          <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-3 py-1 rounded-full border border-amber-500/30">تحليل مراكز تكلفة</span>
                      </div>
                  </div>
              </div>
          </div>

          <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200 shadow-sm flex flex-col justify-center gap-6">
              <div className="space-y-1">
                  <h4 className="text-slate-900 font-bold">وضع التهيئة المتقدم</h4>
                  <p className="text-slate-500 text-xs">تعطيل الربط يسمح بالإدخال التاريخي اليدوي.</p>
              </div>
              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex gap-3">
                  <AlertCircle size={20} className="text-amber-600 shrink-0" />
                  <p className="text-amber-800 text-[11px] leading-relaxed">
                    تحذير: التعطيل يوقف الترحيل التلقائي. كما أن التفعيل يخضع لسياسة جاهزية إلزامية من الباك إند لحماية دفتر الأستاذ.
                  </p>
              </div>
                <Link to="/gl/posting-setup" className="w-full btn-secondary text-center py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2">
                  <Settings2 size={16} /> تهيئة إعدادات الترحيل
              </Link>
          </div>
      </div>

      {/* ── Control Grid ──────────────────────────────────────────── */}
      <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-3">
                  <LayoutGrid size={20} className="text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-800">إعدادات الوحدات الوظيفية</h2>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400 bg-slate-100 px-4 py-1.5 rounded-full">
                  <Info size={14} /> يتم حفظ التغييرات تلقائياً في سجل التدقيق
              </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-32 text-slate-400 gap-4 bg-white rounded-[3rem] border border-dashed border-slate-200">
              <Loader2 className="animate-spin text-indigo-600" size={48} />
              <p className="text-sm font-medium">جاري تحليل بيانات الحوكمة...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {(integrations || []).map((item) => {
                const info = MODULE_INFO[item.module_key] || { 
                  label: item.module_key, 
                  description: 'إعدادات ربط مخصصة للنظام.',
                  icon: '⚙️',
                  relatedKeys: []
                }
                const isBusy = updating === item.module_key
                const isEnabled = item.is_enabled === 1
                
                // Check if related keys are mapped
                const moduleReadiness: Record<string, boolean> = {
                  inventory:
                    (postingHealth?.entities?.items_missing_group ?? 1) === 0 &&
                    (postingHealth?.entities?.warehouses_missing_group ?? 1) === 0 &&
                    postingHealth?.setup?.has_catch_all_inventory === true,
                  operations: postingHealth?.setup?.has_catch_all_general === true,
                  hr_payroll: postingHealth?.setup?.has_catch_all_general === true,
                  harvest: postingHealth?.setup?.has_catch_all_general === true,
                }
                const isReady = moduleReadiness[item.module_key] ?? false

                return (
                  <div 
                    key={item.module_key}
                    className={`group relative bg-white border-2 rounded-[2.75rem] p-8 transition-all duration-500 overflow-hidden ${
                      isEnabled 
                        ? 'border-indigo-100 shadow-xl shadow-indigo-100/20' 
                        : 'border-slate-100 bg-slate-50/30 grayscale-[0.8] hover:grayscale-0'
                    }`}
                  >
                    {/* Background Accent */}
                    <div className={`absolute top-0 right-0 w-32 h-32 blur-[80px] -mr-10 -mt-10 transition-opacity duration-500 ${isEnabled ? 'bg-indigo-400/20' : 'bg-slate-400/10 opacity-0 group-hover:opacity-100'}`} />

                    <div className="relative z-10 flex flex-col h-full justify-between gap-8">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-5">
                            <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center text-3xl shadow-inner transition-colors duration-500 ${isEnabled ? 'bg-indigo-50' : 'bg-slate-100'}`}>
                                {info.icon}
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-xl font-black text-slate-900 leading-tight">{info.label}</h3>
                                <div className="flex items-center gap-2">
                                    {isReady ? (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                            <CheckCircle2 size={10} /> مكتمل الربط
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                                            <AlertCircle size={10} /> يتطلب تهيئة
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => handleToggle(item.module_key, item.is_enabled, isReady)}
                            disabled={isBusy}
                            className={`relative inline-flex h-10 w-16 shrink-0 cursor-pointer rounded-full border-4 border-transparent transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 ${
                              isEnabled ? 'bg-indigo-600' : 'bg-slate-300'
                            } ${isBusy ? 'opacity-50 cursor-wait' : ''}`}
                        >
                            <span
                              className={`pointer-events-none inline-block h-8 w-8 transform rounded-full bg-white shadow-lg ring-0 transition duration-300 ease-in-out ${
                                isEnabled ? '-translate-x-6' : 'translate-x-0'
                              } flex items-center justify-center`}
                            >
                              {isBusy ? (
                                <Loader2 size={16} className="animate-spin text-indigo-600" />
                              ) : (
                                <Power size={16} className={isEnabled ? 'text-indigo-600' : 'text-slate-400'} />
                              )}
                            </span>
                        </button>
                      </div>

                      <p className="text-slate-500 text-sm leading-relaxed font-medium">
                        {info.description}
                      </p>

                      <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                              <div className={`w-2.5 h-2.5 rounded-full ${isEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                              <span className={`text-[11px] font-bold tracking-wide ${isEnabled ? 'text-emerald-600' : 'text-slate-500'}`}>
                                  {isEnabled ? 'الترحيل التلقائي نشط' : 'الترحيل التلقائي متوقف'}
                              </span>
                          </div>
                          {!isReady && (
                            <Link to="/gl/posting-setup" className="text-[11px] font-bold text-indigo-600 hover:underline flex items-center gap-1">
                                استكمال التهيئة <ArrowLeft size={10} />
                            </Link>
                          )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!!postingHealth?.issues?.length && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-800">
              <p className="font-bold mb-2">ملاحظة حوكمة:</p>
              <p>بعض الوحدات غير قابلة للتفعيل حتى اكتمال شروط الجاهزية التالية:</p>
              <ul className="mt-2 space-y-1 pr-4 list-disc">
                {postingHealth.issues.slice(0, 3).map((issue, idx) => (
                  <li key={idx}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
      </div>

      {/* ── Footer Info ──────────────────────────────────────────── */}
      <div className="bg-white/50 backdrop-blur-sm rounded-[3rem] p-10 border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-10">
          <div className="space-y-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
                  <CheckCircle2 size={20} />
              </div>
              <h4 className="text-slate-900 font-bold text-sm">توازن القيود</h4>
              <p className="text-slate-500 text-xs leading-relaxed">
                  يضمن المحرك المالي أن مجموع المدين يساوي الدائن دائماً قبل السماح بحفظ أي حركة تشغيلية من الموديولات النشطة.
              </p>
          </div>
          <div className="space-y-3">
              <div className="w-10 h-10 bg-teal-100 rounded-2xl flex items-center justify-center text-teal-600">
                  <LayoutGrid size={20} />
              </div>
              <h4 className="text-slate-900 font-bold text-sm">الأبعاد التحليلية</h4>
              <p className="text-slate-500 text-xs leading-relaxed">
                  يتم تلقائياً إلحاق أبعاد الحقول والمواسم ومراكز التكلفة بالقيود لضمان الحصول على تقارير ربحية دقيقة.
              </p>
          </div>
          <div className="space-y-3">
              <div className="w-10 h-10 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-600">
                  <ShieldCheck size={20} />
              </div>
              <h4 className="text-slate-900 font-bold text-sm">سجل التدقيق المؤسسي</h4>
              <p className="text-slate-500 text-xs leading-relaxed">
                  كل حركة تفعيل أو تعطيل للربط يتم أرشفتها مع اسم المستخدم والوقت لضمان المساءلة والشفافية التامة.
              </p>
          </div>
      </div>

      {/* ── Readiness Confirmation Modal ─────────────────────────── */}
      {confirmKey && (() => {
        const info = MODULE_INFO[confirmKey]
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" dir="rtl">
            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full space-y-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center text-3xl shrink-0">
                  {info?.icon ?? '⚙️'}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">تفعيل {info?.label ?? confirmKey}</h3>
                  <p className="text-sm text-amber-700 font-medium mt-0.5">التهيئة غير مكتملة</p>
                </div>
              </div>
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
                <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 leading-relaxed">
                  هذا الموديول يتطلب اكتمال إعدادات الترحيل (مجموعات + قاعدة افتراضية NULL×NULL) قبل التفعيل.
                  التفعيل بدون إعداد كامل قد يُنتج قيوداً غير متوازنة أو أخطاء في الترحيل.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setConfirmKey(null)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  إلغاء
                </button>
                <Link
                  to="/gl/posting-setup"
                  onClick={() => setConfirmKey(null)}
                  className="flex-1 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold text-center transition-colors"
                >
                  الذهاب لإكمال التهيئة
                </Link>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
