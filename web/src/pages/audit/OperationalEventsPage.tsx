import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditApi } from '../../api/client'
import {
  Tractor, Wheat, CalendarRange, FileText, Users,
  CheckCircle, XCircle, Edit, Trash2, Plus, RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { TableSkeleton } from '../../components/ui/Skeleton'

// Operational tables we care about — with Arabic labels and icons
const OP_TABLES: Record<string, { label: string; icon: React.ReactNode }> = {
  work_orders:       { label: 'أوامر العمل',      icon: <Tractor     size={13} /> },
  harvest_records:   { label: 'الحصاد',            icon: <Wheat       size={13} /> },
  seasons:           { label: 'المواسم',           icon: <CalendarRange size={13} /> },
  supplier_invoices: { label: 'فواتير الموردين',  icon: <FileText    size={13} /> },
  contracts:         { label: 'العقود',            icon: <Users       size={13} /> },
}

const OP_TABLE_KEYS = Object.keys(OP_TABLES)

const ACTION_CFG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  CREATE: { label: 'إنشاء',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <Plus      size={10} /> },
  UPDATE: { label: 'تعديل',  cls: 'bg-blue-50    text-blue-700    border-blue-200',    icon: <Edit      size={10} /> },
  DELETE: { label: 'حذف',    cls: 'bg-red-50     text-red-700     border-red-200',     icon: <Trash2    size={10} /> },
}

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_CFG[action] ?? { label: action, cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: null }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  )
}

function StatusChange({ newVal }: { newVal: Record<string, unknown> }) {
  if (!newVal?.status) return null
  const prev = (newVal as { previous_status?: string }).previous_status
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {prev && <><span className="text-slate-400 font-mono">{prev}</span><span className="text-slate-300">→</span></>}
      <span className="font-semibold text-slate-700 font-mono">{String(newVal.status)}</span>
      {newVal.status === 'closed' && <XCircle size={11} className="text-slate-500" />}
      {newVal.status === 'approved' || newVal.status === 'active'
        ? <CheckCircle size={11} className="text-emerald-500" /> : null}
    </span>
  )
}

interface AuditEntry {
  id: number; action: string; table_name: string; record_id: number | null
  old_value: string | null; new_value: string | null
  created_at: string; user_name: string; user_email: string
}

export default function OperationalEventsPage() {
  const [page, setPage]           = useState(1)
  const [tableFilter, setTableFilter] = useState('')

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['audit-operational', page, tableFilter],
    queryFn: () => auditApi.list({
      table: tableFilter || undefined,
      page,
      size: 30,
    }),
    select: (d) => ({
      ...d,
      data: ((d as { data: AuditEntry[] }).data ?? []).filter(e =>
        OP_TABLE_KEYS.includes(e.table_name)
      ),
    }),
  })

  const entries = data?.data ?? []
  const total   = (data as { total?: number } | undefined)?.total ?? 0

  return (
    <div className="space-y-4" dir="rtl">

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setTableFilter(''); setPage(1) }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
              !tableFilter ? 'bg-[#0F2D5C] text-white border-[#0F2D5C]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            الكل
          </button>
          {Object.entries(OP_TABLES).map(([k, v]) => (
            <button
              key={k}
              onClick={() => { setTableFilter(k); setPage(1) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                tableFilter === k ? 'bg-[#0F2D5C] text-white border-[#0F2D5C]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {v.icon} {v.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 rounded-xl hover:bg-slate-100 transition-colors"
        >
          <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {/* Table */}
      {isLoading && <TableSkeleton rows={8} cols={5} />}

      {isError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={14} />
          تعذّر تحميل سجل الأحداث
        </div>
      )}

      {!isLoading && !isError && entries.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-400">
          لا توجد أحداث تشغيلية مسجلة في هذه الفترة
        </div>
      )}

      {entries.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm text-right">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                {['الجدول', 'الرقم', 'العملية', 'التغيير', 'المستخدم', 'التوقيت'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {entries.map(e => {
                const tableCfg = OP_TABLES[e.table_name]
                let newVal: Record<string, unknown> = {}
                try { newVal = e.new_value ? JSON.parse(e.new_value) : {} } catch { /* */ }

                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                        {tableCfg?.icon}
                        {tableCfg?.label ?? e.table_name}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {e.record_id ? `#${e.record_id}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ActionBadge action={e.action} />
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      {newVal.status
                        ? <StatusChange newVal={newVal} />
                        : (
                          <span className="text-xs text-slate-500 truncate block" title={e.new_value ?? ''}>
                            {e.new_value
                              ? Object.entries(newVal).slice(0, 3).map(([k, v]) =>
                                  `${k}: ${v}`
                                ).join(' · ')
                              : '—'
                            }
                          </span>
                        )
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">
                        <p className="text-slate-700 font-medium">{e.user_name || '—'}</p>
                        <p className="text-slate-400 text-[10px]">{e.user_email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString('ar-EG', {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {total > 30 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
              <span>صفحة {page} · {total} حدث إجمالاً</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  السابق
                </button>
                <button
                  disabled={page * 30 >= total}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  التالي
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
