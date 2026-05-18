import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2,
  Leaf, ChevronLeft, Wrench, DollarSign, Users,
  Wheat, FileText, RefreshCw, ShieldCheck,
} from 'lucide-react'
import { reportsApi, configApi } from '../../api/client'
import type { Season } from '../../types'
import { CommandBar } from '../../components/ui/CommandBar'
import { FilterBar } from '../../components/ui/FilterBar'

// ─── Score ring ───────────────────────────────────────────────
function ScoreRing({ score, ready }: { score: number; ready: boolean }) {
  const r = 36
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ

  return (
    <div className="relative inline-flex items-center justify-center w-24 h-24">
      <svg width="96" height="96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} strokeWidth="8"
          className="fill-none stroke-slate-100" />
        <circle cx="48" cy="48" r={r} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          className={`fill-none transition-all duration-700 ${ready ? 'stroke-emerald-500' : score > 50 ? 'stroke-amber-400' : 'stroke-red-500'}`}
        />
      </svg>
      <span className={`absolute text-xl font-black tabular-nums
        ${ready ? 'text-emerald-600' : score > 50 ? 'text-amber-600' : 'text-red-600'}`}>
        {score}%
      </span>
    </div>
  )
}

// ─── Check icons by key ───────────────────────────────────────
const CHECK_ICONS: Record<string, React.ReactNode> = {
  open_work_orders:     <Wrench    size={18} />,
  draft_payroll:        <DollarSign size={18} />,
  draft_supplier_tx:    <Users     size={18} />,
  uncosted_harvests:    <Wheat     size={18} />,
  fields_without_harvest: <Leaf   size={18} />,
  active_contracts:     <FileText  size={18} />,
}

const CHECK_COLORS: Record<string, { ok: string; fail: string; icon: string }> = {
  open_work_orders:      { ok: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200',    icon: 'bg-amber-100 text-amber-600' },
  draft_payroll:         { ok: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200',    icon: 'bg-green-100 text-green-600' },
  draft_supplier_tx:     { ok: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200',    icon: 'bg-purple-100 text-purple-600' },
  uncosted_harvests:     { ok: 'bg-emerald-50 border-emerald-200', fail: 'bg-amber-50 border-amber-200', icon: 'bg-yellow-100 text-yellow-600' },
  fields_without_harvest:{ ok: 'bg-emerald-50 border-emerald-200', fail: 'bg-amber-50 border-amber-200', icon: 'bg-lime-100 text-lime-600' },
  active_contracts:      { ok: 'bg-emerald-50 border-emerald-200', fail: 'bg-amber-50 border-amber-200', icon: 'bg-rose-100 text-rose-600' },
}

// ─── Check row ────────────────────────────────────────────────
interface CheckItem {
  key: string; label: string; description: string
  count: number; ok: boolean; blocker: boolean; action_url: string
}

function CheckRow({ item }: { item: CheckItem }) {
  const navigate = useNavigate()
  const colors = CHECK_COLORS[item.key] ?? { ok: 'bg-emerald-50 border-emerald-200', fail: 'bg-amber-50 border-amber-200', icon: 'bg-slate-100 text-slate-500' }
  const card  = item.ok ? colors.ok : colors.fail

  return (
    <div className={`flex items-start gap-4 px-5 py-4 border rounded-xl ${card} transition-all`}>
      {/* Icon */}
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${colors.icon}`}>
        {CHECK_ICONS[item.key] ?? <ShieldCheck size={18} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-slate-800 text-sm">{item.label}</p>
          {item.blocker && !item.ok && (
            <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded uppercase tracking-wide">
              عائق
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.description}</p>
        {!item.ok && item.count > 0 && (
          <p className={`text-xs font-semibold mt-1 ${item.blocker ? 'text-red-600' : 'text-amber-600'}`}>
            {item.count} {item.blocker ? 'يستلزم معالجة' : 'تحتاج مراجعة'}
          </p>
        )}
      </div>

      {/* Status + Action */}
      <div className="flex items-center gap-3 shrink-0">
        {item.ok ? (
          <CheckCircle2 size={22} className="text-emerald-500" />
        ) : item.blocker ? (
          <XCircle size={22} className="text-red-500" />
        ) : (
          <AlertTriangle size={22} className="text-amber-400" />
        )}
        {!item.ok && (
          <button
            onClick={() => navigate(item.action_url)}
            className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 bg-white border border-brand-200 hover:border-brand-400 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap"
          >
            معالجة
            <ChevronLeft size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────
export default function SeasonReadinessPage() {
  const navigate = useNavigate()
  const [seasonId, setSeasonId] = useState<number | null>(null)

  const { data: seasons = [] } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<Season[]>,
    staleTime: 120_000,
  })

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['reports', 'season-readiness', seasonId],
    queryFn:  () => reportsApi.seasonReadiness(seasonId!),
    enabled:  !!seasonId,
    staleTime: 30_000,
  })

  const summary  = data?.summary
  const checks   = data?.checks ?? []
  const blockers = checks.filter(ch => ch.blocker && !ch.ok)
  const warnings = checks.filter(ch => !ch.blocker && !ch.ok)
  const passing  = checks.filter(ch => ch.ok)

  return (
    <div className="flex flex-col h-full">
      <CommandBar
        title="جاهزية إغلاق الموسم"
        subtitle="قائمة مراجعة قبل إغلاق حسابات الموسم"
        actions={seasonId ? [{
          label: 'تحديث',
          icon: <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />,
          variant: 'secondary',
          onClick: () => refetch(),
          disabled: isFetching,
        }] : []}
      />

      <FilterBar>
        <select
          className="input w-52 text-sm"
          value={seasonId ?? ''}
          onChange={e => setSeasonId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— اختر الموسم —</option>
          {seasons.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </FilterBar>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-3xl mx-auto w-full">

      {/* ── Empty state ──────────────────────────────────────── */}
      {!seasonId && (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={32} className="text-brand-300" />
          </div>
          <p className="text-slate-500 font-medium">اختر موسماً لعرض قائمة المراجعة</p>
          <p className="text-xs text-slate-400 mt-1">ستظهر قائمة فحص شاملة قبل إغلاق الموسم</p>
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────── */}
      {isLoading && (
        <div className="card p-12 flex flex-col items-center gap-3 text-slate-400">
          <Loader2 size={28} className="animate-spin text-brand-400" />
          <p className="text-sm">جاري فحص البيانات...</p>
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────── */}
      {data && summary && (
        <>
          {/* Hero banner */}
          <div className={`card p-6 flex flex-col sm:flex-row items-center gap-6 border-2
            ${summary.ready
              ? 'bg-emerald-50 border-emerald-300'
              : 'bg-red-50 border-red-300'}`}
          >
            <ScoreRing score={summary.score} ready={summary.ready} />

            <div className="flex-1 text-center sm:text-right">
              <div className="flex items-center gap-2 justify-center sm:justify-start mb-1">
                {summary.ready
                  ? <CheckCircle2 size={22} className="text-emerald-500" />
                  : <XCircle      size={22} className="text-red-500" />
                }
                <h2 className={`text-xl font-black ${summary.ready ? 'text-emerald-700' : 'text-red-700'}`}>
                  {summary.ready ? 'الموسم جاهز للإغلاق' : 'الموسم غير جاهز للإغلاق'}
                </h2>
              </div>
              <p className="text-sm text-slate-500">
                {data.season.name} · {new Date(data.season.start_date).toLocaleDateString('en-US')} — {new Date(data.season.end_date).toLocaleDateString('en-US')}
              </p>
              {!summary.ready && (
                <p className="text-xs text-red-600 mt-2 font-medium">
                  يوجد {summary.blockers_failed} عائق يجب معالجته قبل الإغلاق
                </p>
              )}
            </div>

            {/* Mini KPIs */}
            <div className="flex gap-4 sm:gap-6 shrink-0">
              <div className="text-center">
                <p className="text-2xl font-black text-red-600">{summary.blockers_failed}</p>
                <p className="text-xs text-slate-500 mt-0.5">عوائق</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-amber-500">{summary.warnings_failed}</p>
                <p className="text-xs text-slate-500 mt-0.5">تحذيرات</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black text-emerald-600">{summary.passing}</p>
                <p className="text-xs text-slate-500 mt-0.5">ناجح</p>
              </div>
            </div>
          </div>

          {/* Season context chips */}
          <div className="flex flex-wrap gap-2">
            {[
              { label: `${summary.total_fields} حقل`, bg: 'bg-lime-50 text-lime-700 border-lime-200' },
              { label: `${summary.total_harvests} سجل حصاد`, bg: 'bg-amber-50 text-amber-700 border-amber-200' },
            ].map(chip => (
              <span key={chip.label} className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${chip.bg}`}>
                {chip.label}
              </span>
            ))}
            <button
              onClick={() => navigate(`/reports/season-pnl`)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100 transition-colors"
            >
              عرض حساب الأرباح والخسائر ←
            </button>
          </div>

          {/* BLOCKERS */}
          {blockers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <XCircle size={16} className="text-red-500" />
                <h3 className="text-sm font-bold text-red-700 uppercase tracking-wide">
                  عوائق — يجب معالجتها ({blockers.length})
                </h3>
              </div>
              {blockers.map(item => <CheckRow key={item.key} item={item} />)}
            </div>
          )}

          {/* WARNINGS */}
          {warnings.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500" />
                <h3 className="text-sm font-bold text-amber-700 uppercase tracking-wide">
                  تحذيرات — يُنصح بمراجعتها ({warnings.length})
                </h3>
              </div>
              {warnings.map(item => <CheckRow key={item.key} item={item} />)}
            </div>
          )}

          {/* PASSING */}
          {passing.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <h3 className="text-sm font-bold text-emerald-700 uppercase tracking-wide">
                  ناجحة ({passing.length})
                </h3>
              </div>
              {passing.map(item => <CheckRow key={item.key} item={item} />)}
            </div>
          )}

          {/* Close season CTA */}
          {summary.ready && (
            <div className="card p-6 bg-emerald-50 border-2 border-emerald-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={28} className="text-emerald-500 shrink-0" />
                <div>
                  <p className="font-bold text-emerald-800">كل الفحوصات ناجحة — يمكن إغلاق الموسم</p>
                  <p className="text-xs text-emerald-600 mt-0.5">اذهب إلى صفحة الإغلاق لتأكيد العملية</p>
                </div>
              </div>
              <button
                onClick={() => navigate('/reports/season-close')}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-colors shrink-0"
              >
                إغلاق الموسم
                <ChevronLeft size={16} />
              </button>
            </div>
          )}
        </>
      )}
      </div>{/* end scroll container */}
    </div>
  )
}
