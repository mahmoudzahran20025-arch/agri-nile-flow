import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Users, TrendingDown, Download, ExternalLink, X, ChevronRight, RefreshCw } from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import SectionCard from '../../components/ui/SectionCard'
import CertificationBadge from '../../components/ui/CertificationBadge'
import type { Season } from '../../types'

function egp(n: number | null | undefined) {
  if (n == null || n === 0) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
  }).format(n)
}

type BalanceRow = {
  code: number; name: string; activity: string | null
  total_credit: number; total_debit: number; balance: number
  last_balance: number; tx_count: number
}

type PaymentRow = Record<string, unknown> & { date?: string; amount?: number; type?: string; notes?: string }

export default function SuppliersBalancePage() {
  const navigate = useNavigate()
  const [seasonId, setSeasonId]   = useState<number | undefined>(undefined)
  const [sortKey, setSortKey]     = useState<'name' | 'credit' | 'debit' | 'balance'>('balance')
  const [selected, setSelected]   = useState<BalanceRow | null>(null)
  const [sourceFilter, setSourceFilter] = useState<'all' | 'supplier_transactions'>('all')

  const { data: seasons } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<Season[]>,
  })

  const { data: balanceData, isLoading, refetch } = useQuery({
    queryKey: ['reports', 'suppliers-balance', seasonId],
    queryFn:  () => reportsApi.suppliersBalance(seasonId),
  })

  const rows = balanceData?.data ?? []
  const legacyCoverage = balanceData?.legacy_coverage
  const postingMeta = balanceData?.meta ?? null

  const { data: paymentsData } = useQuery({
    queryKey: ['reports', 'supplier-payments', selected?.code, seasonId, sourceFilter],
    queryFn:  () => reportsApi.supplierPayments({
      supplier_code: selected?.code,
      season_id: seasonId,
      source_table: sourceFilter === 'all' ? undefined : sourceFilter,
    }),
    enabled: !!selected,
  })

  const sorted = [...rows].sort((a, b) => {
    if (sortKey === 'name')    return a.name.localeCompare(b.name, 'ar')
    if (sortKey === 'credit')  return b.total_credit - a.total_credit
    if (sortKey === 'debit')   return b.total_debit  - a.total_debit
    return b.balance - a.balance
  })

  const totalCredit  = rows.reduce((s, r) => s + (r.total_credit ?? 0), 0)
  const totalDebit   = rows.reduce((s, r) => s + (r.total_debit  ?? 0), 0)
  const totalBalance = rows.reduce((s, r) => s + (r.balance      ?? 0), 0)

  function downloadCsv() {
    const BOM = '\uFEFF'
    const header = ['الكود', 'اسم المورد/العميل', 'النشاط', 'إجمالي دائن', 'إجمالي مدين', 'الرصيد', 'عدد المعاملات']
    const csvRows = sorted.map(r => [r.code, r.name, r.activity ?? '', r.total_credit, r.total_debit, r.balance, r.tx_count])
    const csv = BOM + [header, ...csvRows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `ميزان_الموردين_${seasonId ?? 'كل_المواسم'}.csv`
    link.click()
  }

  const kpis: KpiItem[] = [
    { id: 'suppliers', label: 'عدد الموردين',          value: rows.length },
    { id: 'credit',    label: 'إجمالي الدائن',         value: egp(totalCredit),  variant: 'warning' },
    { id: 'debit',     label: 'إجمالي المدين',         value: egp(totalDebit),   variant: 'success' },
    { id: 'balance',   label: 'صافي المستحق',          value: egp(Math.abs(totalBalance)), variant: Math.abs(totalBalance) > 0 ? 'warning' : 'success' },
  ]

  const actions: CommandAction[] = [
    { id: 'refresh', label: 'Refresh', icon: <RefreshCw size={14} />, onClick: () => refetch(), variant: 'secondary' },
    { id: 'export',  label: 'Export CSV', icon: <Download size={14} />, onClick: downloadCsv, variant: 'secondary' },
  ]

  const rightSlot = (
    <div className="flex items-center gap-3">
      <select
        className="input h-8 text-[12px] py-1 w-44"
        value={seasonId ?? ''}
        onChange={e => setSeasonId(e.target.value ? Number(e.target.value) : undefined)}
      >
        <option value="">كل المواسم</option>
        {(seasons ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <div className="flex items-center gap-1 text-[11px] text-slate-500">
        ترتيب:
        {(['balance', 'credit', 'debit', 'name'] as const).map(k => (
          <button
            key={k}
            onClick={() => setSortKey(k)}
            className={`px-2 py-0.5 rounded text-[11px] ${sortKey === k ? 'bg-[#0F2D5C] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {k === 'balance' ? 'رصيد' : k === 'credit' ? 'دائن' : k === 'debit' ? 'مدين' : 'اسم'}
          </button>
        ))}
      </div>
    </div>
  )

  const payments = (paymentsData?.data as PaymentRow[] | undefined) ?? []

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">ميزان الموردين والعملاء</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">ملخص أرصدة الموردين · دائن / مدين / الرصيد الصافي</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CertificationBadge meta={postingMeta} showReason />
          {legacyCoverage ? (
            legacyCoverage.has_legacy_gaps ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                تغطية السجلات القديمة: {legacyCoverage.coverage_rate_pct}% · {legacyCoverage.missing_journal_link_events + legacyCoverage.missing_supplier_code_events} فجوة
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
                تغطية السجلات القديمة: {legacyCoverage.coverage_rate_pct}% — لا فجوات
              </span>
            )
          ) : null}
        </div>
      </div>

      <CommandBar actions={actions} rightSlot={rightSlot} />
      <KpiStrip items={kpis} />

      <div className="flex flex-1 overflow-hidden">
        {/* â”€â”€ Main table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className={`flex-1 overflow-y-auto p-6 transition-all ${selected ? 'lg:pr-3' : ''}`}>
          <SectionCard
            title="أرصدة الموردين"
            subtitle={`${rows.length} مورد`}
            icon={<Users size={14} />}
          >
            {isLoading ? (
              <div className="space-y-2">
                {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                <Users size={36} className="mb-3 opacity-30" />
                <p className="text-[13px]">لا توجد بيانات للموردين</p>
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5 text-right text-slate-500 font-medium w-16">الكود</th>
                    <th className="px-3 py-2.5 text-right text-slate-500 font-medium">المورد</th>
                    <th className="px-3 py-2.5 text-right text-slate-500 font-medium w-28">النشاط</th>
                    <th className="px-3 py-2.5 text-right text-amber-700 font-medium w-32">دائن</th>
                    <th className="px-3 py-2.5 text-right text-blue-700 font-medium w-32">مدين</th>
                    <th className="px-3 py-2.5 text-right text-slate-700 font-medium w-32">الرصيد</th>
                    <th className="px-3 py-2.5 text-center text-slate-500 font-medium w-20">معاملات</th>
                    <th className="px-3 py-2.5 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map(r => {
                    const pct = totalCredit > 0 ? (r.total_credit / totalCredit) * 100 : 0
                    const isActive = selected?.code === r.code
                    return (
                      <tr
                        key={r.code}
                        className={`cursor-pointer transition-colors group ${isActive ? 'bg-blue-50 border-l-2 border-l-[#0F2D5C]' : 'hover:bg-slate-50'}`}
                        onClick={() => setSelected(isActive ? null : r)}
                      >
                        <td className="px-3 py-2.5 font-mono text-slate-400">{r.code}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-800">{r.name}</div>
                          {pct > 1 && (
                            <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden max-w-[160px]">
                              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-400">{r.activity ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-amber-700">{r.total_credit > 0 ? egp(r.total_credit) : '—'}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-blue-700">{r.total_debit > 0 ? egp(r.total_debit) : '—'}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`font-bold ${r.balance > 0 ? 'text-red-600' : r.balance < 0 ? 'text-[#1D9E75]' : 'text-slate-400'}`}>
                            {r.balance === 0 ? 'صفر' : egp(Math.abs(r.balance))}
                            {r.balance > 0 && <span className="text-[10px] mr-1 font-normal opacity-70">(علينا)</span>}
                            {r.balance < 0 && <span className="text-[10px] mr-1 font-normal opacity-70">(لنا)</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{r.tx_count}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <ChevronRight size={13} className={`text-slate-300 transition-transform ${isActive ? 'rotate-90 text-[#0F2D5C]' : 'group-hover:text-slate-500'}`} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                  <tr>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5 font-bold text-slate-700">الإجمالي</td>
                    <td />
                    <td className="px-3 py-2.5 text-right font-bold text-amber-700">{egp(totalCredit)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-blue-700">{egp(totalDebit)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-red-700">{egp(totalBalance)}</td>
                    <td className="px-3 py-2.5 text-center text-slate-500">{rows.reduce((s, r) => s + r.tx_count, 0)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </SectionCard>
        </div>

        {/* â”€â”€ Drill Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {selected && (
          <div className="w-[360px] shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
            {/* Panel header */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between">
              <div>
                <p className="text-[13px] font-bold text-[#0F2D5C]">{selected.name}</p>
                <p className="text-[11px] text-slate-500 font-mono">Code #{selected.code} · {selected.activity ?? 'N/A'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1"
                  onClick={() => navigate(`/gl/entries?ref_type=supplier_transaction&source_code=${selected.code}`)}
                >
                  <ExternalLink size={11} /> قيود GL
                </button>
                <button
                  className="text-[11px] text-[#0F2D5C] hover:underline flex items-center gap-1"
                  onClick={() => navigate(`/suppliers/${selected.code}`)}
                >
                  <ExternalLink size={11} /> الملف
                </button>
                <button className="text-slate-400 hover:text-slate-700" onClick={() => setSelected(null)}>
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Panel KPIs */}
            <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-slate-100">
              {[
                { label: 'دائن', value: egp(selected.total_credit), color: 'text-amber-700' },
                { label: 'مدين', value: egp(selected.total_debit),  color: 'text-blue-700' },
                { label: 'رصيد', value: egp(Math.abs(selected.balance)),
                  color: selected.balance > 0 ? 'text-red-600' : selected.balance < 0 ? 'text-[#1D9E75]' : 'text-slate-400' },
              ].map(k => (
                <div key={k.label} className="text-center">
                  <p className={`text-[14px] font-bold ${k.color}`}>{k.value}</p>
                  <p className="text-[10px] text-slate-400">{k.label}</p>
                </div>
              ))}
            </div>

            {/* Payments list */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">سجل المدفوعات</p>
              <div className="mb-3 flex items-center gap-1 text-[11px]">
                <span className="text-slate-500">المصدر:</span>
                {([
                  { id: 'all', label: 'الكل' },
                  { id: 'supplier_transactions', label: 'حركات المورد' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setSourceFilter(opt.id)}
                    className={`px-2 py-0.5 rounded ${sourceFilter === opt.id ? 'bg-[#0F2D5C] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {payments.length === 0 ? (
                <div className="text-center text-slate-400 py-8">
                  <TrendingDown size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-[12px]">لا توجد مدفوعات مسجلة</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {payments.slice(0, 50).map((p, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 py-2 border-b border-slate-50 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-mono text-slate-400">{String(p.date ?? '—')}</p>
                        {p.notes && <p className="text-[11px] text-slate-500 truncate mt-0.5">{String(p.notes)}</p>}
                        {p.type && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded mt-0.5 inline-block">{String(p.type)}</span>}
                      </div>
                      <span className="text-[12px] font-semibold text-blue-700 shrink-0">
                        {p.amount != null ? egp(Number(p.amount)) : '—'}
                      </span>
                    </div>
                  ))}
                  {payments.length > 50 && (
                    <p className="text-[11px] text-slate-400 text-center py-2">+ {payments.length - 50} المزيد</p>
                  )}
                </div>
              )}
            </div>

            {/* Exposure bar */}
            {totalCredit > 0 && (
              <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
                <p className="text-[10px] text-slate-500 mb-1">
                  Exposure: {Math.round((selected.total_credit / totalCredit) * 100)}% of total payables
                </p>
                <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full"
                    style={{ width: `${Math.min((selected.total_credit / totalCredit) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

