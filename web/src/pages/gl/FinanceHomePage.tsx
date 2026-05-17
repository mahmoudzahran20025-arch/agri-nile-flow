import { AlertTriangle, ArrowRight, BarChart3, FileText, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { glApi } from '../../api/client'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import StatusBadge from '../../components/ui/StatusBadge'
import { useGlBatchPostingJobs } from '../../hooks/useGlFinance'

function fmt(n: number) {
  return Number(n || 0).toLocaleString('en-US')
}

function money(n: number) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function FinanceHomePage() {
  const { data: entriesData } = useQuery({
    queryKey: ['gl-entries-summary'],
    queryFn: () => glApi.entries({ page: 1, size: 200 }),
  })
  const { data: jobsData, isLoading: jobsLoading } = useGlBatchPostingJobs({ page: 1, size: 8 })
  const { data: engineHealthData } = useQuery({
    queryKey: ['gl-engine-health'],
    queryFn: () => glApi.engineHealth(),
    refetchInterval: 60_000,
  })
  const { data: trialData } = useQuery({
    queryKey: ['gl-trial-balance-reality'],
    queryFn: () => glApi.glTrialBalance(),
    refetchInterval: 60_000,
  })

  const entries = ((entriesData as any)?.data ?? []) as Array<{ is_posted: number; reversal_entry_id?: number | null }>

  const summary = useMemo(() => {
    const posted = entries.filter((e) => e.is_posted === 1).length
    const pending = entries.filter((e) => e.is_posted === 0).length
    const reversed = entries.filter((e) => !!e.reversal_entry_id).length
    const queuePending = (jobsData?.data ?? []).filter((j) => j.status === 'pending' || j.status === 'processing').length
    return {
      total: entries.length,
      posted,
      pending,
      reversed,
      queuePending,
    }
  }, [entries, jobsData])

  const engineSummary = engineHealthData?.data?.summary
  const trialTotals = trialData?.totals
  const trialGap = Math.abs((trialTotals?.total_debit ?? 0) - (trialTotals?.total_credit ?? 0))
  const isEngineHealthy = engineHealthData?.data?.status === 'healthy'
  const derivedIntegrityScore = isEngineHealthy && trialGap === 0 ? 100 : isEngineHealthy ? 90 : 70

  const kpis: KpiItem[] = [
    {
      id: 'engine',
      label: 'Engine Health',
      value: isEngineHealthy ? 'Healthy' : 'Attention',
      variant: isEngineHealthy ? 'success' : 'warning',
    },
    {
      id: 'trial-dr',
      label: 'Trial Balance Debit',
      value: trialTotals ? money(trialTotals.total_debit) : '--',
    },
    {
      id: 'trial-cr',
      label: 'Trial Balance Credit',
      value: trialTotals ? money(trialTotals.total_credit) : '--',
    },
    {
      id: 'trial-gap',
      label: 'Trial Balance Gap',
      value: money(trialGap),
      variant: trialGap === 0 ? 'success' : 'warning',
    },
    { id: 'entries', label: 'Journal Entries (latest sample)', value: fmt(summary.total) },
    { id: 'pending', label: 'Pending Posting (latest sample)', value: fmt(summary.pending), variant: summary.pending > 0 ? 'warning' : 'success' },
    { id: 'queue', label: 'Queue In Progress', value: fmt(summary.queuePending), variant: summary.queuePending > 0 ? 'warning' : 'default' },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">Finance Command Center</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">Operational cockpit for GL health, posting queue, and month-end readiness based on live production data.</p>
      </div>

      <KpiStrip items={kpis} />

      <div className="p-6 grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto">
        <SectionCard
          title="Quick Actions"
          subtitle="Run your most frequent finance workflows"
          icon={<BarChart3 size={16} />}
          className="xl:col-span-1"
        >
          <div className="space-y-2">
            {[
              { to: '/gl/entries', label: 'Open Journal Entries' },
              { to: '/gl/health-integrity', label: 'Open Health & Integrity' },
              { to: '/gl/posting-setup', label: 'Manage Posting Setup' },
              { to: '/gl/statements', label: 'Open Financial Statements' },
            ].map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <span>{a.label}</span>
                <ArrowRight size={14} className="text-slate-400" />
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Integrity Snapshot"
          subtitle="Live anomalies from engine-health endpoint"
          icon={<ShieldCheck size={16} />}
          className="xl:col-span-2"
          action={<Link to="/gl/health-integrity" className="text-[12px] text-[#0F2D5C] font-semibold">View all</Link>}
        >
          <div className="space-y-2">
            {[
              { key: 'unbalanced_journal_entries', label: 'Unbalanced journal entries', count: engineSummary?.unbalanced_journal_entries ?? 0 },
              { key: 'header_account_postings', label: 'Header account postings', count: engineSummary?.header_account_postings ?? 0 },
              { key: 'posted_cash_missing_journal', label: 'Posted cash without journal', count: engineSummary?.posted_cash_missing_journal ?? 0 },
              { key: 'posted_supplier_missing_journal', label: 'Posted supplier without journal', count: engineSummary?.posted_supplier_missing_journal ?? 0 },
              { key: 'inventory_ghost_posted', label: 'Inventory ghost-posted', count: engineSummary?.inventory_ghost_posted ?? 0 },
              { key: 'inventory_outbox_stuck', label: 'Inventory outbox stuck', count: engineSummary?.inventory_outbox_stuck ?? 0 },
            ].map((check) => {
              const variant = check.count > 0 ? 'reversed' : 'posted'
              return (
                <div key={check.key} className="flex items-center justify-between border border-slate-200 rounded px-3 py-2">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-800">{check.label}</p>
                    <p className="text-[11px] text-slate-500">{check.count} affected records</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge type="status" variant={variant as any} label={check.count > 0 ? 'issue' : 'clean'} />
                  </div>
                </div>
              )
            })}
            {(engineSummary?.unbalanced_journal_entries ?? 0) === 0 &&
             (engineSummary?.header_account_postings ?? 0) === 0 &&
             (engineSummary?.posted_cash_missing_journal ?? 0) === 0 &&
             (engineSummary?.posted_supplier_missing_journal ?? 0) === 0 &&
             (engineSummary?.inventory_ghost_posted ?? 0) === 0 &&
             (engineSummary?.inventory_outbox_stuck ?? 0) === 0 && (
              <div className="text-[12px] text-[#1D9E75] font-semibold flex items-center gap-2">
                <ShieldCheck size={14} />
                No integrity issues detected.
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Posting Queue"
          subtitle="Recent background posting jobs"
          icon={<FileText size={16} />}
          className="xl:col-span-2"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left py-2">Job</th>
                  <th className="text-left py-2">Module</th>
                  <th className="text-right py-2">Progress</th>
                  <th className="text-right py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(jobsData?.data ?? []).map((job) => (
                  <tr key={job.id}>
                    <td className="py-2">#{job.id} · {job.event_type}</td>
                    <td className="py-2">{job.source_module}</td>
                    <td className="py-2 text-right tabular-nums">{job.processed_items}/{job.total_items}</td>
                    <td className="py-2 text-right">
                      <StatusBadge
                        type="status"
                        variant={job.status === 'completed' ? 'posted' : job.status === 'failed' ? 'reversed' : 'draft'}
                        label={job.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!jobsLoading && (jobsData?.data?.length ?? 0) === 0 && (
              <p className="text-[12px] text-slate-500 py-3">No recent jobs in posting queue.</p>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Financial Reality Snapshot"
          subtitle="Actual numbers from live trial balance and engine health"
          icon={<AlertTriangle size={16} />}
          className="xl:col-span-1"
        >
          <div className="space-y-2 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">System integrity score</span>
              <span className="font-semibold text-slate-800">{derivedIntegrityScore}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Trial balance debit</span>
              <span className="font-semibold text-slate-800">{trialTotals ? money(trialTotals.total_debit) : '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Trial balance credit</span>
              <span className="font-semibold text-slate-800">{trialTotals ? money(trialTotals.total_credit) : '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Balance gap</span>
              <span className="font-semibold text-slate-800">{money(trialGap)}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500">
              Status: {isEngineHealthy && trialGap === 0 ? 'Ready to close' : 'Needs attention'}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
