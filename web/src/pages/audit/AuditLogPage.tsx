import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  History, User, Database, 
  ChevronRight, ChevronDown, ArrowRight, Clock,
  Terminal, AlertCircle, Shield, Download
} from 'lucide-react'
import { auditApi, downloadCsv } from '../../api/client'
import type { Company } from '../../types'
import { useAppStore } from '../../store/appStore'

interface AuditLogEntry {
  id: number
  action: string
  table_name: string
  record_id: number | null
  old_value: string | null
  new_value: string | null
  source: string
  created_at: string
  user_name: string
  user_email: string
  company_name: string
  company_id: number
}

export default function AuditLogPage() {
  const { role } = useAppStore()
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({
    table: '',
    action: '',
    user_id: '',
    company_id: 'all',
    start: '',
    end: ''
  })
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data: companies } = useQuery({
    queryKey: ['admin-companies-list'],
    queryFn: async () => {
      if (role !== 'super_admin') return []
      const res = await fetch('/api/admin/companies').then(r => r.json())
      return res.data as Company[]
    },
    enabled: role === 'super_admin'
  })

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, filters],
    queryFn: () => auditApi.list({ 
      ...filters, 
      user_id: filters.user_id ? Number(filters.user_id) : undefined,
      page, 
      size: 20 
    }),
  })

  const entries = data?.data ?? []
  const total   = data?.total ?? 0

  const ACTION_COLORS: Record<string, string> = {
    CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    UPDATE: 'bg-blue-50 text-blue-700 border-blue-100',
    DELETE: 'bg-rose-50 text-rose-700 border-rose-100',
    LOGIN:  'bg-indigo-50 text-indigo-700 border-indigo-100',
    SWITCH: 'bg-amber-50 text-amber-700 border-amber-100',
  }

  const TABLE_LABELS: Record<string, string> = {
    inventory_movements: 'حركات المخزون',
    cash_transactions: 'حركات الخزينة',
    suppliers: 'الموردين',
    users: 'المستخدمين',
    chart_of_accounts: 'دليل الحسابات',
    seasons: 'المواسم',
  }

  function JsonDiff({ oldVal, newVal }: { oldVal: string | null, newVal: string | null }) {
    try {
      const oldObj = oldVal ? JSON.parse(oldVal) : null
      const newObj = newVal ? JSON.parse(newVal) : null

      if (!oldObj && newObj) {
        return (
          <div className="space-y-2">
            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">بيانات جديدة</p>
            <pre className="text-xs bg-emerald-50/50 p-3 rounded-xl border border-emerald-100 overflow-auto max-h-60 font-mono">
              {JSON.stringify(newObj, null, 2)}
            </pre>
          </div>
        )
      }

      if (oldObj && newObj) {
        const keys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]))
        return (
          <div className="space-y-2">
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">تغييرات القيم</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {keys.map(k => {
                const isDiff = JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k])
                if (!isDiff) return null
                return (
                  <div key={k} className="flex flex-col gap-1 p-2 rounded-lg bg-white border border-slate-100 shadow-sm">
                    <span className="text-[10px] font-bold text-slate-400">{k}</span>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-rose-500 line-through truncate max-w-[100px]">{String(oldObj[k] ?? 'null')}</span>
                      <ArrowRight size={10} className="text-slate-300" />
                      <span className="text-emerald-600 font-bold truncate">{String(newObj[k] ?? 'null')}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      }

      return <span className="text-slate-400 italic text-xs">لا يوجد تفاصيل تقنية</span>
    } catch {
      return <span className="text-rose-400 text-xs">خطأ في تحليل البيانات</span>
    }
  }

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="glass p-6 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-100 text-indigo-600 rounded-2xl">
            <History size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">سجل المراجعة والتدقيق</h1>
            <p className="text-slate-500 font-medium">تتبع جميع التغييرات والعمليات في النظام بدقة</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
           <button
             className="btn-secondary gap-2 text-sm"
             onClick={() => downloadCsv('/audit', 'سجل_المراجعة', filters)}
           >
             <Download size={16} /> تصدير CSV
           </button>
           <div className="px-4 py-2 bg-white rounded-xl border border-slate-100 shadow-sm">
             <p className="text-[10px] font-black text-slate-400 uppercase">إجمالي العمليات</p>
             <p className="text-lg font-black text-slate-800">{total.toLocaleString()}</p>
           </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="card p-4 flex flex-wrap items-end gap-4 shadow-sm border-slate-100">
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] font-black text-slate-400 mb-1 block">البحث في الجدول</label>
          <div className="relative">
            <Database className="absolute right-3 top-2.5 text-slate-400" size={16} />
            <select 
              className="input pr-10 text-sm h-10"
              value={filters.table}
              onChange={e => setFilters(f => ({ ...f, table: e.target.value }))}
            >
              <option value="">جميع الجداول</option>
              <option value="inventory_movements">المخزون</option>
              <option value="cash_transactions">الخزينة</option>
              <option value="suppliers">الموردين</option>
              <option value="users">المستخدمين</option>
              <option value="chart_of_accounts">دليل الحسابات</option>
            </select>
          </div>
        </div>

        <div className="w-40">
          <label className="text-[10px] font-black text-slate-400 mb-1 block">النوع</label>
          <select 
            className="input text-sm h-10"
            value={filters.action}
            onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
          >
            <option value="">جميع العمليات</option>
            <option value="CREATE">إضافة</option>
            <option value="UPDATE">تعديل</option>
            <option value="DELETE">حذف</option>
            <option value="LOGIN">دخول</option>
          </select>
        </div>

        {role === 'super_admin' && (
          <div className="w-52">
            <label className="text-[10px] font-black text-slate-400 mb-1 block">الشركة</label>
            <select 
              className="input text-sm h-10 font-bold text-brand-700"
              value={filters.company_id}
              onChange={e => setFilters(f => ({ ...f, company_id: e.target.value }))}
            >
              <option value="all">جميع الشركات</option>
              {companies?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="flex gap-2">
          <div className="w-36">
            <label className="text-[10px] font-black text-slate-400 mb-1 block">من تاريخ</label>
            <input 
              type="date" 
              className="input text-sm h-10" 
              value={filters.start}
              onChange={e => setFilters(f => ({ ...f, start: e.target.value }))}
            />
          </div>
          <div className="w-36">
            <label className="text-[10px] font-black text-slate-400 mb-1 block">إلى تاريخ</label>
            <input 
              type="date" 
              className="input text-sm h-10" 
              value={filters.end}
              onChange={e => setFilters(f => ({ ...f, end: e.target.value }))}
            />
          </div>
        </div>

        <button 
          onClick={() => { setFilters({ table: '', action: '', user_id: '', company_id: 'all', start: '', end: '' }); setPage(1) }}
          className="btn-secondary h-10 px-4"
        >
          إعادة ضبط
        </button>
      </div>

      {/* Main List */}
      <div className="card overflow-hidden border-none shadow-xl">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 animate-pulse">
            <Terminal className="text-slate-200 mb-4 animate-bounce" size={48} />
            <p className="text-slate-400 font-bold italic text-sm tracking-widest uppercase">جاري استرجاع السجلات...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-20 text-center">
            <AlertCircle size={48} className="mx-auto text-slate-200 mb-4" />
            <p className="text-slate-500 font-bold">لا توجد سجلات تطابق عوامل التصفية</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {entries.map((entry: AuditLogEntry) => (
              <div 
                key={entry.id} 
                className={`transition-all ${expandedId === entry.id ? 'bg-slate-50/80 shadow-inner' : 'hover:bg-slate-50/50'}`}
              >
                <div 
                  className="p-4 flex items-center gap-4 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                >
                  <div className="w-10 h-10 flex-shrink-0 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-100">
                    {expandedId === entry.id ? <ChevronDown size={18} className="text-indigo-600" /> : <ChevronRight size={18} className="text-slate-400" />}
                  </div>

                  <div className="w-24 flex-shrink-0">
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${ACTION_COLORS[entry.action] ?? 'bg-slate-50 text-slate-600 border-slate-100'}`}>
                      {entry.action}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm truncate">
                      {TABLE_LABELS[entry.table_name] ?? entry.table_name} 
                      {entry.record_id && <span className="text-slate-400 mr-2">#{entry.record_id}</span>}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                       <span className="flex items-center gap-1 text-xs text-slate-400">
                         <User size={12} /> {entry.user_name}
                       </span>
                       <span className="text-slate-200">|</span>
                       <span className="flex items-center gap-1 text-xs text-slate-400">
                         <Clock size={12} /> {new Date(entry.created_at).toLocaleString('ar-EG')}
                       </span>
                    </div>
                  </div>

                  {role === 'super_admin' && (
                    <div className="hidden lg:block w-40 text-right">
                      <p className="text-[10px] font-black text-brand-600 uppercase tracking-widest truncate">{entry.company_name}</p>
                    </div>
                  )}

                  <div className="hidden sm:flex items-center gap-1 text-xs font-bold text-slate-400 bg-slate-100/50 px-2 py-1 rounded-lg">
                    <Shield size={12} /> {entry.source}
                  </div>
                </div>

                {expandedId === entry.id && (
                  <div className="px-16 pb-6 pt-2 animate-fade-in">
                    <div className="glass p-6 rounded-2xl border-indigo-100 bg-white/80 space-y-6">
                       <div className="flex items-start justify-between">
                         <div className="space-y-1">
                           <h4 className="text-sm font-black text-slate-800">تفاصيل العملية الفنية</h4>
                           <p className="text-[10px] text-slate-400 font-mono">Log ID: {entry.id} • Table: {entry.table_name}</p>
                         </div>
                         <div className="flex gap-2">
                           {entry.user_email && <span className="text-[10px] bg-slate-100 px-2 py-1 rounded font-mono text-slate-500">{entry.user_email}</span>}
                         </div>
                       </div>

                       <JsonDiff oldVal={entry.old_value} newVal={entry.new_value} />
                       
                       <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                         <span className="text-[10px] font-bold text-slate-300 italic">تم تسجيل هذا الإجراء تلقائياً بواسطة محرك التدقيق لنظام Agri-Nile</span>
                         <button className="text-xs font-black text-indigo-600 hover:underline">عرض جميع حركات هذا السجل</button>
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
        <div className="flex items-center justify-center gap-2 mt-8">
           <button 
             disabled={page === 1}
             onClick={() => setPage(p => p - 1)}
             className="btn-secondary h-10 px-4 disabled:opacity-50"
           >السابق</button>
           <div className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-700">
             صفحة {page} من {Math.ceil(total / 20)}
           </div>
           <button 
             disabled={page * 20 >= total}
             onClick={() => setPage(p => p + 1)}
             className="btn-secondary h-10 px-4 disabled:opacity-50"
           >التالي</button>
        </div>
      )}
    </div>
  )
}
