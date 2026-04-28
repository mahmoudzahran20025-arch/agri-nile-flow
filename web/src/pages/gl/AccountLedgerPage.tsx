import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Download, TrendingUp, TrendingDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { glApi, downloadCsv } from '../../api/client'
import QueryBoundary from '../../components/ui/QueryBoundary'

interface LedgerLine {
  id:              number
  entry_id:        number
  account_code:    string
  debit:           number
  credit:          number
  narration:       string | null
  entry_date:      string
  entry_desc:      string | null
  ref_type:        string | null
  ref_id:          number | null
  running_balance: number
}

interface Account {
  code:           string
  name:           string
  account_type:   string
  normal_balance: string
  level:          number
  is_header:      number
}

const REF_LABELS: Record<string, string> = {
  cash_transaction:     'خزينة',
  supplier_transaction: 'مورد',
  inventory_movement:   'مخزون',
  manual:               'يدوي',
}
const REF_COLORS: Record<string, string> = {
  cash_transaction:     'badge-green',
  supplier_transaction: 'badge-blue',
  inventory_movement:   'badge-amber',
  manual:               'badge-slate',
}
const TYPE_AR: Record<string, string> = {
  asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية',
  revenue: 'إيرادات', expense: 'مصروفات',
}

function egp(n: number) {
  if (!n) return '—'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))
}

function today() {
  return new Date().toISOString().slice(0, 10)
}
function startOfYear() {
  return `${new Date().getFullYear()}-01-01`
}

export default function AccountLedgerPage() {
  const { code } = useParams<{ code: string }>()
  const navigate  = useNavigate()

  const [start, setStart] = useState(startOfYear())
  const [end,   setEnd]   = useState(today())
  const [search, setSearch] = useState('')
  const [refType, setRefType] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [page, setPage]     = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [jumpInput, setJumpInput] = useState('')

  function resetFilters() {
    setStart(startOfYear())
    setEnd(today())
    setSearch('')
    setRefType('')
    setMinAmount('')
    setMaxAmount('')
    setPage(1)
    setJumpInput('')
  }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['gl-ledger', code, start, end, page, pageSize],
    queryFn:  () => glApi.ledger(code!, start || undefined, end || undefined, page, pageSize) as Promise<{
      account:         Account
      lines:           LedgerLine[]
      total:           number
      page:            number
      size:            number
      total_pages:     number
      opening_balance: number
    }>,
    enabled: !!code,
  })

  const account         = data?.account
  const lines           = data?.lines ?? []
  const totalPages      = data?.total_pages ?? 1
  const openingBalance  = data?.opening_balance ?? 0

  const filteredLines = lines.filter((l) => {
    const q = search.trim().toLowerCase()
    const byText = !q
      || (l.narration ?? '').toLowerCase().includes(q)
      || (l.entry_desc ?? '').toLowerCase().includes(q)
      || String(l.entry_id).includes(q)
    const byRef = !refType || l.ref_type === refType
    const amount = Math.max(Number(l.debit || 0), Number(l.credit || 0))
    const min = Number(minAmount)
    const max = Number(maxAmount)
    const byMin = !minAmount || amount >= min
    const byMax = !maxAmount || amount <= max
    return byText && byRef && byMin && byMax
  })

  const absAmounts = filteredLines
    .map((l) => Math.max(Number(l.debit || 0), Number(l.credit || 0)))
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  const unusualThreshold = absAmounts.length > 0
    ? absAmounts[Math.floor(absAmounts.length * 0.9)]
    : Infinity

  const monthlySummary = Object.entries(
    filteredLines.reduce<Record<string, { debit: number; credit: number }>>((acc, l) => {
      const key = l.entry_date.slice(0, 7)
      if (!acc[key]) acc[key] = { debit: 0, credit: 0 }
      acc[key].debit += Number(l.debit || 0)
      acc[key].credit += Number(l.credit || 0)
      return acc
    }, {})
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)

  const totalDebit  = filteredLines.reduce((s, l) => s + (l.debit  ?? 0), 0)
  const totalCredit = filteredLines.reduce((s, l) => s + (l.credit ?? 0), 0)
  const netBalance  = totalDebit - totalCredit
  const isDebitNormal = account?.normal_balance === 'debit'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/gl/accounts')} className="btn btn-ghost p-2">
          <ArrowRight size={18} />
        </button>
        <BookOpen size={24} className="text-brand-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            دفتر الأستاذ
            {account && (
              <span className="font-mono text-brand-700 mr-2">{account.code}</span>
            )}
          </h1>
          {account && (
            <p className="text-sm text-gray-500">
              {account.name} · {TYPE_AR[account.account_type] ?? account.account_type}
            </p>
          )}
        </div>
        <div className="flex-1" />
        <button
          className="btn btn-ghost gap-2"
          onClick={() => downloadCsv(`/gl/ledger/${code}`, `دفتر_أستاذ_${code}`, {
            start: start || undefined,
            end:   end   || undefined,
          })}
        >
          <Download size={16} /> تصدير
        </button>
      </div>

      {/* Date filters */}
      <div className="card p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">من:</label>
          <input
            type="date"
            className="input w-40"
            value={start}
            onChange={e => { setStart(e.target.value); setPage(1) }}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">إلى:</label>
          <input
            type="date"
            className="input w-40"
            value={end}
            onChange={e => { setEnd(e.target.value); setPage(1) }}
          />
        </div>
        <input
          type="text"
          className="input w-56"
          placeholder="بحث في البيان أو رقم القيد"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-40" value={refType} onChange={(e) => setRefType(e.target.value)}>
          <option value="">كل المصادر</option>
          <option value="cash_transaction">خزينة</option>
          <option value="supplier_transaction">مورد</option>
          <option value="inventory_movement">مخزون</option>
          <option value="manual">يدوي</option>
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          className="input w-32"
          placeholder="أدنى"
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
        />
        <input
          type="number"
          min="0"
          step="0.01"
          className="input w-32"
          placeholder="أعلى"
          value={maxAmount}
          onChange={(e) => setMaxAmount(e.target.value)}
        />
        {(start !== startOfYear() || end !== today()) && (
          <button
            className="btn btn-ghost text-sm"
            onClick={resetFilters}
          >
            إعادة تعيين
          </button>
        )}
      </div>

      {/* Summary cards */}
      {!isLoading && account && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">إجمالي المدين</p>
            <p className="text-lg font-bold text-gray-800">{egp(totalDebit)}</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">إجمالي الدائن</p>
            <p className="text-lg font-bold text-gray-800">{egp(totalCredit)}</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">
              صافي الرصيد ({isDebitNormal ? 'مدين' : 'دائن'})
            </p>
            <p className={`text-lg font-bold flex items-center justify-center gap-1 ${
              netBalance >= 0 ? 'text-green-700' : 'text-red-600'
            }`}>
              {netBalance >= 0
                ? <TrendingUp size={16} />
                : <TrendingDown size={16} />}
              {egp(Math.abs(netBalance))}
            </p>
          </div>
        </div>
      )}

      {!isLoading && monthlySummary.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800">ملخص شهري (آخر 6 أشهر ضمن النتائج)</h2>
            <span className="text-xs text-gray-400">{filteredLines.length} حركة</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {monthlySummary.map(([month, v]) => (
              <div key={month} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-bold text-gray-600">{month}</p>
                <p className="text-xs text-red-600 mt-1">مدين: {egp(v.debit)}</p>
                <p className="text-xs text-emerald-700">دائن: {egp(v.credit)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ledger table */}
      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        isEmpty={filteredLines.length === 0}
        onRetry={() => refetch()}
        emptyMessage="لا توجد حركات لهذا الحساب في الفترة المحددة"
        loadingRows={8}
      >
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="th">التاريخ</th>
                <th className="th">البيان</th>
                <th className="th">المصدر</th>
                <th className="th">رقم القيد</th>
                <th className="th text-left">مدين</th>
                <th className="th text-left">دائن</th>
                <th className="th text-left">الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {/* Opening balance row (shown only when paginating beyond page 1) */}
              {page > 1 && (
                <tr className="border-b bg-blue-50/50">
                  <td className="td text-xs text-gray-400 italic" colSpan={6}>
                    رصيد مرحّل (الصفحات السابقة)
                  </td>
                  <td className="td text-left">
                    <span className={`font-bold text-sm ${openingBalance >= 0 ? 'text-gray-700' : 'text-red-600'}`}>
                      {egp(Math.abs(openingBalance))}
                      <span className="text-xs font-normal text-gray-400 mr-1">
                        {openingBalance >= 0 ? 'م' : 'د'}
                      </span>
                    </span>
                  </td>
                </tr>
              )}
              {filteredLines.map((l, i) => {
                const lineAmount = Math.max(Number(l.debit || 0), Number(l.credit || 0))
                const unusual = lineAmount >= unusualThreshold && lineAmount > 0
                return (
                <tr
                  key={l.id}
                  className={`border-b transition-colors hover:bg-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/40'} ${unusual ? 'bg-amber-50/70' : ''}`}
                  title={unusual ? 'حركة ذات قيمة مرتفعة مقارنة بباقي الفترة' : undefined}
                >
                  <td className="td font-mono text-xs text-gray-500">
                    {new Date(l.entry_date).toLocaleDateString('en-US', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </td>
                  <td className="td">
                    <p className="font-medium text-gray-800">{l.narration || l.entry_desc || '—'}</p>
                    {l.narration && l.entry_desc && l.narration !== l.entry_desc && (
                      <p className="text-xs text-gray-400">{l.entry_desc}</p>
                    )}
                  </td>
                  <td className="td">
                    {l.ref_type ? (
                      <span className={`badge text-xs ${REF_COLORS[l.ref_type] ?? 'badge-slate'}`}>
                        {REF_LABELS[l.ref_type] ?? l.ref_type}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="td">
                    <Link
                      to={`/gl/entries?id=${l.entry_id}`}
                      className="font-mono text-brand-600 hover:underline text-xs"
                      title="عرض القيد"
                    >
                      #{l.entry_id}
                    </Link>
                  </td>
                  <td className="td text-left">
                    {l.debit > 0
                      ? <span className="font-medium text-gray-800">{egp(l.debit)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="td text-left">
                    {l.credit > 0
                      ? <span className="font-medium text-gray-800">{egp(l.credit)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="td text-left">
                    <span className={`font-bold text-sm ${
                      l.running_balance >= 0 ? 'text-gray-800' : 'text-red-600'
                    }`}>
                      {egp(Math.abs(l.running_balance))}
                      <span className="text-xs font-normal text-gray-400 mr-1">
                        {l.running_balance >= 0 ? 'م' : 'د'}
                      </span>
                    </span>
                  </td>
                </tr>
                )})}
            </tbody>
            {/* Totals row */}
            <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-semibold">
              <tr>
                <td className="td" colSpan={4}>الإجمالي (هذه الصفحة)</td>
                <td className="td text-left text-gray-800">{egp(totalDebit)}</td>
                <td className="td text-left text-gray-800">{egp(totalCredit)}</td>
                <td className="td text-left">
                  <span className={netBalance >= 0 ? 'text-green-700' : 'text-red-600'}>
                    {egp(Math.abs(netBalance))}
                    <span className="text-xs font-normal mr-1">
                      {netBalance >= 0 ? (isDebitNormal ? 'مدين' : 'دائن') : (isDebitNormal ? 'دائن' : 'مدين')}
                    </span>
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-t bg-gray-50">
              <button
                className="btn btn-ghost gap-1 text-sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronRight size={16} /> السابق
              </button>

              {/* Page jump */}
              <form
                className="flex items-center gap-2"
                onSubmit={e => {
                  e.preventDefault()
                  const n = parseInt(jumpInput, 10)
                  if (n >= 1 && n <= totalPages) { setPage(n); setJumpInput('') }
                }}
              >
                <span className="text-sm text-gray-600">صفحة</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  className="input w-16 text-center text-sm py-1"
                  placeholder={String(page)}
                  value={jumpInput}
                  onChange={e => setJumpInput(e.target.value)}
                />
                <span className="text-sm text-gray-400">من {totalPages}</span>
                {data?.total != null && (
                  <span className="text-xs text-gray-400">({data.total} حركة)</span>
                )}
              </form>

              {/* Page size */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">حجم الصفحة:</span>
                <select
                  className="input py-1 text-xs w-20"
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(1); setJumpInput('') }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>

              <button
                className="btn btn-ghost gap-1 text-sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                التالي <ChevronLeft size={16} />
              </button>
            </div>
          )}
        </div>
      </QueryBoundary>
    </div>
  )
}
