import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileText, TrendingUp, TrendingDown, Package, Users, Banknote, ArrowDown, ArrowUp, Download, Clock, BarChart3, Leaf, Target, ShieldCheck, Lock, ChevronLeft } from 'lucide-react'
import { dashboardApi, suppliersApi, treasuryApi, inventoryApi, downloadCsv } from '../api/client'
import { useSeasonId } from '../store/appStore'
import type { Supplier } from '../types'

function egp(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

interface AgingRow {
  code: number; name: string; activity: string | null
  total_balance: number; current_0_30: number; aged_31_60: number; aged_61_90: number; aged_90_plus: number
}
interface AgingData {
  suppliers: AgingRow[]
  totals: AgingRow
  as_of: string
}

export default function ReportsPage() {
  const seasonId = useSeasonId()
  const navigate = useNavigate()
  const [agingAsOf, setAgingAsOf] = useState(new Date().toISOString().slice(0, 10))

  const { data: stats }      = useQuery({ queryKey: ['dashboard', 'stats'], queryFn: dashboardApi.stats })
  const { data: cashflow }   = useQuery({ queryKey: ['dashboard', 'cashflow12'], queryFn: () => dashboardApi.monthlyCashflow(12) as Promise<{ year: number; month: number; cash_in: number; cash_out: number }[]> })
  const { data: byCrop }     = useQuery({ queryKey: ['dashboard', 'crop', seasonId], queryFn: () => dashboardApi.costByCrop(seasonId) as Promise<{ crop: string | null; total_cost: number }[]> })
  const { data: suppliers }  = useQuery({ queryKey: ['suppliers', 1, ''], queryFn: () => suppliersApi.list({ page: 1, size: 200 }) as Promise<{ data: Supplier[] }> })
  const { data: balances }   = useQuery({ queryKey: ['inventory', 'balances', null], queryFn: () => inventoryApi.balances() })
  const { data: partners }   = useQuery({ queryKey: ['partners'], queryFn: treasuryApi.partners })
  const { data: agingRaw }   = useQuery({
    queryKey: ['suppliers-aging', agingAsOf],
    queryFn:  () => suppliersApi.aging(agingAsOf) as Promise<AgingData>,
  })

  const cashflowData = (cashflow ?? [])
  const suppliersData = suppliers?.data ?? []
  const balancesData  = (balances ?? []) as { warehouse: string; item_name: string; unit: string; balance_qty: number; balance_value: number }[]
  const partnersData  = (partners ?? []) as { name: string; capital_paid: number; current_acct: number }[]

  // Warehouse totals
  const warehouseTotals = balancesData.reduce<Record<string, number>>((acc, b) => {
    acc[b.warehouse] = (acc[b.warehouse] ?? 0) + b.balance_value
    return acc
  }, {})

  // Suppliers: split debtors vs creditors
  const debtors   = suppliersData.filter(s => (s.current_balance ?? 0) > 0).sort((a, b) => (b.current_balance ?? 0) - (a.current_balance ?? 0))
  const creditors = suppliersData.filter(s => (s.current_balance ?? 0) < 0).sort((a, b) => (a.current_balance ?? 0) - (b.current_balance ?? 0))

  return (
    <div className="space-y-6 pb-10">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <FileText size={22} className="text-slate-400" />
          التقارير المالية
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-secondary gap-2" onClick={() => downloadCsv('/suppliers', 'أرصدة_الموردين')}>
            <Download size={14} /> موردين
          </button>
          <button className="btn-secondary gap-2" onClick={() => downloadCsv('/inventory', 'أرصدة_المخازن')}>
            <Download size={14} /> مخزون
          </button>
          <button className="btn-secondary gap-2" onClick={() => downloadCsv('/treasury', 'دفتر_اليومية', { year: new Date().getFullYear() })}>
            <Download size={14} /> خزينة
          </button>
          <button className="btn-secondary gap-2" onClick={() => window.print()}>
            <FileText size={15} /> طباعة PDF
          </button>
          <button className="btn-primary gap-2" onClick={() => navigate('/reports/charts')}>
            <BarChart3 size={15} /> التقارير المرئية
          </button>
        </div>
      </div>

      {/* ── Specialized Reports Hub ──────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { to: '/reports/season-summary',   icon: <Leaf       size={20} />, label: 'ملخص الموسم',           color: 'text-emerald-600', bg: 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200' },
          { to: '/reports/season-pnl',       icon: <TrendingUp size={20} />, label: 'أرباح وخسائر الموسم',   color: 'text-brand-600',   bg: 'bg-brand-50 hover:bg-brand-100 border-brand-200' },
          { to: '/reports/budget-vs-actual', icon: <Target     size={20} />, label: 'الميزانية مقابل الفعلي', color: 'text-amber-600',   bg: 'bg-amber-50 hover:bg-amber-100 border-amber-200' },
          { to: '/reports/season-readiness', icon: <ShieldCheck size={20} />, label: 'جاهزية الإغلاق',        color: 'text-teal-600',    bg: 'bg-teal-50 hover:bg-teal-100 border-teal-200' },
          { to: '/reports/season-close',     icon: <Lock       size={20} />, label: 'إغلاق الموسم',           color: 'text-red-600',     bg: 'bg-red-50 hover:bg-red-100 border-red-200' },
        ].map(card => (
          <button
            key={card.to}
            onClick={() => navigate(card.to)}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all ${card.bg}`}
          >
            <span className={card.color}>{card.icon}</span>
            <span className={`text-xs font-semibold ${card.color}`}>{card.label}</span>
            <ChevronLeft size={12} className="text-slate-300 -rotate-180" />
          </button>
        ))}
      </div>

      {/* ── Section 1: Financial Summary ─────────────────────── */}
      <Section title="الملخص المالي" icon={<Banknote size={16} />}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'رصيد الخزينة',    val: stats?.cash_balance,    color: 'text-green-700', bg: 'bg-green-50' },
            { label: 'صافي المديونية',  val: stats?.net_payable,     color: 'text-red-600',   bg: 'bg-red-50'   },
            { label: 'قيمة المخزون',    val: stats?.inventory_value, color: 'text-blue-700',  bg: 'bg-blue-50'  },
            { label: 'حقوق الشركاء',   val: stats?.partners_equity, color: 'text-brand-700', bg: 'bg-brand-50' },
          ].map(k => (
            <div key={k.label} className={`${k.bg} rounded-xl p-4 text-center`}>
              <p className="text-xs text-slate-500 mb-1">{k.label}</p>
              <p className={`text-xl font-bold ${k.color}`}>{egp(k.val ?? 0)}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Section 2: Monthly Cashflow ──────────────────────── */}
      <Section title="التدفق النقدي — آخر 12 شهراً" icon={<TrendingUp size={16} />}>
        {cashflowData.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {['الشهر', 'وارد (دائن)', 'منصرف (مدين)', 'صافي الشهر'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cashflowData.map(row => {
                  const net = row.cash_in - row.cash_out
                  return (
                    <tr key={`${row.year}-${row.month}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-700">
                        {MONTHS[row.month - 1]} {row.year}
                      </td>
                      <td className="px-4 py-2.5 text-green-700 font-medium">
                        <span className="flex items-center gap-1"><ArrowDown size={12}/>{egp(row.cash_in)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-red-600 font-medium">
                        <span className="flex items-center gap-1"><ArrowUp size={12}/>{egp(row.cash_out)}</span>
                      </td>
                      <td className={`px-4 py-2.5 font-bold ${net >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {egp(net)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td className="px-4 py-2.5 font-semibold text-slate-600">الإجمالي</td>
                  <td className="px-4 py-2.5 font-bold text-green-700">
                    {egp(cashflowData.reduce((s, r) => s + r.cash_in, 0))}
                  </td>
                  <td className="px-4 py-2.5 font-bold text-red-600">
                    {egp(cashflowData.reduce((s, r) => s + r.cash_out, 0))}
                  </td>
                  <td className={`px-4 py-2.5 font-bold ${
                    cashflowData.reduce((s, r) => s + r.cash_in - r.cash_out, 0) >= 0
                      ? 'text-green-700' : 'text-red-600'
                  }`}>
                    {egp(cashflowData.reduce((s, r) => s + r.cash_in - r.cash_out, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : <EmptyMsg />}
      </Section>

      {/* ── Section 3: Cost by Crop ──────────────────────────── */}
      {byCrop && byCrop.length > 0 && (
        <Section title="التكلفة حسب المحصول / مركز التكلفة" icon={<TrendingDown size={16} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {['المحصول / المركز', 'إجمالي التكلفة', 'النسبة'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byCrop.map((row, i) => {
                  const grandTotal = byCrop.reduce((s, r) => s + r.total_cost, 0)
                  const pct = grandTotal > 0 ? ((row.total_cost / grandTotal) * 100).toFixed(1) : '0.0'
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{row.crop ?? 'غير محدد'}</td>
                      <td className="px-4 py-2.5 font-semibold text-red-600">{egp(row.total_cost)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-1.5 max-w-[80px]">
                            <div className="bg-brand-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-slate-500">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── Section 4: Warehouse Inventory ───────────────────── */}
      <Section title="قيمة المخزون حسب المخزن" icon={<Package size={16} />}>
        {Object.keys(warehouseTotals).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {['المخزن', 'عدد الأصناف', 'إجمالي القيمة'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(warehouseTotals).sort((a, b) => b[1] - a[1]).map(([wh, val]) => (
                  <tr key={wh} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{wh}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {balancesData.filter(b => b.warehouse === wh).length} صنف
                    </td>
                    <td className="px-4 py-2.5 font-bold text-brand-700">{egp(val)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td className="px-4 py-2.5 font-semibold text-slate-600">الإجمالي</td>
                  <td className="px-4 py-2.5 text-slate-500">{balancesData.length} صنف</td>
                  <td className="px-4 py-2.5 font-bold text-brand-700">
                    {egp(Object.values(warehouseTotals).reduce((s, v) => s + v, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : <EmptyMsg />}
      </Section>

      {/* ── Section 5: Suppliers with balance ────────────────── */}
      <Section title="أرصدة الموردين والعملاء" icon={<TrendingDown size={16} />}>
        {suppliersData.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Debtors */}
            <div>
              <p className="text-xs font-bold text-green-700 mb-2 px-1">
                دائنون (يستحقون للمورد) — {debtors.length} مورد
              </p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {debtors.slice(0, 10).map(s => (
                    <tr key={s.code} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800 truncate max-w-[160px]">{s.name}</td>
                      <td className="px-3 py-2 font-bold text-green-700 text-left">{egp(s.current_balance)}</td>
                    </tr>
                  ))}
                  {debtors.length > 10 && (
                    <tr><td colSpan={2} className="px-3 py-2 text-xs text-slate-400 text-center">+{debtors.length - 10} أخرى</td></tr>
                  )}
                  {!debtors.length && <tr><td colSpan={2} className="px-3 py-4 text-center text-slate-400 text-xs">لا يوجد</td></tr>}
                </tbody>
              </table>
            </div>
            {/* Creditors */}
            <div>
              <p className="text-xs font-bold text-red-600 mb-2 px-1">
                مدينون (يستحق منهم) — {creditors.length} مورد
              </p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {creditors.slice(0, 10).map(s => (
                    <tr key={s.code} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800 truncate max-w-[160px]">{s.name}</td>
                      <td className="px-3 py-2 font-bold text-red-600 text-left">{egp(Math.abs(s.current_balance ?? 0))}</td>
                    </tr>
                  ))}
                  {creditors.length > 10 && (
                    <tr><td colSpan={2} className="px-3 py-2 text-xs text-slate-400 text-center">+{creditors.length - 10} أخرى</td></tr>
                  )}
                  {!creditors.length && <tr><td colSpan={2} className="px-3 py-4 text-center text-slate-400 text-xs">لا يوجد</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : <EmptyMsg />}
      </Section>

      {/* ── Section 6: Supplier Aging ────────────────────────── */}
      <Section title="تحليل أعمار الديون (الموردون والعملاء)" icon={<Clock size={16} />}>
        <div className="flex items-center gap-3 mb-4">
          <label className="text-xs text-slate-500">حتى تاريخ:</label>
          <input type="date" className="input w-auto text-sm" value={agingAsOf}
            onChange={e => setAgingAsOf(e.target.value)} />
        </div>
        {agingRaw && agingRaw.suppliers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {['المورد / العميل', 'النشاط', 'الرصيد الكلي', '0 – 30 يوم', '31 – 60 يوم', '61 – 90 يوم', '90+ يوم'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agingRaw.suppliers.map(row => (
                  <tr key={row.code} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{row.name}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{row.activity ?? '—'}</td>
                    <td className={`px-4 py-2.5 font-bold ${row.total_balance > 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {egp(row.total_balance)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{row.current_0_30 !== 0 ? egp(row.current_0_30) : '—'}</td>
                    <td className="px-4 py-2.5 text-amber-600 font-medium">{row.aged_31_60 !== 0 ? egp(row.aged_31_60) : '—'}</td>
                    <td className="px-4 py-2.5 text-orange-600 font-medium">{row.aged_61_90 !== 0 ? egp(row.aged_61_90) : '—'}</td>
                    <td className="px-4 py-2.5 text-red-600 font-bold">{row.aged_90_plus !== 0 ? egp(row.aged_90_plus) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                <tr>
                  <td className="px-4 py-2.5 font-bold text-slate-700">الإجمالي</td>
                  <td />
                  <td className={`px-4 py-2.5 font-bold ${agingRaw.totals.total_balance > 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {egp(agingRaw.totals.total_balance)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{egp(agingRaw.totals.current_0_30)}</td>
                  <td className="px-4 py-2.5 text-amber-600">{egp(agingRaw.totals.aged_31_60)}</td>
                  <td className="px-4 py-2.5 text-orange-600">{egp(agingRaw.totals.aged_61_90)}</td>
                  <td className="px-4 py-2.5 text-red-600">{egp(agingRaw.totals.aged_90_plus)}</td>
                </tr>
              </tfoot>
            </table>
            {agingRaw.totals.aged_90_plus > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                <TrendingDown size={13} />
                تنبيه: يوجد {egp(agingRaw.totals.aged_90_plus)} متأخر أكثر من 90 يوماً — يستوجب المتابعة الفورية
              </div>
            )}
          </div>
        ) : <EmptyMsg />}
      </Section>

      {/* ── Section 7: Partners ──────────────────────────────── */}
      {partnersData.length > 0 && (
        <Section title="حقوق الشركاء" icon={<Users size={16} />}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الشريك', 'رأس المال', 'الجاري', 'الإجمالي'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {partnersData.map((p, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{p.name}</td>
                  <td className="px-4 py-2.5 text-brand-700 font-medium">{egp(p.capital_paid)}</td>
                  <td className={`px-4 py-2.5 font-medium ${p.current_acct >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {egp(p.current_acct)}
                  </td>
                  <td className="px-4 py-2.5 font-bold text-slate-900">
                    {egp(p.capital_paid + p.current_acct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200 bg-slate-50">
        <span className="text-slate-400">{icon}</span>
        <h2 className="font-bold text-slate-800 text-sm">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function EmptyMsg() {
  return <p className="text-center text-slate-400 text-sm py-6">لا توجد بيانات كافية لعرض هذا التقرير</p>
}
