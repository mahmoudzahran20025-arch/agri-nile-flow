import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shield, Filter, Download } from 'lucide-react'
import { auditApi, downloadCsv } from '../../api/client'

function startOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function today() { return new Date().toISOString().slice(0, 10) }

const ACTION_BADGE: Record<string, string> = {
  CREATE: 'badge-green',
  UPDATE: 'badge-blue',
  DELETE: 'badge-red',
  CLOSE:  'badge-amber',
  REOPEN: 'badge-purple',
  LOGIN:  'badge-slate',
  SWITCH: 'badge-slate',
}
const ACTION_AR: Record<string, string> = {
  CREATE: 'إنشاء',
  UPDATE: 'تعديل',
  DELETE: 'حذف',
  CLOSE:  'إغلاق',
  REOPEN: 'فتح',
  LOGIN:  'تسجيل دخول',
  SWITCH: 'تبديل شركة',
}
const TABLE_AR: Record<string, string> = {
  cash_transactions:  'الخزينة',
  supplier_transactions: 'المورد',
  inventory_movements: 'المخزون',
  journal_entries:    'القيود',
  financial_periods:  'الفترات المالية',
  partners:           'الشركاء',
  users:              'المستخدمون',
  suppliers:          'الموردون',
  fields:             'الحقول',
  employees:          'الموظفون',
}

interface AuditEntry {
  id:         number
  action:     string
  table_name: string
  record_id:  number | null
  old_value:  string | null
  new_value:  string | null
  source:     string
  created_at: string
  user_name:  string | null
  user_email: string | null
}

interface AuditList {
  data:      AuditEntry[]
  total:     number
  page:      number
  page_size: number
  has_more:  boolean
}

export default function AuditLogPage() {
  const [page,      setPage]      = useState(1)
  const [startDate, setStart]     = useState(startOfMonth())
  const [endDate,   setEnd]       = useState(today())
  const [filterTable, setFTable]  = useState('')
  const [filterAction,setFAction] = useState('')
  const [expanded,  setExpanded]  = useState<number | null>(null)

  const { data, isLoading } = useQuery<AuditList>({
    queryKey: ['audit', page, startDate, endDate, filterTable, filterAction],
    queryFn:  () => auditApi.list({
      page, size: 50,
      start: startDate || undefined,
      end:   endDate   || undefined,
      table: filterTable  || undefined,
      action: filterAction || undefined,
    }) as Promise<AuditList>,
  })

  const { data: statsRaw } = useQuery({
    queryKey: ['audit-stats'],
    queryFn:  () => auditApi.stats() as Promise<{
      total: number
      by_action: { action: string; cnt: number }[]
      by_table:  { table_name: string; cnt: number }[]
    }>,
  })

  const stats = statsRaw

  const entries   = data?.data     ?? []
  const total     = data?.total    ?? 0
  const totalPages = Math.ceil(total / 50)

  const toggleExpand = (id: number) => setExpanded(prev => prev === id ? null : id)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Shield size={22} className="text-slate-400" />
            سجل المراجعة
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {total.toLocaleString('ar-EG')} سجل
          </p>
        </div>
        <button
          className="btn-secondary gap-2"
          onClick={() => downloadCsv('/audit', 'سجل_المراجعة', {
            start: startDate, end: endDate,
            table: filterTable || undefined,
            action: filterAction || undefined,
          })}
        >
          <Download size={15} /> تصدير CSV
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(stats.by_action ?? []).slice(0, 4).map(a => (
            <div key={a.action} className="card p-4 text-center">
              <span className={`inline-block mb-1 ${ACTION_BADGE[a.action] ?? 'badge-slate'}`}>
                {ACTION_AR[a.action] ?? a.action}
              </span>
              <p className="text-2xl font-bold text-slate-900 mt-1">{a.cnt.toLocaleString('ar-EG')}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={15} className="text-slate-400" />
          <input type="date" className="input w-auto text-sm" value={startDate}
            onChange={e => { setStart(e.target.value); setPage(1) }} />
          <span className="text-slate-400 text-sm">إلى</span>
          <input type="date" className="input w-auto text-sm" value={endDate}
            onChange={e => { setEnd(e.target.value); setPage(1) }} />
          <select className="input w-auto text-sm" value={filterTable}
            onChange={e => { setFTable(e.target.value); setPage(1) }}>
            <option value="">كل الجداول</option>
            {Object.entries(TABLE_AR).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select className="input w-auto text-sm" value={filterAction}
            onChange={e => { setFAction(e.target.value); setPage(1) }}>
            <option value="">كل الإجراءات</option>
            {Object.entries(ACTION_AR).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {(filterTable || filterAction) && (
            <button className="btn-secondary text-xs py-1.5 px-3"
              onClick={() => { setFTable(''); setFAction(''); setPage(1) }}>
              مسح الفلاتر
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center text-slate-400">جاري التحميل...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['التاريخ والوقت', 'المستخدم', 'الإجراء', 'الجدول', 'رقم السجل', 'التفاصيل'].map(h => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map(entry => (
                <>
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-500 text-xs tabular-nums whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString('ar-EG', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800 text-xs">{entry.user_name ?? '—'}</p>
                      <p className="text-slate-400 text-xs">{entry.user_email ?? ''}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={ACTION_BADGE[entry.action] ?? 'badge-slate'}>
                        {ACTION_AR[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600 text-xs">
                      {TABLE_AR[entry.table_name] ?? entry.table_name}
                    </td>
                    <td className="px-5 py-3 text-slate-400 font-mono text-xs">
                      {entry.record_id ?? '—'}
                    </td>
                    <td className="px-5 py-3">
                      {(entry.new_value || entry.old_value) && (
                        <button
                          onClick={() => toggleExpand(entry.id)}
                          className="text-xs text-brand-600 hover:text-brand-800 hover:underline"
                        >
                          {expanded === entry.id ? 'إخفاء' : 'عرض'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === entry.id && (
                    <tr key={`${entry.id}-detail`} className="bg-slate-50">
                      <td colSpan={6} className="px-5 py-3">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          {entry.old_value && (
                            <div>
                              <p className="font-semibold text-slate-500 mb-1">قبل التعديل</p>
                              <pre className="bg-red-50 text-red-800 rounded-lg p-2 text-xs overflow-x-auto whitespace-pre-wrap">
                                {JSON.stringify(JSON.parse(entry.old_value), null, 2)}
                              </pre>
                            </div>
                          )}
                          {entry.new_value && (
                            <div>
                              <p className="font-semibold text-slate-500 mb-1">بعد التعديل</p>
                              <pre className="bg-green-50 text-green-800 rounded-lg p-2 text-xs overflow-x-auto whitespace-pre-wrap">
                                {JSON.stringify(JSON.parse(entry.new_value), null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!entries.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center text-slate-400">
                    لا توجد سجلات في هذه الفترة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50">
            <span className="text-xs text-slate-400">
              صفحة {page} من {totalPages} — {total.toLocaleString('ar-EG')} إجمالي
            </span>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs py-1.5 px-3" disabled={page === 1}
                onClick={() => setPage(p => p - 1)}>السابق</button>
              <button className="btn-secondary text-xs py-1.5 px-3" disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}>التالي</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
