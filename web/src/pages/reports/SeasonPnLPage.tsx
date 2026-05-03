import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Leaf, TrendingUp, TrendingDown, Banknote, Package,
  Users, Wrench, ArrowRight, CheckCircle, AlertTriangle,
  DollarSign, Home, ShieldCheck, BookOpen,
} from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'
import type { Season } from '../../types'

// ─── Formatters ───────────────────────────────────────────────

function egp(n: number | null | undefined, signed = false) {
  if (n == null) return '—'
  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'EGP', maximumFractionDigits: 0,
  }).format(Math.abs(n))
  if (!signed) return fmt
  if (n > 0) return `+${fmt}`
  if (n < 0) return `−${fmt}`
  return fmt
}
function num(n: number | null | undefined, dp = 1) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: dp }).format(n)
}
function pct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${num(n, 1)}%`
}

// ─── P&L Waterfall Row ────────────────────────────────────────

interface WaterfallRowProps {
  icon:       React.ReactNode
  label:      string
  value:      number
  sub?:       string
  variant:    'revenue' | 'cost' | 'subtotal' | 'total'
  pctOfRev?:  number
}
function WaterfallRow({ icon, label, value, sub, variant, pctOfRev }: WaterfallRowProps) {
  const cfg = {
    revenue:  { bg: 'bg-emerald-50',  border: 'border-emerald-200', text: 'text-emerald-700', valueText: 'text-emerald-700' },
    cost:     { bg: 'bg-white',        border: 'border-slate-100',   text: 'text-slate-700',   valueText: 'text-red-600' },
    subtotal: { bg: 'bg-slate-50',     border: 'border-slate-200',   text: 'text-slate-600',   valueText: 'text-slate-700' },
    total:    { bg: 'bg-brand-50',     border: 'border-brand-200',   text: 'text-brand-700',   valueText: value >= 0 ? 'text-emerald-700' : 'text-red-700' },
  }[variant]

  return (
    <div className={`flex items-center gap-3 px-5 py-3 border-b ${cfg.bg} ${cfg.border}`}>
      <span className={`flex-shrink-0 ${cfg.text}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${cfg.text}`}>{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
      {pctOfRev != null && (
        <span className="text-xs text-slate-400 w-14 text-left">
          {num(Math.abs(pctOfRev), 1)}%
        </span>
      )}
      <span className={`font-bold text-base tabular-nums ${cfg.valueText} ${variant === 'total' ? 'text-xl' : ''}`}>
        {variant === 'total' ? egp(value, true) : variant === 'cost' ? `−${egp(value)}` : egp(value)}
      </span>
    </div>
  )
}

// ─── Field P&L Row ────────────────────────────────────────────

type FieldRow = {
  id: number; code: string; field_name: string; area_feddan: number; crop_type: string | null
  field_revenue: number; inv_cost: number; labor_cost: number
  field_cost: number; field_margin: number; margin_per_feddan: number | null
}

function FieldPnLRow({ row }: { row: FieldRow }) {
  const profitable = row.field_margin >= 0
  const hasRevenue = row.field_revenue > 0
  const hasCost    = row.field_cost > 0

  return (
    <tr className={`transition-colors hover:bg-slate-50 ${!profitable && hasCost ? 'bg-red-50/40' : ''}`}>
      {/* Field */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0
            ${profitable ? 'bg-emerald-100' : hasCost ? 'bg-red-100' : 'bg-slate-100'}`}>
            <Leaf size={13} className={profitable ? 'text-emerald-600' : hasCost ? 'text-red-500' : 'text-slate-400'} />
          </div>
          <div>
            <p className="font-semibold text-slate-800 text-sm">{row.field_name}</p>
            <p className="text-xs text-slate-400">{row.code}{row.crop_type ? ` · ${row.crop_type}` : ''}</p>
          </div>
        </div>
      </td>

      {/* Area */}
      <td className="px-4 py-3 text-slate-600 text-sm whitespace-nowrap">
        {num(row.area_feddan)} فدان
      </td>

      {/* Revenue */}
      <td className="px-4 py-3 text-emerald-700 font-semibold text-sm">
        {row.field_revenue > 0 ? egp(row.field_revenue) : <span className="text-slate-300">—</span>}
      </td>

      {/* Cost breakdown */}
      <td className="px-4 py-3">
        <div className="space-y-0.5">
          <p className="font-semibold text-red-600 text-sm">{row.field_cost > 0 ? egp(row.field_cost) : <span className="text-slate-300">—</span>}</p>
          {row.inv_cost > 0 && <p className="text-xs text-violet-600">مخزون: {egp(row.inv_cost)}</p>}
          {row.labor_cost > 0 && <p className="text-xs text-blue-600">عمالة: {egp(row.labor_cost)}</p>}
        </div>
      </td>

      {/* Margin */}
      <td className="px-4 py-3">
        {hasRevenue || hasCost ? (
          <span className={`font-bold text-sm ${profitable ? 'text-emerald-700' : 'text-red-600'}`}>
            {egp(row.field_margin, true)}
          </span>
        ) : <span className="text-slate-300">—</span>}
      </td>

      {/* Margin / feddan */}
      <td className="px-4 py-3">
        {row.margin_per_feddan != null ? (
          <div className="flex items-center gap-1">
            {profitable ? <TrendingUp size={12} className="text-emerald-500" /> : <TrendingDown size={12} className="text-red-400" />}
            <span className={`font-bold text-sm ${profitable ? 'text-emerald-700' : 'text-red-600'}`}>
              {egp(row.margin_per_feddan)}
            </span>
            <span className="text-xs text-slate-400">/ فدان</span>
          </div>
        ) : <span className="text-slate-300">—</span>}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        {!hasRevenue && !hasCost ? (
          <span className="text-xs text-slate-400">—</span>
        ) : !hasRevenue ? (
          <span className="badge-slate text-xs">بدون إيراد</span>
        ) : (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full
            ${profitable ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
            {profitable
              ? <><CheckCircle size={11} /> ربح</>
              : <><AlertTriangle size={11} /> خسارة</>
            }
          </span>
        )}
      </td>
    </tr>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default function SeasonPnLPage() {
  const navigate = useNavigate()
  const [seasonId, setSeasonId] = useState<number | null>(null)

  const { data: seasons = [] } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<Season[]>,
    staleTime: 120_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'season-pnl', seasonId],
    queryFn:  () => reportsApi.seasonPnL(seasonId!),
    enabled:  !!seasonId,
  })

  const revenue    = data?.revenue.contracts_value ?? 0
  const costs      = data?.costs.total ?? 0
  const margin     = data?.net_margin ?? 0
  const totalArea  = data?.total_area ?? 0
  const profitable = margin >= 0
  const glRev      = (data as any)?.gl_actuals?.revenue ?? 0
  const glExp      = (data as any)?.gl_actuals?.expenses ?? 0
  const glNet      = (data as any)?.gl_actuals?.net_income ?? 0
  const hasGlData  = glRev > 0 || glExp > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-xl">
            <Banknote size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="page-title">حساب الأرباح والخسائر</h1>
            <p className="text-sm text-slate-400">إيرادات عقود البيع مقابل تكاليف الموسم الكاملة</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {seasonId && (
            <button
              onClick={() => navigate('/reports/season-readiness')}
              className="flex items-center gap-1.5 btn-secondary text-sm"
            >
              <ShieldCheck size={15} className="text-brand-500" />
              جاهزية الإغلاق
            </button>
          )}
          <select
            className="input w-52 text-sm"
            value={seasonId ?? ''}
            onChange={e => setSeasonId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— اختر الموسم —</option>
            {seasons.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' ✓' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {/* No season selected */}
      {!seasonId && (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Leaf size={32} className="text-emerald-300" />
          </div>
          <p className="text-slate-500 font-medium">اختر موسماً لعرض حساب الأرباح والخسائر</p>
        </div>
      )}

      {isLoading && (
        <div className="card p-8 text-center text-slate-400">جاري الحساب...</div>
      )}

      {data && seasonId && (
        <>
          {/* Season info banner */}
          {data.season && (
            <div className="bg-brand-50 border border-brand-100 rounded-xl px-5 py-3 flex items-center gap-3 text-sm">
              <Leaf size={14} className="text-brand-500 shrink-0" />
              <span className="font-semibold text-brand-700">{data.season.name}</span>
              <span className="text-slate-400">—</span>
              <span className="text-slate-500">
                {new Date(data.season.start_date).toLocaleDateString('en-US')} ←
                {new Date(data.season.end_date).toLocaleDateString('en-US')}
              </span>
              {totalArea > 0 && (
                <span className="mr-auto text-brand-600 font-medium">
                  {num(totalArea)} فدان إجمالي
                </span>
              )}
            </div>
          )}

          {/* Hero KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Revenue */}
            <div className="card p-5 border-r-4 border-emerald-500">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-emerald-500" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">إجمالي الإيرادات</span>
              </div>
              <p className="text-2xl font-bold text-emerald-700">{egp(revenue)}</p>
              <p className="text-xs text-slate-400 mt-1">
                {data.revenue.contracts_count} عقد بيع
                {data.revenue.advance_collected > 0
                  ? ` · محصّل: ${egp(data.revenue.advance_collected)}`
                  : ''}
              </p>
            </div>

            {/* Total Costs */}
            <div className="card p-5 border-r-4 border-red-400">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={16} className="text-red-400" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">إجمالي التكاليف</span>
              </div>
              <p className="text-2xl font-bold text-red-600">{egp(costs)}</p>
              <p className="text-xs text-slate-400 mt-1">
                {revenue > 0 ? `${num((costs / revenue) * 100, 1)}% من الإيراد` : 'لا يوجد إيراد'}
              </p>
            </div>

            {/* Net Margin */}
            <div className={`card p-5 border-r-4 ${profitable ? 'border-brand-500 bg-brand-50' : 'border-red-600 bg-red-50'}`}>
              <div className="flex items-center gap-2 mb-2">
                <Banknote size={16} className={profitable ? 'text-brand-500' : 'text-red-500'} />
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">صافي الربح</span>
              </div>
              <p className={`text-2xl font-bold ${profitable ? 'text-brand-700' : 'text-red-700'}`}>
                {egp(margin, true)}
              </p>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                {data.margin_pct != null && <span>هامش {pct(data.margin_pct)}</span>}
                {data.margin_per_feddan != null && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>{egp(data.margin_per_feddan)} / فدان</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* GL Actuals Panel — shown when GL has data for this season */}
          {hasGlData && (
            <div className={`card overflow-hidden border-2 ${Math.abs(glRev - revenue) > 1000 || revenue === 0 ? 'border-amber-200 bg-amber-50/30' : 'border-emerald-100'}`}>
              <div className="px-5 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen size={15} className="text-indigo-500" />
                  <h2 className="text-sm font-bold text-slate-700">الأرقام المحاسبية الفعلية</h2>
                  <span className="text-[11px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">من دفتر الأستاذ العام</span>
                </div>
                {revenue === 0 && glRev > 0 && (
                  <span className="text-[11px] text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                    <AlertTriangle size={10} /> لا توجد عقود بيع — الإيراد من القيود فقط
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 divide-x divide-slate-100 rtl:divide-x-reverse" dir="rtl">
                <div className="px-5 py-4">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">الإيرادات المرحّلة</p>
                  <p className="text-2xl font-bold text-emerald-700 tabular-nums">{egp(glRev)}</p>
                  {revenue > 0 && Math.abs(glRev - revenue) > 1000 && (
                    <p className="text-[11px] text-amber-600 mt-1">
                      فارق {egp(Math.abs(glRev - revenue))} عن الإيراد التشغيلي
                    </p>
                  )}
                </div>
                <div className="px-5 py-4">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">المصاريف المرحّلة</p>
                  <p className="text-2xl font-bold text-red-600 tabular-nums">{egp(glExp)}</p>
                  {costs > 0 && Math.abs(glExp - costs) > 1000 && (
                    <p className="text-[11px] text-amber-600 mt-1">
                      فارق {egp(Math.abs(glExp - costs))} عن التكاليف التشغيلية
                    </p>
                  )}
                </div>
                <div className={`px-5 py-4 ${glNet >= 0 ? 'bg-emerald-50/40' : 'bg-red-50/40'}`}>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">صافي الدخل المحاسبي</p>
                  <p className={`text-2xl font-bold tabular-nums ${glNet >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {egp(glNet, true)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {glRev > 0 ? `هامش ${pct((glNet / glRev) * 100)}` : '—'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* P&L Waterfall Statement */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
              <ArrowRight size={15} className="text-slate-400" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">بيان الأرباح والخسائر التشغيلي</h2>
            </div>

            {/* Revenue line */}
            <WaterfallRow
              icon={<TrendingUp size={16} />}
              label="إيرادات عقود البيع"
              sub={`${data.revenue.contracts_count} عقد بيع مُسجَّل`}
              value={revenue}
              variant="revenue"
            />

            {/* Cost lines */}
            <WaterfallRow
              icon={<Package size={16} className="text-violet-500" />}
              label="تكلفة المدخلات المُصرفة"
              sub="مخزون صرف مرتبط بالموسم"
              value={data.costs.inventory}
              variant="cost"
              pctOfRev={revenue > 0 ? (data.costs.inventory / revenue) * 100 : undefined}
            />
            <WaterfallRow
              icon={<Wrench size={16} className="text-blue-500" />}
              label="تكلفة العمالة الزراعية"
              sub="مهام أوامر العمل"
              value={data.costs.labor}
              variant="cost"
              pctOfRev={revenue > 0 ? (data.costs.labor / revenue) * 100 : undefined}
            />
            <WaterfallRow
              icon={<Banknote size={16} className="text-sky-500" />}
              label="المصروفات النقدية"
              sub="حركات الخزينة (منصرف)"
              value={data.costs.cash_out}
              variant="cost"
              pctOfRev={revenue > 0 ? (data.costs.cash_out / revenue) * 100 : undefined}
            />
            <WaterfallRow
              icon={<Users size={16} className="text-amber-500" />}
              label="مستحقات الموردين"
              sub="ذمم مدينة (مشتريات بالآجل)"
              value={data.costs.supplier_credit}
              variant="cost"
              pctOfRev={revenue > 0 ? (data.costs.supplier_credit / revenue) * 100 : undefined}
            />
            {(data.costs.land_rent ?? 0) > 0 && (
              <WaterfallRow
                icon={<Home size={16} className="text-teal-500" />}
                label="إيجار الأراضي"
                sub="إيجار × مساحة الحقول"
                value={data.costs.land_rent}
                variant="cost"
                pctOfRev={revenue > 0 ? (data.costs.land_rent / revenue) * 100 : undefined}
              />
            )}
            {(data.costs.payroll ?? 0) > 0 && (
              <WaterfallRow
                icon={<DollarSign size={16} className="text-green-500" />}
                label="رواتب الموظفين"
                sub="مسيرات رواتب مُسندة لهذا الموسم"
                value={data.costs.payroll}
                variant="cost"
                pctOfRev={revenue > 0 ? (data.costs.payroll / revenue) * 100 : undefined}
              />
            )}

            {/* Subtotal costs */}
            <WaterfallRow
              icon={<TrendingDown size={16} />}
              label="إجمالي التكاليف"
              value={costs}
              variant="subtotal"
            />

            {/* Net margin */}
            <WaterfallRow
              icon={profitable ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
              label={profitable ? 'صافي الربح' : 'صافي الخسارة'}
              sub={data.margin_per_feddan != null
                ? `${egp(data.margin_per_feddan)} / فدان • هامش ${pct(data.margin_pct)}`
                : undefined}
              value={margin}
              variant="total"
            />
          </div>

          {/* Per-field P&L table */}
          {data.by_field.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                <Leaf size={15} className="text-brand-500" />
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">ربحية الحقول</h2>
                <span className="text-xs text-slate-400 mr-1">{data.by_field.length} حقل</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['الحقل', 'المساحة', 'الإيراد', 'التكلفة', 'الهامش', 'هامش / فدان', 'النتيجة'].map(h => (
                      <th key={h}
                        className="px-4 py-3 text-xs font-semibold text-slate-500 text-right whitespace-nowrap uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.by_field.map(row => (
                    <FieldPnLRow key={row.id} row={row} />
                  ))}
                </tbody>
                {data.by_field.length > 1 && (
                  <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                    <tr>
                      <td className="px-4 py-3 font-bold text-slate-700">الإجمالي</td>
                      <td className="px-4 py-3 text-slate-600 text-sm">{num(totalArea)} فدان</td>
                      <td className="px-4 py-3 font-bold text-emerald-700">{egp(revenue)}</td>
                      <td className="px-4 py-3 font-bold text-red-600">{egp(costs)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-bold ${profitable ? 'text-emerald-700' : 'text-red-700'}`}>
                          {egp(margin, true)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {data.margin_per_feddan != null && (
                          <span className={`font-bold text-sm ${profitable ? 'text-emerald-700' : 'text-red-600'}`}>
                            {egp(data.margin_per_feddan)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full
                          ${profitable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {profitable ? <><CheckCircle size={11} /> ربح</> : <><AlertTriangle size={11} /> خسارة</>}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
