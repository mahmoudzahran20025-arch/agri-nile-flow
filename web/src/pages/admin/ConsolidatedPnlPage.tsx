import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type ConsolidatedPnlCompany } from '../../api/admin'
import { TrendingUp, TrendingDown, Building2, Download } from 'lucide-react'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'

const fmt = (n: number) =>
  new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(n))

function thisMonthRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const last = new Date(y, now.getMonth() + 1, 0).getDate()
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${last}` }
}

export default function ConsolidatedPnlPage() {
  const defaultRange = thisMonthRange()
  const [start, setStart] = useState(defaultRange.start)
  const [end,   setEnd]   = useState(defaultRange.end)
  const [applied, setApplied] = useState(defaultRange)

  const { data, isLoading, error } = useQuery({
    queryKey: ['consolidated-pnl', applied.start, applied.end],
    queryFn: () => adminApi.consolidatedPnl(applied.start, applied.end),
    enabled: !!applied.start && !!applied.end,
  })

  const kpiItems: KpiItem[] = [
    { id: 'companies', label: 'COMPANIES', value: data?.company_count ?? 0 },
    { id: 'revenue',   label: 'TOTAL REVENUE',   value: data ? fmt(data.totals.revenue)    + ' ج' : '—', variant: 'success' },
    { id: 'expense',   label: 'TOTAL EXPENSE',   value: data ? fmt(data.totals.expense)    + ' ج' : '—', variant: 'warning' },
    { id: 'net',       label: 'NET INCOME',       value: data ? fmt(data.totals.net_income) + ' ج' : '—',
      variant: data && data.totals.net_income >= 0 ? 'success' : 'warning' },
  ]

  function handleExport() {
    if (!data) return
    const rows = [
      ['Company Code', 'Company Name', 'Revenue', 'Expense', 'Net Income'],
      ...data.companies.map(c => [c.company_code, c.company_name, c.revenue, c.expense, c.net_income]),
      ['', 'TOTAL', data.totals.revenue, data.totals.expense, data.totals.net_income],
    ]
    const csv = '﻿' + rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `consolidated-pnl-${applied.start}-${applied.end}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Consolidated P&L</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Aggregated income statement across all active companies</p>
        </div>
        <button
          onClick={handleExport}
          disabled={!data}
          className="flex items-center gap-1.5 text-[12px] border border-slate-300 text-slate-600 hover:bg-slate-50 rounded px-3 py-2 disabled:opacity-40"
        >
          <Download size={13} /> Export CSV
        </button>
      </div>

      {/* Date Range Filter */}
      <div className="px-6 py-3 bg-white border-b border-slate-100 flex items-center gap-3">
        <span className="text-[12px] text-slate-500 font-medium">Period:</span>
        <input
          type="date" value={start} onChange={e => setStart(e.target.value)}
          className="input text-[12px] py-1 w-36"
        />
        <span className="text-slate-400 text-[12px]">→</span>
        <input
          type="date" value={end} onChange={e => setEnd(e.target.value)}
          className="input text-[12px] py-1 w-36"
        />
        <button
          onClick={() => setApplied({ start, end })}
          disabled={!start || !end}
          className="btn-primary text-[12px] py-1 px-4"
        >
          Apply
        </button>
      </div>

      <KpiStrip items={kpiItems} />

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && (
          <div className="space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="h-16 bg-slate-100 rounded animate-pulse" />)}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-[13px] text-red-700">
            Failed to load consolidated P&L
          </div>
        )}

        {data && !isLoading && (
          <div className="space-y-2">
            {data.companies.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-[13px]">
                No GL journal entries found for this period across any company.
              </div>
            ) : (
              <>
                {data.companies.map(co => <CompanyRow key={co.company_id} co={co} />)}

                {/* Totals row */}
                <div className="flex items-center gap-4 p-4 rounded border border-[#0F2D5C]/20 bg-[#0F2D5C]/5 mt-4 font-bold">
                  <div className="w-8 flex-shrink-0" />
                  <div className="flex-1">
                    <span className="text-[13px] text-[#0F2D5C]">TOTAL — {data.company_count} Companies</span>
                  </div>
                  <div className="w-32 text-right text-[12px] text-[#1D9E75]">{fmt(data.totals.revenue)} ج</div>
                  <div className="w-32 text-right text-[12px] text-red-600">{fmt(data.totals.expense)} ج</div>
                  <div className={`w-36 text-right text-[13px] font-bold ${data.totals.net_income >= 0 ? 'text-[#1D9E75]' : 'text-red-600'}`}>
                    {data.totals.net_income >= 0 ? '+' : '-'}{fmt(data.totals.net_income)} ج
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CompanyRow({ co }: { co: ConsolidatedPnlCompany }) {
  const isProfit = co.net_income >= 0
  const margin   = co.revenue > 0 ? (co.net_income / co.revenue) * 100 : null

  return (
    <div className="flex items-center gap-4 p-4 rounded border border-slate-200 bg-white hover:border-slate-300 transition-colors">
      <div className="w-8 h-8 rounded-full bg-[#0F2D5C]/10 flex items-center justify-center flex-shrink-0">
        <Building2 size={14} className="text-[#0F2D5C]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[13px] text-slate-800 truncate">{co.company_name}</span>
          <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">{co.company_code}</span>
        </div>
        {margin !== null && (
          <p className="text-[11px] text-slate-400 mt-0.5">
            Margin: <span className={margin >= 0 ? 'text-[#1D9E75]' : 'text-red-500'}>{margin.toFixed(1)}%</span>
          </p>
        )}
      </div>
      <div className="w-32 text-right">
        <p className="text-[11px] text-slate-400">Revenue</p>
        <p className="text-[12px] font-mono text-[#1D9E75] font-medium">{fmt(co.revenue)}</p>
      </div>
      <div className="w-32 text-right">
        <p className="text-[11px] text-slate-400">Expense</p>
        <p className="text-[12px] font-mono text-red-500 font-medium">{fmt(co.expense)}</p>
      </div>
      <div className="w-36 text-right">
        <p className="text-[11px] text-slate-400">Net Income</p>
        <div className="flex items-center justify-end gap-1">
          {isProfit
            ? <TrendingUp size={12} className="text-[#1D9E75]" />
            : <TrendingDown size={12} className="text-red-500" />}
          <p className={`text-[13px] font-bold font-mono ${isProfit ? 'text-[#1D9E75]' : 'text-red-600'}`}>
            {isProfit ? '+' : '-'}{fmt(co.net_income)}
          </p>
        </div>
      </div>
    </div>
  )
}
