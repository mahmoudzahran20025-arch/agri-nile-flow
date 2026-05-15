import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { glApi } from '../../api/client'
import { reportsApi } from '../../api/reports'
import { CheckCircle, XCircle, Download, RefreshCw, Search, X } from 'lucide-react'

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset:     'الأصول',
  liability: 'الالتزامات',
  equity:    'حقوق الملكية',
  revenue:   'الإيرادات',
  expense:   'المصروفات',
}

const ACCOUNT_TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense']

function fmt(n: number) {
  if (n === 0) return <span className="text-slate-500">—</span>
  const abs = Math.abs(n)
  const str = abs.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return <span className={n < 0 ? 'text-red-400' : ''}>{n < 0 ? `(${str})` : str}</span>
}

export default function TrialBalancePage() {
  const [mode, setMode]       = useState<'period' | 'date'>('period')
  const [periodId, setPeriodId] = useState<number | null>(null)
  const [asOf, setAsOf]       = useState('')
  const [showZero, setShowZero] = useState(false)
  const [search, setSearch] = useState('')

  const { data: periods } = useQuery({
    queryKey: ['gl', 'periods'],
    queryFn:  glApi.periods,
    staleTime: 5 * 60_000,
  })

  const params = mode === 'period' && periodId != null
    ? { period_id: periodId }
    : mode === 'date' && asOf
    ? { as_of: asOf }
    : null

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['reports', 'trial-balance', params],
    queryFn:  () => reportsApi.trialBalance(params!),
    enabled:  params != null,
    staleTime: 2 * 60_000,
  })

  const rows = data?.data ?? []
  const summary = data?.summary

  const filteredRows = useMemo(() => {
    let result = showZero
      ? rows
      : rows.filter(r => r.opening_balance !== 0 || r.period_debit !== 0 || r.period_credit !== 0 || r.closing_balance !== 0)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(r =>
        r.account_code?.toLowerCase().includes(q) ||
        r.account_name?.toLowerCase().includes(q)
      )
    }
    return result
  }, [rows, showZero, search])

  const grouped = ACCOUNT_TYPE_ORDER.reduce<Record<string, typeof rows>>((acc, t) => {
    acc[t] = filteredRows.filter(r => r.account_type === t)
    return acc
  }, {} as Record<string, typeof rows>)

  function exportCsv() {
    const header = 'كود الحساب,اسم الحساب,النوع,رصيد افتتاحي,مدين الفترة,دائن الفترة,رصيد ختامي'
    const lines = filteredRows.map(r =>
      [r.account_code, r.account_name, r.account_type,
       r.opening_balance, r.period_debit, r.period_credit, r.closing_balance].join(',')
    )
    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'trial_balance.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">ميزان المراجعة</h1>
          <p className="text-sm text-slate-400 mt-0.5">أرصدة الحسابات مع الحركات والأرصدة الختامية</p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
              <Download size={14} /> تصدير CSV
            </button>
          )}
          <button onClick={() => refetch()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm">
            <RefreshCw size={14} /> تحديث
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-4 items-end">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('period')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === 'period' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            بالفترة المحاسبية
          </button>
          <button
            onClick={() => setMode('date')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === 'date' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            حتى تاريخ
          </button>
        </div>

        {mode === 'period' ? (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">الفترة المحاسبية</label>
            <select
              value={periodId ?? ''}
              onChange={e => setPeriodId(e.target.value ? Number(e.target.value) : null)}
              className="bg-slate-700 text-slate-100 rounded-lg px-3 py-1.5 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[200px]"
            >
              <option value="">— اختر فترة —</option>
              {(periods as Array<{ id: number; name: string; is_closed: number }> ?? []).map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.is_closed ? '(مغلقة)' : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">حتى تاريخ</label>
            <input
              type="date"
              value={asOf}
              onChange={e => setAsOf(e.target.value)}
              className="bg-slate-700 text-slate-100 rounded-lg px-3 py-1.5 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showZero}
            onChange={e => setShowZero(e.target.checked)}
            className="accent-blue-500"
          />
          عرض الحسابات صفرية الرصيد
        </label>

        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث بكود أو اسم الحساب..."
            className="w-full bg-slate-700 text-slate-100 rounded-lg pr-8 pl-8 py-1.5 text-sm border border-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Balance status banner */}
      {summary && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
          summary.is_balanced
            ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300'
            : 'bg-red-900/30 border-red-700 text-red-300'
        }`}>
          {summary.is_balanced
            ? <CheckCircle size={18} className="shrink-0" />
            : <XCircle    size={18} className="shrink-0" />
          }
          <span className="font-semibold text-sm">
            {summary.is_balanced
              ? 'الميزان متوازن — مجموع المدين = مجموع الدائن'
              : `الميزان غير متوازن — فرق: ${Math.abs(summary.imbalance).toLocaleString('en', { minimumFractionDigits: 2 })}`
            }
          </span>
          <span className="ms-auto text-xs opacity-70">{summary.row_count} حساب</span>
        </div>
      )}

      {!params && (
        <div className="text-center py-16 text-slate-500 text-sm">
          اختر فترة محاسبية أو حدد تاريخاً لعرض ميزان المراجعة
        </div>
      )}

      {isLoading && (
        <div className="text-center py-16 text-slate-400 text-sm animate-pulse">جاري التحميل...</div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
          حدث خطأ أثناء تحميل البيانات. تأكد من الاتصال وأعد المحاولة.
        </div>
      )}

      {/* Main table */}
      {data && (
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-22rem)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-700 bg-slate-800">
                <th className="px-4 py-3 text-right text-slate-400 font-medium w-28">الكود</th>
                <th className="px-4 py-3 text-right text-slate-400 font-medium">اسم الحساب</th>
                <th className="px-4 py-3 text-left  text-slate-400 font-medium w-36">رصيد افتتاحي</th>
                <th className="px-4 py-3 text-left  text-slate-400 font-medium w-32">مدين الفترة</th>
                <th className="px-4 py-3 text-left  text-slate-400 font-medium w-32">دائن الفترة</th>
                <th className="px-4 py-3 text-left  text-slate-400 font-medium w-36">رصيد ختامي</th>
              </tr>
            </thead>
            <tbody>
              {ACCOUNT_TYPE_ORDER.map(type => {
                const typeRows = grouped[type]
                if (!typeRows || typeRows.length === 0) return null

                const subtotalOpen   = typeRows.reduce((s, r) => s + r.opening_balance,  0)
                const subtotalDebit  = typeRows.reduce((s, r) => s + r.period_debit,     0)
                const subtotalCredit = typeRows.reduce((s, r) => s + r.period_credit,    0)
                const subtotalClose  = typeRows.reduce((s, r) => s + r.closing_balance,  0)

                return [
                  // Section header
                  <tr key={`hdr-${type}`} className="bg-slate-700/50 border-t border-slate-600">
                    <td colSpan={6} className="px-4 py-2 text-xs font-bold text-slate-300 uppercase tracking-wide">
                      {ACCOUNT_TYPE_LABELS[type]}
                    </td>
                  </tr>,

                  // Account rows
                  ...typeRows.map((row) => (
                    <tr key={row.account_code} className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${row.is_header ? 'font-semibold text-slate-200' : 'text-slate-300'}`}>
                      <td className="px-4 py-2.5 font-mono text-slate-400 text-xs">{row.account_code}</td>
                      <td className="px-4 py-2.5">
                        {row.is_header && <span className="text-[10px] text-violet-400 border border-violet-700 rounded px-1 me-1.5">رأسي</span>}
                        {row.account_name}
                      </td>
                      <td className="px-4 py-2.5 text-left font-mono text-xs">{fmt(row.opening_balance)}</td>
                      <td className="px-4 py-2.5 text-left font-mono text-xs text-blue-300">{row.period_debit > 0 ? row.period_debit.toLocaleString('en', { minimumFractionDigits: 2 }) : <span className="text-slate-600">—</span>}</td>
                      <td className="px-4 py-2.5 text-left font-mono text-xs text-amber-300">{row.period_credit > 0 ? row.period_credit.toLocaleString('en', { minimumFractionDigits: 2 }) : <span className="text-slate-600">—</span>}</td>
                      <td className="px-4 py-2.5 text-left font-mono text-xs font-semibold">{fmt(row.closing_balance)}</td>
                    </tr>
                  )),

                  // Section subtotal
                  <tr key={`sub-${type}`} className="bg-slate-700/40 border-t border-slate-600">
                    <td colSpan={2} className="px-4 py-2 text-xs text-slate-400 font-semibold">
                      مجموع {ACCOUNT_TYPE_LABELS[type]}
                    </td>
                    <td className="px-4 py-2 text-left font-mono text-xs font-bold text-slate-200">{fmt(subtotalOpen)}</td>
                    <td className="px-4 py-2 text-left font-mono text-xs font-bold text-blue-200">{subtotalDebit > 0 ? subtotalDebit.toLocaleString('en', { minimumFractionDigits: 2 }) : '—'}</td>
                    <td className="px-4 py-2 text-left font-mono text-xs font-bold text-amber-200">{subtotalCredit > 0 ? subtotalCredit.toLocaleString('en', { minimumFractionDigits: 2 }) : '—'}</td>
                    <td className="px-4 py-2 text-left font-mono text-xs font-bold text-slate-200">{fmt(subtotalClose)}</td>
                  </tr>,
                ]
              })}

              {/* Grand total row */}
              {summary && (
                <tr className="bg-slate-900/60 border-t-2 border-slate-500">
                  <td colSpan={2} className="px-4 py-3 text-sm font-bold text-slate-100">الإجمالي</td>
                  <td className="px-4 py-3 text-left font-mono text-sm font-bold text-slate-100">—</td>
                  <td className="px-4 py-3 text-left font-mono text-sm font-bold text-blue-300">
                    {summary.total_period_debit.toLocaleString('en', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-left font-mono text-sm font-bold text-amber-300">
                    {summary.total_period_credit.toLocaleString('en', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-left font-mono text-sm font-bold">
                    <span className={summary.is_balanced ? 'text-emerald-400' : 'text-red-400'}>
                      {summary.is_balanced ? 'متوازن' : `فرق ${Math.abs(summary.imbalance).toLocaleString('en', { minimumFractionDigits: 2 })}`}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {filteredRows.length === 0 && params && !isLoading && (
            <div className="text-center py-10 text-slate-500 text-sm">
              {search ? `لا نتائج للبحث "${search}"` : 'لا توجد حسابات بأرصدة في هذه الفترة'}
            </div>
          )}
          </div>
        </div>
      )}

      {/* By-type breakdown */}
      {summary?.by_type && Object.keys(summary.by_type).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(summary.by_type).map(([type, val]) => (
            <div key={type} className="bg-slate-800/60 border border-slate-700 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-1">{ACCOUNT_TYPE_LABELS[type as AccountType] ?? type}</p>
              <p className="text-xs text-blue-300">مدين: {(val as { debit: number }).debit.toLocaleString('en', { maximumFractionDigits: 0 })}</p>
              <p className="text-xs text-amber-300">دائن: {(val as { credit: number }).credit.toLocaleString('en', { maximumFractionDigits: 0 })}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
