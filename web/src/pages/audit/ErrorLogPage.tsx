import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  Activity, AlertCircle, ShieldAlert, Code, Globe, 
  User, Building2, ChevronRight, ChevronDown, 
  Trash2, RefreshCcw, Bug
} from 'lucide-react'
import { auditApi } from '../../api/client'
import { useAppStore } from '../../store/appStore'

interface ErrorLogEntry {
  id: number
  company_id: number | null
  user_id: number | null
  endpoint: string
  method: string
  error_message: string
  stack_trace: string | null
  request_payload: string | null
  created_at: string
  user_name: string | null
  company_name: string | null
}

export default function ErrorLogPage() {
  const { role } = useAppStore()
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['error-logs', page],
    queryFn: () => auditApi.errors({ page, size: 20 }),
  })

  const entries = data?.data ?? []
  const total   = data?.total ?? 0

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="glass p-8 rounded-[2.5rem] flex flex-col md:flex-row items-center justify-between gap-8 bg-gradient-to-br from-rose-50 to-white border-rose-100">
        <div className="flex items-center gap-6">
          <div className="p-4 bg-rose-600 text-white rounded-3xl shadow-xl shadow-rose-200">
            <ShieldAlert size={40} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter">مركز مراقبة الأعطال</h1>
            <p className="text-rose-600/70 font-black uppercase text-xs tracking-widest mt-1">System Health & Diagnostic Center</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => refetch()}
            className="btn-secondary h-12 px-6 rounded-2xl bg-white border-rose-200 hover:border-rose-500 text-rose-600 transition-all flex items-center gap-2 font-bold"
          >
            <RefreshCcw size={18} />
            <span>تحديث البيانات</span>
          </button>
          <div className="px-6 py-3 bg-white rounded-2xl border border-rose-100 shadow-sm">
             <p className="text-[10px] font-black text-slate-400 uppercase">الأخطاء المسجلة</p>
             <p className="text-2xl font-black text-rose-600 leading-tight">{total.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Analytics Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="card p-6 bg-slate-900 text-white border-none shadow-2xl">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">أكثر الروابط تعطلاً</p>
            <div className="space-y-3">
               <div className="flex items-center justify-between">
                 <span className="text-xs font-mono text-blue-400 truncate w-40">/api/inventory/movements</span>
                 <span className="badge bg-rose-500/20 text-rose-400 border-none font-black text-[10px]">12 عطل</span>
               </div>
               <div className="flex items-center justify-between">
                 <span className="text-xs font-mono text-blue-400 truncate w-40">/api/finance/cash</span>
                 <span className="badge bg-amber-500/20 text-amber-400 border-none font-black text-[10px]">5 أعطال</span>
               </div>
            </div>
         </div>
         
         <div className="md:col-span-2 card p-6 border-slate-100 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 w-1 h-full bg-rose-500" />
            <div className="flex items-center gap-3 mb-4">
              <Bug className="text-rose-600" />
              <h3 className="font-black text-slate-800 tracking-tight">نظرة عامة على استقرار النظام</h3>
            </div>
            <div className="h-24 flex items-end gap-1.5 px-2">
               {[40, 20, 60, 30, 90, 40, 20, 10, 5, 15, 8, 4].map((v, i) => (
                 <div 
                   key={i} 
                   className={`flex-1 rounded-t-lg transition-all duration-1000 ${v > 50 ? 'bg-rose-500' : 'bg-emerald-400'}`} 
                   style={{ height: `${v}%` }}
                 />
               ))}
            </div>
            <div className="flex justify-between mt-2 px-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">
               <span>قبل 12 ساعة</span>
               <span>الآن</span>
            </div>
         </div>
      </div>

      {/* Error List */}
      <div className="card overflow-hidden border-none shadow-xl">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 animate-pulse">
            <Code className="text-rose-200 mb-4 animate-spin-slow" size={48} />
            <p className="text-slate-400 font-bold italic text-sm tracking-widest uppercase">جاري تشخيص النظام...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-20 text-center">
            <AlertCircle size={64} className="mx-auto text-emerald-100 mb-4" />
            <p className="text-slate-500 font-bold text-lg">النظام مستقر حالياً</p>
            <p className="text-slate-400 text-sm mt-1">لم يتم تسجيل أي أخطاء حرجة في الفترة المحددة</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {entries.map((entry: ErrorLogEntry) => (
              <div 
                key={entry.id} 
                className={`transition-all ${expandedId === entry.id ? 'bg-rose-50/30' : 'hover:bg-slate-50/50'}`}
              >
                <div 
                  className="p-6 flex items-center gap-6 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                >
                  <div className="w-12 h-12 flex-shrink-0 bg-white rounded-2xl flex items-center justify-center shadow-md border border-rose-50">
                    {expandedId === entry.id ? <ChevronDown size={24} className="text-rose-600" /> : <ChevronRight size={24} className="text-slate-300" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-black text-rose-600 bg-rose-100/50 px-2.5 py-1 rounded-lg text-xs uppercase tracking-widest border border-rose-100">
                        {entry.method}
                      </span>
                      <span className="font-mono text-sm font-bold text-slate-800 truncate">{entry.endpoint}</span>
                    </div>
                    <p className="text-sm font-black text-rose-700/80 line-clamp-1">{entry.error_message}</p>
                    <div className="flex items-center gap-4 mt-2">
                       <span className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
                         <Globe size={14} /> {new Date(entry.created_at).toLocaleString('ar-EG')}
                       </span>
                       {entry.user_name && (
                         <span className="flex items-center gap-1.5 text-xs text-slate-400 font-bold border-r pr-4 border-slate-200">
                           <User size={14} /> {entry.user_name}
                         </span>
                       )}
                       {role === 'super_admin' && entry.company_name && (
                         <span className="flex items-center gap-1.5 text-xs text-brand-600 font-black border-r pr-4 border-slate-200 uppercase tracking-wider">
                           <Building2 size={14} /> {entry.company_name}
                         </span>
                       )}
                    </div>
                  </div>

                  <button className="btn-ghost p-3 text-slate-300 hover:text-rose-600 transition-colors">
                    <Trash2 size={20} />
                  </button>
                </div>

                {expandedId === entry.id && (
                  <div className="px-24 pb-8 animate-fade-in">
                    <div className="glass p-8 rounded-3xl border-rose-100 bg-white space-y-8 shadow-inner">
                       <div className="space-y-3">
                         <div className="flex items-center justify-between">
                            <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                              <Code size={18} className="text-rose-500" />
                              تتبع الخطأ (Stack Trace)
                            </h4>
                            <button 
                              onClick={() => navigator.clipboard.writeText(entry.stack_trace ?? '')}
                              className="text-[10px] font-black text-rose-600 hover:underline"
                            >نسخ التتبع</button>
                         </div>
                         <pre className="text-[11px] font-mono bg-slate-900 text-slate-300 p-6 rounded-2xl overflow-auto max-h-[400px] leading-relaxed shadow-2xl">
                           {entry.stack_trace || 'لا يوجد تتبع متاح لهذا الخطأ'}
                         </pre>
                       </div>

                       {entry.request_payload && (
                         <div className="space-y-3">
                           <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                             <Activity size={18} className="text-blue-500" />
                             بيانات الطلب (Payload)
                           </h4>
                           <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                             <code className="text-xs text-slate-600 break-all">
                               {entry.request_payload}
                             </code>
                           </div>
                         </div>
                       )}

                       <div className="pt-6 border-t border-rose-100 flex justify-between items-center">
                         <div className="flex items-center gap-2 text-rose-600">
                           <AlertCircle size={16} />
                           <span className="text-[10px] font-black uppercase tracking-widest italic">تم عزل هذا الخطأ وتوثيقه آلياً</span>
                         </div>
                         <button className="btn-primary bg-slate-900 hover:bg-black border-none h-10 px-6 rounded-xl text-xs font-black">
                           إنشاء تذكرة دعم فني
                         </button>
                       </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-center gap-3 mt-10">
           <button 
             disabled={page === 1}
             onClick={() => { setPage(p => p - 1); window.scrollTo(0, 0) }}
             className="w-12 h-12 flex items-center justify-center bg-white border border-slate-200 rounded-2xl text-slate-600 hover:border-rose-500 hover:text-rose-600 transition-all disabled:opacity-30"
           >←</button>
           <span className="font-black text-slate-900 text-lg">
             {page} <span className="text-slate-300 mx-1">/</span> {Math.ceil(total / 20)}
           </span>
           <button 
             disabled={page * 20 >= total}
             onClick={() => { setPage(p => p + 1); window.scrollTo(0, 0) }}
             className="w-12 h-12 flex items-center justify-center bg-white border border-slate-200 rounded-2xl text-slate-600 hover:border-rose-500 hover:text-rose-600 transition-all disabled:opacity-30"
           >→</button>
        </div>
      )}
    </div>
  )
}
