import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Loader2, Power, Settings2, HelpCircle, AlertCircle, ArrowLeft } from 'lucide-react'
import { configApi } from '../../api/client'
import { Link } from 'react-router-dom'

const MODULE_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  harvest: { 
    label: 'ترحيل الحصاد', 
    description: 'إيرادات المبيعات وتكاليف البضاعة المباعة (Revenue/COGS)',
    icon: '🌾'
  },
  hr_payroll: { 
    label: 'ترحيل الرواتب', 
    description: 'إثبات مصروفات الأجور والالتزامات المستحقة (Wages/Payables)',
    icon: '👥'
  },
  inventory: { 
    label: 'ترحيل المخزون', 
    description: 'حركات الإضافة والصرف والمشتريات المخزنية',
    icon: '📦'
  },
  operations: { 
    label: 'ترحيل التكاليف التشغيلية', 
    description: 'تكاليف العمالة المباشرة من أوامر العمل الميدانية',
    icon: '🚜'
  },
}

export default function IntegrationControlPage() {
  const qc = useQueryClient()
  const [updating, setUpdating] = useState<string | null>(null)

  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['gl-integrations'],
    queryFn:  configApi.integrations,
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

  const handleToggle = (key: string, currentStatus: number) => {
    setUpdating(key)
    toggleMut.mutate({ key, enabled: currentStatus === 0 })
  }

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-5xl mx-auto" dir="rtl">
      
      {/* Breadcrumb & Header */}
      <div className="space-y-4">
        <Link to="/gl/mappings" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-teal-600 transition-colors">
          <ArrowLeft size={16} />
          العودة لربط الحسابات
        </Link>
        
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
              <ShieldCheck size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">حوكمة الربط المالي</h1>
              <p className="text-gray-500 mt-1">التحكم في الترحيل التلقائي بين الموديولات ودفتر الأستاذ</p>
            </div>
          </div>
        </div>
      </div>

      {/* Migration Mode Notice */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-3xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5">
            <HelpCircle size={120} className="text-amber-900" />
        </div>
        <div className="relative z-10 flex gap-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <AlertCircle className="text-amber-600" size={20} />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-amber-900">وضع التهيئة (Migration Mode)</h3>
            <p className="text-amber-800 text-sm leading-relaxed max-w-2xl">
                هذه الإعدادات تسمح لك بتعطيل الربط الآلي مؤقتاً عند الحاجة لإدخال بيانات تاريخية أو إجراء تسويات يدوية. 
                عند تعطيل الربط لموديول معين، سيتوقف النظام عن إنشاء قيود يومية تلقائية لهذا النوع من العمليات.
            </p>
          </div>
        </div>
      </div>

      {/* Control Grid */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-4">
          <Loader2 className="animate-spin text-indigo-600" size={40} />
          <p className="text-sm font-medium">جاري تحميل إعدادات الحوكمة...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {integrations.map((item) => {
            const info = MODULE_LABELS[item.module_key] || { 
              label: item.module_key, 
              description: 'إعدادات ربط مخصصة',
              icon: '⚙️'
            }
            const isBusy = updating === item.module_key
            const isEnabled = item.is_enabled === 1

            return (
              <div 
                key={item.module_key}
                className={`group relative bg-white border-2 rounded-[2.5rem] p-8 transition-all duration-300 ${
                  isEnabled 
                    ? 'border-indigo-100 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-50' 
                    : 'border-gray-100 bg-gray-50/50 grayscale'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-4 flex-1">
                    <div className="flex items-center gap-3">
                        <span className="text-3xl">{info.icon}</span>
                        <h2 className="text-xl font-bold text-gray-800">{info.label}</h2>
                    </div>
                    <p className="text-sm text-gray-500 leading-relaxed min-h-[3rem]">
                      {info.description}
                    </p>
                  </div>

                  <button
                    onClick={() => handleToggle(item.module_key, item.is_enabled)}
                    disabled={isBusy}
                    className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 ${
                      isEnabled ? 'bg-indigo-600' : 'bg-gray-300'
                    } ${isBusy ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        isEnabled ? '-translate-x-6' : 'translate-x-0'
                      } flex items-center justify-center`}
                    >
                      {isBusy ? (
                        <Loader2 size={12} className="animate-spin text-indigo-600" />
                      ) : (
                        <Power size={12} className={isEnabled ? 'text-indigo-600' : 'text-gray-400'} />
                      )}
                    </span>
                  </button>
                </div>

                <div className="mt-6 pt-6 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                        <span className={`text-xs font-bold ${isEnabled ? 'text-emerald-600' : 'text-gray-500'}`}>
                            {isEnabled ? 'الربط نشط حالياً' : 'الربط متوقف'}
                        </span>
                    </div>
                    <Link 
                        to="/gl/mappings"
                        className="text-xs text-gray-400 hover:text-indigo-600 flex items-center gap-1 transition-colors"
                    >
                        إعدادات الحسابات <Settings2 size={12} />
                    </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Extra Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-indigo-50/50 rounded-3xl p-6 border border-indigo-100">
              <h4 className="text-indigo-900 font-bold text-sm mb-2">الدقة المالية</h4>
              <p className="text-indigo-700 text-xs leading-relaxed">
                  عند تفعيل الربط، يضمن النظام توازن القيد المحاسبي (Debits = Credits) قبل السماح بحفظ أي عملية تشغيلية.
              </p>
          </div>
          <div className="bg-teal-50/50 rounded-3xl p-6 border border-teal-100">
              <h4 className="text-teal-900 font-bold text-sm mb-2">الأبعاد التحليلية</h4>
              <p className="text-teal-700 text-xs leading-relaxed">
                  يتم تلقائياً إدراج أبعاد الموسم والحقل ومركز التكلفة في جميع القيود المولدة آلياً لضمان دقة التقارير.
              </p>
          </div>
          <div className="bg-slate-50/50 rounded-3xl p-6 border border-slate-100">
              <h4 className="text-slate-900 font-bold text-sm mb-2">سجل المراجعة</h4>
              <p className="text-slate-700 text-xs leading-relaxed">
                  كل تغيير في هذه الإعدادات يتم تسجيله في سجل التدقيق (Audit Log) لضمان الشفافية والمحاسبة.
              </p>
          </div>
      </div>

    </div>
  )
}
