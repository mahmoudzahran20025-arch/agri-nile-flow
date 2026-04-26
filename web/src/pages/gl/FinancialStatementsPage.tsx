import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Scale, BarChart3, Download } from 'lucide-react'
import { glApi, downloadCsv } from '../../api/client'

type Tab = 'pl' | 'balance' | 'trial'

interface PLRow     { code: string; name: string; account_type: string; amount: number }
interface BSRow     { code: string; name: string; account_type: string; is_header: number; balance: number }
interface TBRow     { code: string; name: string; account_type: string; level: number; is_header: number
                      total_debit: number; total_credit: number; balance: number; normal_balance: string }

const TYPE_AR: Record<string, string> = {
  asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات',
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0)
}
function egp(n: number) { return `${fmt(n)} ج` }

export default function FinancialStatementsPage() {
  const [tab, setTab]     = useState<Tab>('pl')
  const [startDate, setS] = useState('2025-01-01') // Include historical data
  const [endDate,   setE] = useState(new Date().toISOString().slice(0,10))
  const [asOf,    setAO]  = useState(new Date().toISOString().slice(0,10))

  const { data: plData } = useQuery({
    queryKey: ['gl-pl', startDate, endDate],
    queryFn:  () => glApi.incomeStatement(startDate, endDate),
    enabled:  tab === 'pl',
  })
  const { data: bsData } = useQuery({
    queryKey: ['gl-bs', asOf],
    queryFn:  () => glApi.balanceSheet(asOf),
    enabled:  tab === 'balance',
  })
  const { data: tbData } = useQuery({
    queryKey: ['gl-tb', startDate, endDate],
    queryFn:  () => glApi.trialBalance(startDate, endDate),
    enabled:  tab === 'trial',
  })

  const pl = plData as { revenue?: PLRow[]; expenses?: PLRow[]; total_revenue?: number; total_expenses?: number; net_income?: number } | undefined
  const bs = bsData as { assets?: BSRow[]; liabilities?: BSRow[]; equity?: BSRow[]
                         total_assets?: number; total_liabilities?: number; total_equity?: number; as_of?: string } | undefined
  const tb = tbData as { accounts?: TBRow[]; total_debit?: number; total_credit?: number } | undefined

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 size={24} className="text-brand-600" />
          <h1 className="text-xl font-bold text-gray-900">القوائم المالية</h1>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'pl' && (
            <button
              className="btn btn-ghost gap-2"
              onClick={() => downloadCsv('/gl/income-statement', 'قائمة_الدخل', {
                start: startDate, end: endDate,
              })}
            >
              <Download size={16} /> تصدير CSV
            </button>
          )}
          {tab === 'trial' && (
            <button
              className="btn btn-ghost gap-2"
              onClick={() => downloadCsv('/gl/trial-balance', 'ميزان_المراجعة', {
                start: startDate, end: endDate,
              })}
            >
              <Download size={16} /> تصدير CSV
            </button>
          )}
          {tab === 'balance' && (
            <button
              className="btn btn-ghost gap-2"
              onClick={() => downloadCsv('/gl/balance-sheet', 'الميزانية_العمومية', { as_of: asOf })}
            >
              <Download size={16} /> تصدير CSV
            </button>
          )}
          <button className="btn btn-ghost gap-2" onClick={() => window.print()}>
            <Download size={16} /> طباعة
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {([
          { id: 'pl',      label: 'قائمة الدخل', icon: <TrendingUp size={15} /> },
          { id: 'balance', label: 'الميزانية العمومية', icon: <Scale size={15} /> },
          { id: 'trial',   label: 'ميزان المراجعة', icon: <BarChart3 size={15} /> },
        ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Date Controls */}
      {tab !== 'balance' ? (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium">من:</label>
          <input type="date" className="input w-40" value={startDate} onChange={e => setS(e.target.value)} />
          <label className="text-sm font-medium">إلى:</label>
          <input type="date" className="input w-40" value={endDate} onChange={e => setE(e.target.value)} />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">بتاريخ:</label>
          <input type="date" className="input w-40" value={asOf} onChange={e => setAO(e.target.value)} />
        </div>
      )}

      {/* ── P&L ──────────────────────────────────────────────── */}
      {tab === 'pl' && (
        <div className="space-y-4">
          {/* Summary cards */}
          {pl && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'إجمالي الإيرادات', value: pl.total_revenue ?? 0, color: 'text-green-700', bg: 'bg-green-50' },
                { label: 'إجمالي المصروفات', value: pl.total_expenses ?? 0, color: 'text-red-600', bg: 'bg-red-50' },
                { label: (pl.net_income ?? 0) >= 0 ? 'صافي الربح' : 'صافي الخسارة',
                  value: Math.abs(pl.net_income ?? 0),
                  color: (pl.net_income ?? 0) >= 0 ? 'text-brand-700' : 'text-red-700',
                  bg:    (pl.net_income ?? 0) >= 0 ? 'bg-brand-50' : 'bg-red-50' },
              ].map(k => (
                <div key={k.label} className={`${k.bg} rounded-xl p-4 text-center`}>
                  <p className="text-xs text-gray-500 mb-1">{k.label}</p>
                  <p className={`text-xl font-bold ${k.color}`}>{egp(k.value)}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue */}
            <div className="card overflow-hidden p-0">
              <div className="bg-green-50 border-b px-4 py-3">
                <h3 className="font-bold text-green-800 text-sm">الإيرادات</h3>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {(pl?.revenue ?? []).map(r => (
                    <tr key={r.code} className="border-b hover:bg-gray-50">
                      <td className="td font-mono text-xs text-gray-400">{r.code}</td>
                      <td className="td">{r.name}</td>
                      <td className="td text-green-700 font-medium">{egp(r.amount)}</td>
                    </tr>
                  ))}
                  {!(pl?.revenue?.length) && (
                    <tr><td className="td text-center text-gray-400 py-6" colSpan={3}>لا توجد إيرادات في هذه الفترة</td></tr>
                  )}
                </tbody>
                <tfoot className="bg-green-50 border-t">
                  <tr>
                    <td className="td font-bold" colSpan={2}>إجمالي الإيرادات</td>
                    <td className="td font-bold text-green-700">{egp(pl?.total_revenue ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Expenses */}
            <div className="card overflow-hidden p-0">
              <div className="bg-red-50 border-b px-4 py-3">
                <h3 className="font-bold text-red-800 text-sm">المصروفات</h3>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {(pl?.expenses ?? []).map(r => (
                    <tr key={r.code} className="border-b hover:bg-gray-50">
                      <td className="td font-mono text-xs text-gray-400">{r.code}</td>
                      <td className="td">{r.name}</td>
                      <td className="td text-red-600 font-medium">{egp(r.amount)}</td>
                    </tr>
                  ))}
                  {!(pl?.expenses?.length) && (
                    <tr><td className="td text-center text-gray-400 py-6" colSpan={3}>لا توجد مصروفات في هذه الفترة</td></tr>
                  )}
                </tbody>
                <tfoot className="bg-red-50 border-t">
                  <tr>
                    <td className="td font-bold" colSpan={2}>إجمالي المصروفات</td>
                    <td className="td font-bold text-red-600">{egp(pl?.total_expenses ?? 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Net Income */}
          {pl && (
            <div className={`rounded-xl p-5 text-center ${(pl.net_income ?? 0) >= 0 ? 'bg-brand-50 border border-brand-200' : 'bg-red-50 border border-red-200'}`}>
              <p className="text-sm text-gray-600 mb-1">
                {(pl.net_income ?? 0) >= 0 ? '🌾 صافي الربح للفترة' : '⚠️ صافي الخسارة للفترة'}
              </p>
              <p className={`text-3xl font-bold ${(pl.net_income ?? 0) >= 0 ? 'text-brand-700' : 'text-red-700'}`}>
                {egp(Math.abs(pl.net_income ?? 0))}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Balance Sheet ────────────────────────────────────── */}
      {tab === 'balance' && (
        <div className="space-y-4">
          {bs && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'إجمالي الأصول',      value: bs.total_assets      ?? 0, color: 'text-blue-700', bg: 'bg-blue-50' },
                { label: 'إجمالي الخصوم',      value: bs.total_liabilities ?? 0, color: 'text-red-600',  bg: 'bg-red-50' },
                { label: 'إجمالي حقوق الملكية', value: bs.total_equity      ?? 0, color: 'text-brand-700', bg: 'bg-brand-50' },
              ].map(k => (
                <div key={k.label} className={`${k.bg} rounded-xl p-4 text-center`}>
                  <p className="text-xs text-gray-500 mb-1">{k.label}</p>
                  <p className={`text-xl font-bold ${k.color}`}>{egp(k.value)}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Assets */}
            <div className="card overflow-hidden p-0">
              <div className="bg-blue-50 border-b px-4 py-3">
                <h3 className="font-bold text-blue-800 text-sm">الأصول</h3>
              </div>
              <BSSection rows={bs?.assets ?? []} totalKey="إجمالي الأصول" total={bs?.total_assets ?? 0} color="text-blue-700" />
            </div>

            {/* Liabilities + Equity */}
            <div className="space-y-4">
              <div className="card overflow-hidden p-0">
                <div className="bg-red-50 border-b px-4 py-3">
                  <h3 className="font-bold text-red-800 text-sm">الخصوم</h3>
                </div>
                <BSSection rows={bs?.liabilities ?? []} totalKey="إجمالي الخصوم" total={bs?.total_liabilities ?? 0} color="text-red-600" />
              </div>
              <div className="card overflow-hidden p-0">
                <div className="bg-brand-50 border-b px-4 py-3">
                  <h3 className="font-bold text-brand-800 text-sm">حقوق الملكية</h3>
                </div>
                <BSSection rows={bs?.equity ?? []} totalKey="إجمالي حقوق الملكية" total={bs?.total_equity ?? 0} color="text-brand-700" />
              </div>
            </div>
          </div>

          {/* Balance check */}
          {bs && (
            <div className={`rounded-xl p-3 text-center text-sm font-medium ${
              Math.abs((bs.total_assets ?? 0) - ((bs.total_liabilities ?? 0) + (bs.total_equity ?? 0))) < 1
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}>
              الأصول = الخصوم + حقوق الملكية &nbsp;
              {egp(bs.total_assets ?? 0)} = {egp((bs.total_liabilities ?? 0) + (bs.total_equity ?? 0))}
            </div>
          )}
        </div>
      )}

      {/* ── Trial Balance ─────────────────────────────────────── */}
      {tab === 'trial' && (
        <div className="card overflow-hidden p-0">
          {!tb ? (
            <p className="text-center text-gray-400 py-8">جاري التحميل...</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="th">كود</th>
                  <th className="th">اسم الحساب</th>
                  <th className="th">النوع</th>
                  <th className="th">مجموع المدين</th>
                  <th className="th">مجموع الدائن</th>
                  <th className="th">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {(tb.accounts ?? []).map(a => (
                  <tr
                    key={a.code}
                    className={`border-b ${a.is_header ? 'bg-gray-50 font-semibold' : 'hover:bg-gray-50'}`}
                  >
                    <td className="td font-mono text-brand-700 text-xs">{a.code}</td>
                    <td className="td" style={{ paddingRight: `${(a.level - 1) * 12}px` }}>
                      {a.is_header ? '▸ ' : ''}{a.name}
                    </td>
                    <td className="td">
                      <span className="text-xs text-gray-500">{TYPE_AR[a.account_type] ?? a.account_type}</span>
                    </td>
                    <td className="td text-red-600">
                      {a.total_debit > 0 ? fmt(a.total_debit) : '—'}
                    </td>
                    <td className="td text-green-700">
                      {a.total_credit > 0 ? fmt(a.total_credit) : '—'}
                    </td>
                    <td className={`td font-medium ${a.balance >= 0 ? 'text-gray-800' : 'text-red-600'}`}>
                      {a.balance !== 0 ? fmt(Math.abs(a.balance)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 border-t-2 font-bold">
                <tr>
                  <td className="td" colSpan={3}>الإجمالي</td>
                  <td className={`td text-red-600 ${Math.abs((tb.total_debit ?? 0) - (tb.total_credit ?? 0)) < 1 ? '' : 'text-red-800'}`}>
                    {fmt(tb.total_debit ?? 0)}
                  </td>
                  <td className={`td text-green-700 ${Math.abs((tb.total_debit ?? 0) - (tb.total_credit ?? 0)) < 1 ? '' : 'text-red-800'}`}>
                    {fmt(tb.total_credit ?? 0)}
                  </td>
                  <td className="td">
                    {Math.abs((tb.total_debit ?? 0) - (tb.total_credit ?? 0)) < 1
                      ? <span className="badge badge-green">متوازن ✓</span>
                      : <span className="badge badge-red">فرق: {fmt(Math.abs((tb.total_debit ?? 0) - (tb.total_credit ?? 0)))}</span>}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function BSSection({ rows, totalKey, total, color }: {
  rows: BSRow[]; totalKey: string; total: number; color: string
}) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(r => (
          <tr key={r.code} className={`border-b ${r.is_header ? 'bg-gray-50 font-semibold' : 'hover:bg-gray-50'}`}>
            <td className="td font-mono text-xs text-gray-400">{r.code}</td>
            <td className="td">{r.is_header ? '▸ ' : ''}{r.name}</td>
            <td className={`td font-medium ${color}`}>
              {!r.is_header && r.balance !== 0 ? `${fmt(r.balance)} ج` : ''}
            </td>
          </tr>
        ))}
        {!rows.length && (
          <tr><td className="td text-center text-gray-400 py-4" colSpan={3}>لا توجد بيانات</td></tr>
        )}
      </tbody>
      <tfoot className="border-t">
        <tr>
          <td className="td font-bold" colSpan={2}>{totalKey}</td>
          <td className={`td font-bold ${color}`}>{fmt(total)} ج</td>
        </tr>
      </tfoot>
    </table>
  )
}
