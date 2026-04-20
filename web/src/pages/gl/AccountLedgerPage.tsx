import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Download, TrendingUp, TrendingDown } from 'lucide-react'
import { glApi, downloadCsv } from '../../api/client'

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
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))
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

  const { data, isLoading } = useQuery({
    queryKey: ['gl-ledger', code, start, end],
    queryFn:  () => glApi.ledger(code!, start || undefined, end || undefined) as Promise<{
      account: Account
      lines:   LedgerLine[]
    }>,
    enabled: !!code,
  })

  const account = data?.account
  const lines   = data?.lines ?? []

  const totalDebit  = lines.reduce((s, l) => s + (l.debit  ?? 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (l.credit ?? 0), 0)
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
            onChange={e => setStart(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">إلى:</label>
          <input
            type="date"
            className="input w-40"
            value={end}
            onChange={e => setEnd(e.target.value)}
          />
        </div>
        {(start !== startOfYear() || end !== today()) && (
          <button
            className="btn btn-ghost text-sm"
            onClick={() => { setStart(startOfYear()); setEnd(today()) }}
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

      {/* Ledger table */}
      {isLoading ? (
        <p className="text-center text-gray-500 py-10">جاري التحميل...</p>
      ) : lines.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <BookOpen size={40} className="mx-auto mb-3 opacity-30" />
          <p>لا توجد حركات لهذا الحساب في الفترة المحددة</p>
        </div>
      ) : (
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
              {lines.map((l, i) => (
                <tr key={l.id} className={`border-b transition-colors hover:bg-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}>
                  <td className="td font-mono text-xs text-gray-500">
                    {new Date(l.entry_date).toLocaleDateString('ar-EG', {
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
                      to="/gl/entries"
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
              ))}
            </tbody>
            {/* Totals row */}
            <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-semibold">
              <tr>
                <td className="td" colSpan={4}>الإجمالي</td>
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
        </div>
      )}
    </div>
  )
}
