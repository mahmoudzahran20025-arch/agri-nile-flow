import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck, Clock, CheckCircle2, TrendingUp, TrendingDown,
  RefreshCw, ExternalLink, AlertTriangle,
} from 'lucide-react'
import { suppliersApi, type SupplierDraft } from '../../api/suppliers'
import { usePermission } from '../../hooks/usePermission'
import { useToast } from '../../contexts/ToastContext'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import DataTable, { type Column } from '../../components/ui/DataTable'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

export default function PendingApprovalsPage() {
  const { canWrite } = usePermission()
  const { toast }    = useToast()
  const qc           = useQueryClient()
  const navigate     = useNavigate()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [groupBy,     setGroupBy]     = useState<'flat' | 'supplier'>('supplier')

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ['supplier-drafts'],
    queryFn:  suppliersApi.drafts,
    staleTime: 30_000,
  })

  const bulkPostMut = useMutation({
    mutationFn: async (items: { id: number; supplier_code: number }[]) => {
      const results = await Promise.allSettled(
        items.map(({ id, supplier_code }) =>
          suppliersApi.postTransaction(supplier_code, id)
        )
      )
      const failed = results.filter(r => r.status === 'rejected')
      if (failed.length > 0) {
        const firstErr = (failed[0] as PromiseRejectedResult).reason
        throw Object.assign(
          new Error(firstErr?.message || 'فشل ترحيل بعض القيود'),
          { failedCount: failed.length, total: items.length }
        )
      }
    },
    onSuccess: (_data, items) => {
      toast(`تم ترحيل ${items.length} قيد بنجاح ✓`, 'success')
      setSelectedIds(new Set())
      qc.invalidateQueries({ queryKey: ['supplier-drafts'] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
    onError: (err: { message?: string; failedCount?: number; total?: number }) => {
      const msg = err.failedCount != null
        ? `فشل ترحيل ${err.failedCount} من ${err.total} قيد: ${err.message}`
        : err.message || 'فشل الترحيل الجماعي'
      toast(msg, 'error')
      setSelectedIds(new Set())
      qc.invalidateQueries({ queryKey: ['supplier-drafts'] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })

  // ── Derived data ─────────────────────────────────────────────
  const totalCredit   = rows.reduce((s, r) => s + r.credit, 0)
  const totalDebit    = rows.reduce((s, r) => s + r.debit, 0)
  const supplierCount = new Set(rows.map(r => r.supplier_code)).size

  const selectedItems = useMemo(
    () => rows.filter(r => selectedIds.has(r.id)).map(r => ({ id: r.id, supplier_code: r.supplier_code })),
    [rows, selectedIds]
  )

  const allDraftIds = rows.map(r => r.id)
  const allSelected = allDraftIds.length > 0 && allDraftIds.every(id => selectedIds.has(id))

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(allDraftIds))
  }

  // ── Grouped view ─────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map<number, { name: string; activity: string | null; rows: SupplierDraft[] }>()
    for (const r of rows) {
      if (!map.has(r.supplier_code)) {
        map.set(r.supplier_code, { name: r.supplier_name, activity: r.supplier_activity, rows: [] })
      }
      map.get(r.supplier_code)!.rows.push(r)
    }
    return [...map.entries()].map(([code, g]) => ({ code, ...g }))
  }, [rows])

  // ── Columns ──────────────────────────────────────────────────
  const COLUMNS: Column<SupplierDraft>[] = [
    {
      key: 'id', header: (
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 cursor-pointer"
          checked={allSelected}
          onChange={toggleAll}
        />
      ),
      width: '36px',
      render: r => canWrite('suppliers') ? (
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 cursor-pointer"
          checked={selectedIds.has(r.id)}
          onChange={e => {
            setSelectedIds(prev => {
              const next = new Set(prev)
              e.target.checked ? next.add(r.id) : next.delete(r.id)
              return next
            })
          }}
          onClick={ev => ev.stopPropagation()}
        />
      ) : <span className="block w-3.5 h-3.5" />,
    },
    {
      key: 'supplier_name', header: 'المورد',
      render: r => (
        <div>
          <span className="font-semibold text-slate-800">{r.supplier_name}</span>
          {r.supplier_activity && (
            <span className="text-[10px] text-slate-400 mr-1.5">{r.supplier_activity}</span>
          )}
        </div>
      ),
    },
    { key: 'transaction_date', header: 'التاريخ', width: '100px',
      render: r => <span className="text-xs tabular-nums">{new Date(r.transaction_date).toLocaleDateString('en-US')}</span> },
    {
      key: 'entry_type', header: 'النوع', width: '80px',
      render: r => (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
          r.entry_type === 'د'
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-blue-50 text-blue-700 border-blue-200'
        }`}>
          {r.entry_type === 'د' ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
          {r.entry_type === 'د' ? 'فاتورة' : 'سداد'}
        </span>
      ),
    },
    { key: 'document_type', header: 'المستند', width: '90px',
      render: r => r.document_type
        ? <span className="text-[11px] text-slate-600">{r.document_type}</span>
        : <span className="text-slate-300">—</span> },
    { key: 'expense_category', header: 'الخدمة',
      render: r => r.expense_category
        ? <span className="text-[11px] text-slate-700">{r.expense_category}</span>
        : <span className="text-slate-300">—</span> },
    { key: 'amount', header: 'المبلغ', width: '115px',
      render: r => (
        <span className={`font-bold tabular-nums text-sm ${r.entry_type === 'د' ? 'text-amber-700' : 'text-blue-700'}`}>
          {egp(r.amount)}
        </span>
      ),
    },
    {
      key: 'supplier_code', header: '', width: '42px',
      render: r => (
        <button
          onClick={() => navigate(`/suppliers/${r.supplier_code}`)}
          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          title="فتح ملف المورد"
        >
          <ExternalLink size={13} />
        </button>
      ),
    },
  ]

  // ── KPIs ─────────────────────────────────────────────────────
  const kpis: KpiItem[] = [
    { id: 'count',     label: 'قيود معلقة',     value: `${rows.length} قيد`,      variant: rows.length > 0 ? 'warning' : 'default' },
    { id: 'suppliers', label: 'موردين متأثرين', value: `${supplierCount} مورد`,   variant: supplierCount > 0 ? 'warning' : 'default' },
    { id: 'credit',    label: 'إجمالي الفواتير', value: egp(totalCredit),          variant: 'warning' },
    { id: 'debit',     label: 'إجمالي المدفوع',  value: egp(totalDebit),           variant: 'success' },
  ]

  // ── Actions ──────────────────────────────────────────────────
  const actions: CommandAction[] = [
    {
      id: 'refresh', label: isLoading ? 'Loading…' : 'تحديث',
      icon: <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />,
      onClick: () => refetch(), variant: 'secondary',
    },
    ...(selectedIds.size > 0 && canWrite('suppliers') ? [{
      id: 'bulk-post',
      label: bulkPostMut.isPending ? 'جاري الترحيل...' : `ترحيل ${selectedIds.size} قيد`,
      icon: <ShieldCheck size={14} />,
      onClick: () => bulkPostMut.mutate(selectedItems),
      variant: 'primary' as const,
    }] : []),
    ...(rows.length > 0 && canWrite('suppliers') && selectedIds.size === 0 ? [{
      id: 'post-all',
      label: bulkPostMut.isPending ? 'جاري الترحيل...' : `ترحيل الكل (${rows.length})`,
      icon: <ShieldCheck size={14} />,
      onClick: () => {
        toggleAll()
        bulkPostMut.mutate(rows.map(r => ({ id: r.id, supplier_code: r.supplier_code })))
      },
      variant: 'primary' as const,
    }] : []),
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <CommandBar actions={actions} />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 animate-fade-in">

        <KpiStrip items={kpis} />

        {/* Empty state */}
        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <CheckCircle2 size={40} className="text-emerald-400" />
            <p className="text-lg font-bold text-slate-700">لا توجد قيود معلقة</p>
            <p className="text-sm text-slate-400">جميع قيود الموردين تم ترحيلها — لا يوجد ما يستلزم المراجعة</p>
          </div>
        )}

        {rows.length > 0 && (
          <>
            {/* Period warning when no season/center */}
            {rows.some(r => !r.season_id || !r.center_code) && (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 font-medium">
                  بعض القيود لا تحتوي على موسم أو مركز تكلفة — لن يتم ترحيلها حتى تكتمل بياناتها.
                  افتح ملف المورد لتعديلها.
                </p>
              </div>
            )}

            {/* View toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">عرض:</span>
              {(['supplier', 'flat'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setGroupBy(v)}
                  className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all border ${
                    groupBy === v
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'text-slate-500 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {v === 'supplier' ? 'مجمّع بالمورد' : 'قائمة مسطحة'}
                </button>
              ))}
            </div>

            {/* Grouped by supplier */}
            {groupBy === 'supplier' && grouped.map(g => {
              const groupTotal  = g.rows.reduce((s, r) => s + r.amount, 0)
              const groupSelected = g.rows.filter(r => selectedIds.has(r.id)).length
              const allGroupSelected = groupSelected === g.rows.length
              return (
                <SectionCard
                  key={g.code}
                  title={
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 cursor-pointer"
                        checked={allGroupSelected}
                        onChange={() => {
                          setSelectedIds(prev => {
                            const next = new Set(prev)
                            if (allGroupSelected) g.rows.forEach(r => next.delete(r.id))
                            else g.rows.forEach(r => next.add(r.id))
                            return next
                          })
                        }}
                      />
                      <span>{g.name}</span>
                      {g.activity && <span className="text-[11px] font-normal text-slate-400">{g.activity}</span>}
                      <span className="mr-auto text-[11px] font-bold text-slate-500 tabular-nums">
                        {g.rows.length} قيد · {egp(groupTotal)}
                      </span>
                      {groupSelected > 0 && (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          {groupSelected} محدد
                        </span>
                      )}
                    </div>
                  }
                  icon={<Clock size={14} />}
                >
                  <DataTable<SupplierDraft>
                    columns={COLUMNS}
                    data={g.rows}
                    loading={false}
                    total={g.rows.length}
                    page={1}
                    pageSize={g.rows.length}
                    onPage={() => {}}
                    rowKey={r => r.id}
                    emptyText="—"
                  />
                </SectionCard>
              )
            })}

            {/* Flat list */}
            {groupBy === 'flat' && (
              <SectionCard title="جميع القيود المعلقة" icon={<Clock size={15} />}>
                <DataTable<SupplierDraft>
                  columns={COLUMNS}
                  data={rows}
                  loading={isLoading}
                  total={rows.length}
                  page={1}
                  pageSize={rows.length}
                  onPage={() => {}}
                  rowKey={r => r.id}
                  emptyText="لا توجد قيود معلقة"
                />
              </SectionCard>
            )}
          </>
        )}
      </div>
    </div>
  )
}
