import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Lock,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Shield,
  Unlock,
  User,
  XCircle,
  ArrowRightLeft,
} from 'lucide-react'
import { glApi, configApi } from '../../api/client'
import type { FinancialPeriod, PeriodCloseChecklistStep } from '../../api/gl'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import SectionCard from '../../components/ui/SectionCard'
import StatusBadge from '../../components/ui/StatusBadge'
import Modal from '../../components/ui/Modal'

const STEP_OWNER: Record<string, string> = {
  inventory_gl: 'Inventory + GL Team',
  unposted_entries: 'General Ledger Team',
  balance_check: 'Chief Accountant',
  orphan_entries: 'GL Data Governance',
  period_summary: 'Finance Controller',
}

// Improvement 1: inventory_gl step links to TransactionHistoryPage pre-filtered by period dates
function mapStepAction(stepKey: string, period?: { start_date: string; end_date: string }): { to?: string; label?: string; secondaryTo?: string; secondaryLabel?: string } {
  if (stepKey === 'inventory_gl') {
    const txUrl = period
      ? `/inventory/transactions?start=${period.start_date}&end=${period.end_date}`
      : '/inventory/transactions'
    return {
      to: '/gl/batch-posting', label: 'Resolve in Batch Posting',
      secondaryTo: txUrl, secondaryLabel: 'View Transactions',
    }
  }
  if (stepKey === 'unposted_entries') return { to: '/gl/entries', label: 'Open Journal Entries' }
  if (stepKey === 'balance_check') return { to: '/gl/health-integrity', label: 'Open Integrity Issues' }
  if (stepKey === 'orphan_entries') return { to: '/gl/health-integrity', label: 'Open Integrity Issues' }
  return {}
}

function stepStatusIcon(status: PeriodCloseChecklistStep['status'], critical: boolean) {
  if (status === 'passed') return <CheckCircle2 size={16} className="text-emerald-600" />
  if (status === 'failed') return <XCircle size={16} className="text-red-500" />
  if (status === 'warning') return <AlertTriangle size={16} className="text-amber-500" />
  if (status === 'running') return <Loader2 size={16} className="text-slate-500 animate-spin" />
  return (
    <div
      className={`w-4 h-4 rounded-full border-2 ${critical ? 'border-red-300' : 'border-slate-300'}`}
      title="Pending"
    />
  )
}

function statusTone(status: PeriodCloseChecklistStep['status'], critical: boolean) {
  if (status === 'passed') return 'bg-emerald-50/70 border-emerald-200'
  if (status === 'failed') return 'bg-red-50/80 border-red-200'
  if (status === 'warning') return 'bg-amber-50/80 border-amber-200'
  if (status === 'running') return 'bg-slate-50 border-slate-200'
  return critical ? 'bg-red-50/40 border-red-150' : 'bg-slate-50 border-slate-200'
}

function PeriodCard({
  period,
  selected,
  onSelect,
  onClose,
  onReopen,
  closing,
  reopening,
}: {
  period: FinancialPeriod
  selected: boolean
  onSelect: () => void
  onClose: () => void
  onReopen: () => void
  closing: boolean
  reopening: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 transition-all cursor-pointer ${
        selected
          ? 'border-[#0F2D5C] bg-blue-50/50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          {period.is_closed ? (
            <Lock size={16} className="text-red-400 mt-0.5" />
          ) : (
            <Unlock size={16} className="text-emerald-600 mt-0.5" />
          )}
          <div>
            <p className="text-[14px] font-bold text-[#0F2D5C]">{period.name}</p>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              {period.start_date} - {period.end_date}
            </p>
            {period.closed_at ? (
              <p className="text-[10px] text-slate-400 mt-1">Closed {period.closed_at.slice(0, 10)}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge variant={period.is_closed ? 'voided' : 'active'} label={period.is_closed ? 'Closed' : 'Open'} />
          {period.is_closed ? (
            <button
              className="btn-secondary text-[11px] py-1 px-3 flex items-center gap-1"
              onClick={(e) => {
                e.stopPropagation()
                onReopen()
              }}
              disabled={reopening}
            >
              {reopening ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
              Reopen
            </button>
          ) : (
            <button
              className="btn-primary text-[11px] py-1 px-3 flex items-center gap-1 bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              disabled={closing}
            >
              {closing ? <Loader2 size={11} className="animate-spin" /> : <Lock size={11} />}
              Close
            </button>
          )}
          <ChevronRight size={14} className={`text-slate-400 transition-transform ${selected ? 'rotate-90' : ''}`} />
        </div>
      </div>
    </div>
  )
}

function ReadinessPanel({
  period,
  checks,
  onRunAll,
  onRunOne,
  runningAll,
  runningStep,
}: {
  period: FinancialPeriod
  checks: PeriodCloseChecklistStep[]
  onRunAll: () => void
  onRunOne: (stepKey: string) => void
  runningAll: boolean
  runningStep: string | null
}) {
  const total = checks.length
  const passed = checks.filter((c) => c.status === 'passed').length
  const criticalFailures = checks.filter((c) => c.is_critical && c.status === 'failed').length
  const progress = total === 0 ? 0 : Math.round((passed / total) * 100)

  return (
    <SectionCard
      title={`Period Close Command Center - ${period.name}`}
      subtitle={`${passed}/${total} passed - ${criticalFailures} critical blocker(s)`}
      icon={<Shield size={14} />}
    >
      <div className="rounded-lg border border-slate-200 p-4 bg-slate-50 mb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[12px] font-semibold text-slate-700">Close Progress</p>
          <p className="text-[12px] text-slate-500">{progress}%</p>
        </div>
        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${criticalFailures > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button className="btn-primary text-[12px] flex items-center gap-1" onClick={onRunAll} disabled={runningAll}>
          {runningAll ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
          Run All Checks
        </button>
        <p className="text-[11px] text-slate-500">Sequence: Inventory {'->'} Journal {'->'} Balance {'->'} Mapping {'->'} Summary</p>
      </div>

      <div className="space-y-2">
        {checks.map((step) => {
          const action = mapStepAction(step.step_key, period)
          const isRunOneBusy = runningStep === step.step_key
          return (
            <div key={step.step_key} className={`rounded-lg border p-3 ${statusTone(step.status, step.is_critical)}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{stepStatusIcon(step.status, step.is_critical)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-slate-700">{step.step_order}. {step.step_label}</p>
                    {step.is_critical && step.status !== 'passed' ? (
                      <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded uppercase tracking-wide">Blocker</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <User size={11} /> Owner: {STEP_OWNER[step.step_key] ?? 'Finance Team'}
                    </p>
                    <p className="text-[11px] text-slate-500">Status: {step.status}</p>
                    <p className="text-[11px] text-slate-500">Count: {step.count_blocked}</p>
                  </div>
                  {step.details ? (
                    <p className="text-[11px] mt-1 text-slate-700">{step.details}</p>
                  ) : null}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    className="btn-secondary text-[11px] py-1 px-2"
                    onClick={() => onRunOne(step.step_key)}
                    disabled={isRunOneBusy || runningAll}
                    title="Re-run this step"
                  >
                    {isRunOneBusy ? <Loader2 size={11} className="animate-spin" /> : 'Run'}
                  </button>
                  {action.to && (step.status === 'failed' || step.status === 'warning') ? (
                    <Link to={action.to} className="text-[11px] text-[#0F2D5C] underline hover:opacity-80 whitespace-nowrap">
                      {action.label ?? 'Investigate'}
                    </Link>
                  ) : null}
                  {action.secondaryTo && (step.status === 'failed' || step.status === 'warning') ? (
                    <Link to={action.secondaryTo} className="text-[11px] text-slate-500 underline hover:opacity-80 whitespace-nowrap">
                      {action.secondaryLabel}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

export default function PeriodCloseCockpit() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [confirmClose, setConfirmClose] = useState<FinancialPeriod | null>(null)
  const [confirmForceClose, setConfirmForceClose] = useState<FinancialPeriod | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showWipFlush, setShowWipFlush] = useState(false)
  const [wipSeasonId, setWipSeasonId] = useState('')
  const [runningStep, setRunningStep] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', period_type: 'monthly', start_date: '', end_date: '' })

  const { data: periods = [], isLoading: periodsLoading, refetch: refetchPeriods } = useQuery({
    queryKey: ['gl-periods'],
    queryFn: () => glApi.periods(),
  })

  const selectedPeriod = useMemo(() => {
    return periods.find((p) => p.id === selectedId) ?? periods.find((p) => !p.is_closed) ?? null
  }, [periods, selectedId])

  const { data: checklistData, refetch: refetchChecklist, isFetching: checklistLoading } = useQuery({
    queryKey: ['gl-period-checklist', selectedPeriod?.id],
    queryFn: () => glApi.periodChecklist(selectedPeriod!.id),
    enabled: !!selectedPeriod,
  })

  const checks = checklistData?.checks ?? []
  const allCriticalPassed = checklistData?.all_critical_passed ?? false

  const createMut = useMutation({
    mutationFn: () => glApi.createPeriod(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-periods'] })
      setShowAdd(false)
      setForm({ name: '', period_type: 'monthly', start_date: '', end_date: '' })
    },
  })

  const runAllMut = useMutation({
    mutationFn: (id: number) => glApi.runPeriodChecklist(id),
    onSuccess: () => {
      refetchChecklist()
      qc.invalidateQueries({ queryKey: ['gl-periods'] })
    },
  })

  const runStepMut = useMutation({
    mutationFn: ({ id, stepKey }: { id: number; stepKey: string }) => glApi.runPeriodChecklistStep(id, stepKey),
    onSuccess: () => {
      setRunningStep(null)
      refetchChecklist()
    },
    onError: () => setRunningStep(null),
  })

  const closeMut = useMutation({
    mutationFn: (id: number) => glApi.closePeriod(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-periods'] })
      refetchChecklist()
      setConfirmClose(null)
    },
  })

  const forceCloseMut = useMutation({
    mutationFn: (id: number) => glApi.closePeriodForce(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-periods'] })
      refetchChecklist()
      setConfirmForceClose(null)
    },
  })

  const reopenMut = useMutation({
    mutationFn: (id: number) => glApi.reopenPeriod(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-periods'] })
      refetchChecklist()
    },
  })

  const { data: seasons = [] } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
  })

  const wipFlushMut = useMutation({
    mutationFn: ({ id, season_id }: { id: number; season_id: number }) =>
      glApi.wipFlush(id, { season_id }),
    onSuccess: () => {
      setShowWipFlush(false)
      setWipSeasonId('')
      qc.invalidateQueries({ queryKey: ['gl-entries'] })
    },
  })

  function refreshAll() {
    refetchPeriods()
    refetchChecklist()
  }

  function prefillCurrentMonth() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate()
    const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    setForm({
      name: `${names[now.getMonth() + 1]} ${y}`,
      period_type: 'monthly',
      start_date: `${y}-${m}-01`,
      end_date: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
    })
  }

  const open = periods.filter((p) => !p.is_closed)
  const closed = periods.filter((p) => p.is_closed)

  const passed = checks.filter((c) => c.status === 'passed').length
  const completionPct = checks.length === 0 ? 0 : Math.round((passed / checks.length) * 100)

  const kpis: KpiItem[] = [
    { id: 'open', label: 'OPEN PERIODS', value: open.length, variant: open.length === 1 ? 'success' : 'warning' },
    { id: 'closed', label: 'CLOSED PERIODS', value: closed.length },
    { id: 'steps', label: 'CHECKS PASSED', value: `${passed}/${checks.length || 5}`, variant: allCriticalPassed ? 'success' : 'warning' },
    { id: 'progress', label: 'COMPLETION', value: `${completionPct}%`, variant: completionPct === 100 ? 'success' : 'warning' },
  ]

  const actions: CommandAction[] = [
    {
      id: 'refresh',
      label: 'Refresh',
      icon: <RefreshCw size={14} />,
      onClick: refreshAll,
      variant: 'secondary',
    },
    {
      id: 'run-checks',
      label: 'Run Close Checks',
      icon: <PlayCircle size={14} />,
      onClick: () => selectedPeriod && runAllMut.mutate(selectedPeriod.id),
      disabled: !selectedPeriod || !!selectedPeriod.is_closed || runAllMut.isPending,
      variant: 'primary',
    },
    {
      id: 'wip-flush',
      label: 'Flush WIP → COGS',
      icon: <ArrowRightLeft size={14} />,
      onClick: () => setShowWipFlush(true),
      disabled: !selectedPeriod || !!selectedPeriod.is_closed,
      variant: 'secondary',
    },
    {
      id: 'new',
      label: 'New Period',
      icon: <CalendarDays size={14} />,
      onClick: () => {
        setShowAdd(true)
        prefillCurrentMonth()
      },
      variant: 'secondary',
    },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">Financial Period Close Command Center</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">
          One-open-period policy with guided checklist, strict close controls, and exception-based reopen.
        </p>
      </div>

      <CommandBar actions={actions} />
      <KpiStrip items={kpis} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 xl:grid-cols-[390px_1fr] gap-6">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-[12px] text-slate-600">
              <p className="font-semibold text-slate-700 mb-1">Policy</p>
              <p>
                System currently enforces exactly one open financial period while close workflows are being hardened.
              </p>
            </div>

            {open.length === 0 && !periodsLoading ? (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded p-3">
                <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                <p className="text-[12px] font-medium text-amber-800">No open period detected. Posting may be blocked.</p>
              </div>
            ) : null}

            {open.length > 0 ? (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Unlock size={10} className="text-emerald-600" /> Open ({open.length})
                </p>
                <div className="space-y-2">
                  {open.map((p) => (
                    <PeriodCard
                      key={p.id}
                      period={p}
                      selected={selectedPeriod?.id === p.id}
                      onSelect={() => setSelectedId(p.id)}
                      onClose={() => setConfirmClose(p)}
                      onReopen={() => {}}
                      closing={closeMut.isPending && confirmClose?.id === p.id}
                      reopening={false}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {closed.length > 0 ? (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Lock size={10} className="text-red-400" /> Closed ({closed.length})
                </p>
                <div className="space-y-2">
                  {closed.slice(0, 6).map((p) => (
                    <PeriodCard
                      key={p.id}
                      period={p}
                      selected={selectedPeriod?.id === p.id}
                      onSelect={() => setSelectedId(p.id)}
                      onClose={() => {}}
                      onReopen={() => reopenMut.mutate(p.id)}
                      closing={false}
                      reopening={reopenMut.isPending}
                    />
                  ))}
                  {closed.length > 6 ? (
                    <p className="text-[11px] text-slate-400 text-center pt-1">+ {closed.length - 6} more closed periods</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div>
            {selectedPeriod && !selectedPeriod.is_closed ? (
              <ReadinessPanel
                period={selectedPeriod}
                checks={checks}
                onRunAll={() => runAllMut.mutate(selectedPeriod.id)}
                onRunOne={(stepKey) => {
                  setRunningStep(stepKey)
                  runStepMut.mutate({ id: selectedPeriod.id, stepKey })
                }}
                runningAll={runAllMut.isPending || checklistLoading}
                runningStep={runningStep}
              />
            ) : selectedPeriod && selectedPeriod.is_closed ? (
              <SectionCard title={`${selectedPeriod.name} - Closed`} subtitle="Period is currently locked" icon={<Lock size={14} className="text-red-400" />}>
                <div className="space-y-3 text-[13px] text-slate-600">
                  <p>
                    Closed on <strong>{selectedPeriod.closed_at?.slice(0, 10) ?? 'unknown date'}</strong>.
                  </p>
                  <p>
                    Reopening is allowed only as an exception and with elevated permissions.
                  </p>
                </div>
              </SectionCard>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-slate-200 bg-white text-center px-6">
                <Shield size={40} className="text-slate-300 mb-3" />
                <p className="text-[14px] font-semibold text-slate-500">Select an open period to run close workflow checks.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmClose ? (
        <Modal open={!!confirmClose} onClose={() => setConfirmClose(null)} title="Confirm Period Close" size="md">
          <div className="space-y-4 text-[13px]">
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded p-4">
              <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-800">Closing will lock transactions in this date range.</p>
                <p className="text-[12px] text-red-700 mt-1">
                  {confirmClose.start_date} - {confirmClose.end_date}
                </p>
              </div>
            </div>
            {!allCriticalPassed ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-800">
                Critical checklist items are not fully passed. Use force close only for emergency with admin approval.
              </div>
            ) : null}
          </div>
          <div className="flex justify-between items-center mt-6 gap-3">
            <button className="btn-secondary" onClick={() => setConfirmClose(null)}>Cancel</button>
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary"
                onClick={() => {
                  setConfirmClose(null)
                  setConfirmForceClose(confirmClose)
                }}
              >
                Force Close
              </button>
              <button
                className="btn-primary bg-red-600 hover:bg-red-700 flex items-center gap-2"
                onClick={() => closeMut.mutate(confirmClose.id)}
                disabled={closeMut.isPending || !allCriticalPassed}
              >
                {closeMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                Close Period
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {confirmForceClose ? (
        <Modal open={!!confirmForceClose} onClose={() => setConfirmForceClose(null)} title="Force Close (Admin Override)" size="md">
          <div className="space-y-3 text-[13px]">
            <div className="rounded border border-red-200 bg-red-50 p-3 text-red-800">
              This bypasses critical checklist blockers and should be used only under strict exception handling.
            </div>
            <p>
              Period: <strong>{confirmForceClose.name}</strong>
            </p>
            <p className="text-[12px] text-slate-600">Action will call close with force=1 and remain fully auditable.</p>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button className="btn-secondary" onClick={() => setConfirmForceClose(null)}>Cancel</button>
            <button
              className="btn-primary bg-red-700 hover:bg-red-800 flex items-center gap-2"
              onClick={() => forceCloseMut.mutate(confirmForceClose.id)}
              disabled={forceCloseMut.isPending}
            >
              {forceCloseMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
              Force Close
            </button>
          </div>
        </Modal>
      ) : null}

      {/* WIP → COGS Flush Modal */}
      <Modal open={showWipFlush} onClose={() => setShowWipFlush(false)} title="تسوية WIP → تكلفة البضاعة المباعة" size="md">
        <div className="space-y-4 text-[13px]">
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-amber-800">
            <p className="font-semibold mb-1">ما هذه العملية؟</p>
            <p className="text-[12px]">
              تُنشئ هذه العملية قيداً محاسبياً يُحوّل رصيد حساب الإنتاج الجاري (WIP) إلى حساب تكلفة البضاعة المباعة (COGS)
              عند نهاية الموسم. القيد: مدين COGS / دائن WIP.
            </p>
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">الموسم *</label>
            <select
              className="input"
              value={wipSeasonId}
              onChange={e => setWipSeasonId(e.target.value)}
            >
              <option value="">-- اختر الموسم --</option>
              {(seasons as Array<{ id: number; name: string }>).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {selectedPeriod && (
            <p className="text-[12px] text-slate-500">
              سيُرحَّل القيد في الفترة: <strong>{selectedPeriod.name}</strong> بتاريخ نهايتها ({selectedPeriod.end_date})
            </p>
          )}
          {wipFlushMut.isError && (
            <p className="text-[12px] text-red-600">
              {(wipFlushMut.error as { message?: string })?.message ?? 'حدث خطأ'}
            </p>
          )}
          {wipFlushMut.isSuccess && (
            <div className="text-[12px] text-emerald-700 space-y-0.5">
              <p className="font-semibold">تمت التسوية بنجاح</p>
              <p>رقم القيد: <strong>#{wipFlushMut.data?.entry_id}</strong> · المبلغ: {wipFlushMut.data?.amount?.toLocaleString('ar-EG')} ج.م</p>
              <p className="text-gray-500 font-mono text-[11px]">
                DR {wipFlushMut.data?.cogs_account} / CR {wipFlushMut.data?.wip_account}
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={() => setShowWipFlush(false)}>إلغاء</button>
          <button
            className="btn-primary flex items-center gap-2"
            disabled={!wipSeasonId || wipFlushMut.isPending || !selectedPeriod}
            onClick={() => selectedPeriod && wipFlushMut.mutate({
              id: selectedPeriod.id,
              season_id: Number(wipSeasonId),
            })}
          >
            {wipFlushMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
            تنفيذ التسوية
          </button>
        </div>
      </Modal>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Financial Period" size="md">
        <div className="space-y-4 text-[13px]">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Period Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Period Type</label>
            <select className="input" value={form.period_type} onChange={(e) => setForm((f) => ({ ...f, period_type: e.target.value }))}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Start Date</label>
              <input type="date" className="input" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-slate-600 font-semibold mb-1">End Date</label>
              <input type="date" className="input" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => createMut.mutate()}
            disabled={!form.name || !form.start_date || !form.end_date || createMut.isPending}
          >
            {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Create Period
          </button>
        </div>
      </Modal>
    </div>
  )
}
