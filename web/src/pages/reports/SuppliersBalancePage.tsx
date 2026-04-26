import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Users, TrendingDown, TrendingUp, Scale, Download, ExternalLink } from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'
import type { Season } from '../../types'

function egp(n: number | null | undefined) {
  if (n == null || n === 0) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
  }).format(n)
}

function egpColored(n: number, positiveColor = 'text-amber-700', negativeColor = 'text-blue-700') {
  const abs = Math.abs(n)
  const color = n >= 0 ? positiveColor : negativeColor
  return (
    <span className={`font-semibold ${color}`}>
      {abs === 0 ? '—' : new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
      }).format(abs)}
    </span>
  )
}

export default function SuppliersBalancePage() {
  const navigate = useNavigate()
  const [seasonId, setSeasonId] = useState<number | undefined>(undefined)
  const [sortKey, setSortKey]   = useState<'name' | 'credit' | 'debit' | 'balance'>('balance')

  const { data: seasons } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<Season[]>,
  })

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['reports', 'suppliers-balance', seasonId],
    queryFn:  () => reportsApi.suppliersBalance(seasonId),
  })

  // Sort
  const sorted = [...rows].sort((a, b) => {
    if (sortKey === 'name')    return a.name.localeCompare(b.name, 'ar')
    if (sortKey === 'credit')  return b.total_credit  - a.total_credit
    if (sortKey === 'debit')   return b.total_debit   - a.total_debit
    return b.balance - a.balance
  })

  // Totals
  const totalCredit  = rows.reduce((s, r) => s + (r.total_credit ?? 0), 0)
  const totalDebit   = rows.reduce((s, r) => s + (r.total_debit ?? 0), 0)
  const totalBalance = rows.reduce((s, r) => s + (r.balance ?? 0), 0)

  function downloadCsv() {
    const BOM = '\uFEFF'
    const header = ['الكود', 'اسم المورد/العميل', 'النشاط', 'إجمالي دائن', 'إجمالي مدين', 'الرصيد', 'عدد المعاملات']
    const csvRows = sorted.map(r => [
      r.code, r.name, r.activity ?? '', r.total_credit, r.total_debit, r.balance, r.tx_count,
    ])
    const csv = BOM + [header, ...csvRows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `ميزان_الموردين_${seasonId ?? 'كل_المواسم'}.csv`
    link.click()
  }

  const SortBtn = ({ k, label }: { k: typeof sortKey; label: string }) => (
    <button
      onClick={() => setSortKey(k)}
      className={`text-xs px-2 py-1 rounded ${sortKey === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
    >{label}</button>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ميزان الموردين والعملاء</h1>
          <p className="text-sm text-slate-500 mt-1">ملخص أرصدة جميع الموردين — دائن / مدين / الرصيد</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="input text-sm w-48"
            value={seasonId ?? ''}
            onChange={e => setSeasonId(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">كل المواسم</option>
            {(seasons ?? []).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button onClick={downloadCsv} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={16} /> تصدير CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg"><TrendingDown size={22} className="text-amber-600" /></div>
            <div>
              <p className="text-xs text-slate-500">إجمالي دائن (مستحق لهم)</p>
              <p className="text-xl font-bold text-amber-700">{egp(totalCredit)}</p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg"><TrendingUp size={22} className="text-blue-600" /></div>
            <div>
              <p className="text-xs text-slate-500">إجمالي مدين (سُدِّد)</p>
              <p className="text-xl font-bold text-blue-700">{egp(totalDebit)}</p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg"><Scale size={22} className="text-red-600" /></div>
            <div>
              <p className="text-xs text-slate-500">صافي الرصيد المستحق</p>
              <p className="text-xl font-bold text-red-700">{egp(totalBalance)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 ml-1">ترتيب حسب:</span>
        <SortBtn k="balance" label="الرصيد" />
        <SortBtn k="credit"  label="الدائن" />
        <SortBtn k="debit"   label="المدين" />
        <SortBtn k="name"    label="الاسم" />
        <span className="mr-auto text-xs text-slate-400">{rows.length} مورد/عميل</span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-slate-400">جاري التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-400">
            <div className="text-center">
              <Users size={40} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد بيانات للموردين</p>
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-right text-slate-600 font-medium w-16">الكود</th>
                <th className="px-4 py-3 text-right text-slate-600 font-medium">اسم المورد / العميل</th>
                <th className="px-4 py-3 text-right text-slate-600 font-medium w-32">النشاط</th>
                <th className="px-4 py-3 text-left text-amber-700 font-medium w-36">دائن (مستحق)</th>
                <th className="px-4 py-3 text-left text-blue-700 font-medium w-36">مدين (سُدِّد)</th>
                <th className="px-4 py-3 text-left text-slate-700 font-medium w-36">الرصيد</th>
                <th className="px-4 py-3 text-center text-slate-600 font-medium w-24">معاملات</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map(r => {
                const pct = totalCredit > 0 ? (r.total_credit / totalCredit) * 100 : 0
                return (
                  <tr
                    key={r.code}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/suppliers/${r.code}`)}
                  >
                    <td className="px-4 py-3 text-slate-400 text-xs">{r.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{r.name}</div>
                      {pct > 1 && (
                        <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden w-full max-w-xs">
                          <div
                            className="h-full bg-amber-400 rounded-full"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{r.activity ?? '—'}</td>
                    <td className="px-4 py-3 text-left">{egpColored(r.total_credit, 'text-amber-700', 'text-slate-400')}</td>
                    <td className="px-4 py-3 text-left">{egpColored(r.total_debit, 'text-blue-700', 'text-slate-400')}</td>
                    <td className="px-4 py-3 text-left">
                      <span className={`font-bold ${r.balance > 0 ? 'text-red-600' : r.balance < 0 ? 'text-green-700' : 'text-slate-400'}`}>
                        {r.balance === 0 ? 'صفر' : egp(Math.abs(r.balance))}
                        {r.balance > 0 && <span className="text-xs mr-1">(علينا)</span>}
                        {r.balance < 0 && <span className="text-xs mr-1">(لنا)</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="badge-blue">{r.tx_count}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ExternalLink size={14} className="text-slate-300 group-hover:text-brand-500" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Totals row */}
            <tfoot className="bg-slate-50 border-t-2 border-slate-300">
              <tr>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 font-bold text-slate-700">الإجمالي</td>
                <td></td>
                <td className="px-4 py-3 text-left font-bold text-amber-700">{egp(totalCredit)}</td>
                <td className="px-4 py-3 text-left font-bold text-blue-700">{egp(totalDebit)}</td>
                <td className="px-4 py-3 text-left font-bold text-red-700">{egp(totalBalance)}</td>
                <td className="px-4 py-3 text-center text-slate-500 text-xs">{rows.reduce((s, r) => s + r.tx_count, 0)} إجمالي</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
