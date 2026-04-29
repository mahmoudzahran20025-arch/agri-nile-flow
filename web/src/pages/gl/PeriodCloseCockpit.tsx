/**
 * PeriodCloseCockpit — FIN-EPIC-06
 * Pre-close readiness checklist + period close/reopen controls.
 * Runs integrity check, reconciliation summary, and unposted entries
 * before allowing a period to be closed.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Lock, Unlock, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  ChevronRight, Loader2, Shield, CalendarDays,
} from 'lucide-react'
import { glApi } from '../../api/client'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import { CommandBar, type CommandAction } from '../../components/shell/CommandBar'
import Modal from '../../components/ui/Modal'
import StatusBadge from '../../components/ui/StatusBadge'
import { useGlSystemIntegrityScore, useGlIntegrityIssues } from '../../hooks/useGlFinance'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FinancialPeriod {
  id: number; company_id: number
  name: string; period_type: string
  start_date: string; end_date: string
  is_closed: number; closed_at?: string; closed_by?: number
  created_at: string
}

interface ReadinessCheck {
  id: string
  label: string
  description: string
  isCritical: boolean
  isPassed: boolean | null   // null = loading
  detail?: string
  actionTo?: string
  actionLabel?: string
}

// ── Helper ────────────────────────────────────────────────────────────────────

function statusIcon(pass: boolean | null, critical: boolean) {
  if (pass === null)  return <div className="w-4 h-4 rounded-full border-2 border-slate-300 animate-pulse" />
  if (pass)           return <CheckCircle2 size={16} className="text-[#1D9E75]" />
  if (critical)       return <XCircle      size={16} className="text-red-500" />
  return                     <AlertTriangle size={16} className="text-amber-500" />
}

// ── Period Row ────────────────────────────────────────────────────────────────

function PeriodCard({
  period,
  onClose,
  onReopen,
  isSelected,
  onSelect,
  closing,
  reopening,
}: {
  period: FinancialPeriod
  onClose: () => void
  onReopen: () => void
  isSelected: boolean
  onSelect: () => void
  closing: boolean
  reopening: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 cursor-pointer transition-all ${
        isSelected
          ? 'border-[#0F2D5C] bg-blue-50/50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            {period.is_closed
              ? <Lock size={16} className="text-red-400" />
              : <Unlock size={16} className="text-[#1D9E75]" />
            }
          </div>
          <div>
            <p className="text-[14px] font-bold text-[#0F2D5C]">{period.name}</p>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              {period.start_date} → {period.end_date}
            </p>
            {period.is_closed && period.closed_at && (
              <p className="text-[10px] text-slate-400 mt-1">Closed {period.closed_at.slice(0, 10)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge variant={period.is_closed ? 'voided' : 'active'} label={period.is_closed ? 'Closed' : 'Open'} />
          {period.is_closed
            ? (
              <button
                className="btn-secondary text-[11px] py-1 px-3 flex items-center gap-1"
                onClick={e => { e.stopPropagation(); onReopen() }}
                disabled={reopening}
              >
                {reopening ? <Loader2 size={11} className="animate-spin" /> : <Unlock size={11} />}
                Reopen
              </button>
            )
            : (
              <button
                className="btn-primary text-[11px] py-1 px-3 flex items-center gap-1 bg-red-600 hover:bg-red-700"
                onClick={e => { e.stopPropagation(); onClose() }}
                disabled={closing}
              >
                {closing ? <Loader2 size={11} className="animate-spin" /> : <Lock size={11} />}
                Close Period
              </button>
            )
          }
          <ChevronRight size={14} className={`text-slate-400 transition-transform ${isSelected ? 'rotate-90' : ''}`} />
        </div>
      </div>
    </div>
  )
}

// ── Readiness Panel ───────────────────────────────────────────────────────────

function ReadinessChecklist({ period, checks }: { period: FinancialPeriod; checks: ReadinessCheck[] }) {
  const passing  = checks.filter(c => c.isPassed === true).length
  const total    = checks.length
  const blockers = checks.filter(c => !c.isPassed && c.isCritical)
  const allClear = blockers.length === 0

  return (
    <SectionCard
      title={`Close Readiness — ${period.name}`}
      subtitle={`${passing}/${total} checks passing · ${blockers.length} blocker(s)`}
      icon={<Shield size={14} />}
    >
      {/* Summary bar */}
      <div className="h-2 rounded-full bg-slate-200 overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all ${allClear ? 'bg-[#1D9E75]' : 'bg-amber-400'}`}
          style={{ width: total > 0 ? `${(passing / total) * 100}%` : '0%' }}
        />
      </div>

      <div className="space-y-2.5">
        {checks.map(chk => (
          <div
            key={chk.id}
            className={`rounded-lg border p-3 flex items-start gap-3 ${
              chk.isPassed === true  ? 'bg-emerald-50/50 border-emerald-100' :
              chk.isCritical         ? 'bg-red-50/50 border-red-200' :
                                       'bg-amber-50/50 border-amber-200'
            }`}
          >
            <div className="mt-0.5 shrink-0">{statusIcon(chk.isPassed, chk.isCritical)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-slate-700">{chk.label}</p>
                {chk.isCritical && !chk.isPassed && (
                  <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded uppercase tracking-wide">Blocker</span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">{chk.description}</p>
              {chk.detail && (
                <p className={`text-[11px] mt-1 font-medium ${chk.isPassed ? 'text-emerald-700' : chk.isCritical ? 'text-red-700' : 'text-amber-700'}`}>
                  {chk.detail}
                </p>
              )}
            </div>
            {chk.actionTo && !chk.isPassed && (
              <Link
                to={chk.actionTo}
                className="shrink-0 text-[11px] text-[#0F2D5C] underline hover:opacity-80 whitespace-nowrap"
              >
                {chk.actionLabel ?? 'Investigate'}
              </Link>
            )}
          </div>
        ))}
      </div>

      {allClear && (
        <div className="mt-4 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded p-3">
          <CheckCircle2 size={16} className="text-[#1D9E75] shrink-0" />
          <p className="text-[13px] font-semibold text-emerald-800">Period is ready to close — all blockers resolved</p>
        </div>
      )}
    </SectionCard>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PeriodCloseCockpit() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [confirmClose, setConfirmClose] = useState<FinancialPeriod | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', period_type: 'monthly', start_date: '', end_date: '' })
  const PERIOD_TYPES = ['monthly', 'quarterly', 'annual']

  const { data: periods = [], isLoading: periodsLoading, refetch: refetchPeriods } = useQuery({
    queryKey: ['gl-periods'],
    queryFn: () => glApi.periods() as Promise<FinancialPeriod[]>,
  })

  const { data: scoreData,  refetch: refetchScore  } = useGlSystemIntegrityScore()
  const { data: issuesData, refetch: refetchIssues } = useGlIntegrityIssues(false)

  // Unposted entries count
  const { data: entriesData } = useQuery({
    queryKey: ['gl-entries-unposted'],
    queryFn: () => glApi.entries({ page: 1, size: 200 }),
  })

  // Recon summary (all docs)
  const { data: reconData } = useQuery({
    queryKey: ['recon-summary-cockpit'],
    queryFn: () => (glApi as any).reconciliationSourceDocs({ page: 1, size: 1, mismatch_only: '1' }) as Promise<{ summary: { total: number } }>,
  })

  const selectedPeriod = periods.find(p => p.id === selectedId) ?? periods.find(p => !p.is_closed) ?? null

  const closeMut = useMutation({
    mutationFn: (id: number) => glApi.closePeriod(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-periods'] })
      setConfirmClose(null)
    },
  })

  const reopenMut = useMutation({
    mutationFn: (id: number) => glApi.reopenPeriod(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gl-periods'] }),
  })

  const createMut = useMutation({
    mutationFn: () => glApi.createPeriod(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-periods'] })
      setShowAdd(false)
      setForm({ name: '', period_type: 'monthly', start_date: '', end_date: '' })
    },
  })

  function prefillCurrentMonth() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate()
    const names = ['','January','February','March','April','May','June','July','August','September','October','November','December']
    setForm({ name: `${names[now.getMonth() + 1]} ${y}`, period_type: 'monthly', start_date: `${y}-${m}-01`, end_date: `${y}-${m}-${lastDay}` })
  }

  function refreshAll() {
    refetchPeriods(); refetchScore(); refetchIssues()
  }

  const open    = periods.filter(p => !p.is_closed)
  const closed  = periods.filter(p =>  p.is_closed)
  const integrityScore  = scoreData?.overall_score ?? scoreData?.score ?? 0
  const criticalIssues  = (issuesData?.checks ?? []).filter(i => i.severity === 'critical').length
  const unpostedEntries = ((entriesData as any)?.data ?? []).filter((e: { is_posted: number }) => e.is_posted === 0).length
  const reconMismatches = (reconData as any)?.summary?.total ?? 0

  // Build readiness checks for selected period
  const readinessChecks: ReadinessCheck[] = selectedPeriod && !selectedPeriod.is_closed ? [
    {
      id: 'integrity',
      label: 'System Integrity Score',
      description: 'GL integrity score must be ≥ 70 to safely close a period',
      isCritical: false,
      isPassed: integrityScore >= 70,
      detail: integrityScore > 0 ? `Current score: ${integrityScore}/100` : undefined,
      actionTo: '/gl/health-integrity',
      actionLabel: 'View Issues',
    },
    {
      id: 'critical_issues',
      label: 'No Critical GL Issues',
      description: 'All critical integrity issues must be resolved before closing',
      isCritical: true,
      isPassed: criticalIssues === 0,
      detail: criticalIssues > 0 ? `${criticalIssues} critical issue(s) found` : 'No critical issues',
      actionTo: '/gl/health-integrity',
      actionLabel: 'Resolve Issues',
    },
    {
      id: 'unposted',
      label: 'No Unposted Entries',
      description: 'All journal entries within the period should be posted',
      isCritical: true,
      isPassed: unpostedEntries === 0,
      detail: unpostedEntries > 0 ? `${unpostedEntries} entry/entries pending posting` : 'All entries posted',
      actionTo: '/gl/entries',
      actionLabel: 'Post Entries',
    },
    {
      id: 'reconciliation',
      label: 'Source Document Reconciliation',
      description: 'All operational events should have a corresponding GL entry',
      isCritical: false,
      isPassed: reconMismatches === 0,
      detail: reconMismatches > 0 ? `${reconMismatches} document mismatch(es) found` : 'All documents reconciled',
      actionTo: '/gl/reconciliation',
      actionLabel: 'Workbench',
    },
    {
      id: 'open_period_exists',
      label: 'Next Period Exists or Will Be Created',
      description: 'Closing this period will block all future entries unless another open period exists',
      isCritical: false,
      isPassed: open.length > 1,
      detail: open.length > 1 ? `${open.length - 1} other open period(s) available` : 'This is the only open period — create a new one after closing',
    },
  ] : []

  const kpis: KpiItem[] = [
    { id: 'open',    label: 'OPEN PERIODS',    value: open.length,   variant: open.length > 0 ? 'success' : 'warning' },
    { id: 'closed',  label: 'CLOSED PERIODS',  value: closed.length },
    { id: 'score',   label: 'INTEGRITY SCORE', value: integrityScore > 0 ? `${integrityScore}/100` : '—', variant: integrityScore >= 80 ? 'success' : 'warning' },
    { id: 'recon',   label: 'RECON MISMATCHES', value: reconMismatches, variant: reconMismatches === 0 ? 'success' : 'warning' },
  ]

  const actions: CommandAction[] = [
    {
      id: 'refresh', label: 'Refresh', icon: <RefreshCw size={14} />, onClick: refreshAll, variant: 'secondary',
    },
    {
      id: 'new', label: 'New Period', icon: <CalendarDays size={14} />, variant: 'primary',
      onClick: () => { setShowAdd(true); prefillCurrentMonth() },
    },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">Period Close Cockpit</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">
          Run the close-readiness checklist and safely close or reopen financial periods.
        </p>
      </div>

      <CommandBar actions={actions} />
      <KpiStrip items={kpis} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">

          {/* ── Left: Period List ──────────────────────────────── */}
          <div className="space-y-4">
            {open.length === 0 && !periodsLoading && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded p-3">
                <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                <p className="text-[12px] font-medium text-amber-800">No open periods — posting is blocked system-wide</p>
              </div>
            )}

            {/* Open Periods */}
            {open.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Unlock size={10} className="text-[#1D9E75]" /> Open Periods ({open.length})
                </p>
                <div className="space-y-2">
                  {open.map(p => (
                    <PeriodCard
                      key={p.id} period={p}
                      isSelected={selectedPeriod?.id === p.id}
                      onSelect={() => setSelectedId(p.id)}
                      onClose={() => setConfirmClose(p)}
                      onReopen={() => {}}
                      closing={closeMut.isPending && confirmClose?.id === p.id}
                      reopening={false}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Closed Periods */}
            {closed.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Lock size={10} className="text-red-400" /> Closed ({closed.length})
                </p>
                <div className="space-y-2">
                  {closed.slice(0, 5).map(p => (
                    <PeriodCard
                      key={p.id} period={p}
                      isSelected={selectedPeriod?.id === p.id}
                      onSelect={() => setSelectedId(p.id)}
                      onClose={() => {}}
                      onReopen={() => reopenMut.mutate(p.id)}
                      closing={false}
                      reopening={reopenMut.isPending}
                    />
                  ))}
                  {closed.length > 5 && (
                    <p className="text-[11px] text-slate-400 text-center pt-1">+ {closed.length - 5} more closed periods</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Readiness Panel ─────────────────────────── */}
          <div>
            {selectedPeriod && !selectedPeriod.is_closed ? (
              <ReadinessChecklist period={selectedPeriod} checks={readinessChecks} />
            ) : selectedPeriod && selectedPeriod.is_closed ? (
              <SectionCard title={`${selectedPeriod.name} — Closed`} subtitle="This period is locked" icon={<Lock size={14} className="text-red-400" />}>
                <div className="space-y-3 text-[13px] text-slate-600">
                  <p>Period was closed on <strong>{selectedPeriod.closed_at?.slice(0, 10) ?? 'unknown date'}</strong>.</p>
                  <p>No journal entries can be posted within its date range (<span className="font-mono">{selectedPeriod.start_date}</span> → <span className="font-mono">{selectedPeriod.end_date}</span>).</p>
                  <p className="text-[12px] text-slate-400">To re-open this period, click <strong>Reopen</strong> on the period card. This requires elevated permissions.</p>
                </div>
              </SectionCard>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-slate-200 bg-white text-center px-6">
                <Shield size={40} className="text-slate-300 mb-3" />
                <p className="text-[14px] font-semibold text-slate-500">Select an open period to run the close-readiness checklist</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm Close Modal */}
      {confirmClose && (
        <Modal open={!!confirmClose} onClose={() => setConfirmClose(null)} title="Confirm Period Close" size="md">
          <div className="space-y-4 text-[13px]">
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded p-4">
              <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-800">This action cannot be easily undone</p>
                <p className="text-[12px] text-red-700 mt-1">
                  Closing <strong>{confirmClose.name}</strong> will block all journal entries within{' '}
                  <span className="font-mono">{confirmClose.start_date}</span> → <span className="font-mono">{confirmClose.end_date}</span>.
                </p>
              </div>
            </div>
            <p className="text-slate-600">Make sure the close-readiness checklist shows no critical blockers before proceeding.</p>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button className="btn-secondary" onClick={() => setConfirmClose(null)}>Cancel</button>
            <button
              className="btn-primary bg-red-600 hover:bg-red-700 flex items-center gap-2"
              onClick={() => closeMut.mutate(confirmClose.id)}
              disabled={closeMut.isPending}
            >
              {closeMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
              Close Period
            </button>
          </div>
        </Modal>
      )}

      {/* Create Period Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Financial Period" size="md">
        <div className="space-y-4 text-[13px]">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Period Name *</label>
            <input className="input" placeholder="e.g. May 2026" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Period Type</label>
            <select className="input" value={form.period_type} onChange={e => setForm(f => ({ ...f, period_type: e.target.value }))}>
              {PERIOD_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Start Date</label>
              <input type="date" className="input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-slate-600 font-semibold mb-1">End Date</label>
              <input type="date" className="input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
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
