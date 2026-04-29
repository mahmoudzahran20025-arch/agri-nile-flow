import { AlertTriangle, ArrowRight, BarChart3, FileText, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { glApi } from '../../api/client'
import { KpiStrip, type KpiItem } from '../../components/ui/KpiStrip'
import SectionCard from '../../components/ui/SectionCard'
import StatusBadge from '../../components/ui/StatusBadge'
import { useGlBatchPostingJobs, useGlIntegrityIssues, useGlSystemIntegrityScore } from '../../hooks/useGlFinance'

function fmt(n: number) {
  return Number(n || 0).toLocaleString('en-US')
}

export default function FinanceHomePage() {
  const { data: entriesData } = useQuery({
    queryKey: ['gl-entries-summary'],
    queryFn: () => glApi.entries({ page: 1, size: 200 }),
  })
  const { data: scoreData } = useGlSystemIntegrityScore()
  const { data: issuesData } = useGlIntegrityIssues(false)
  const { data: jobsData, isLoading: jobsLoading } = useGlBatchPostingJobs({ page: 1, size: 8 })

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

  const kpis: KpiItem[] = [
    { id: 'health', label: 'System Integrity Score', value: scoreData?.overall_score ?? scoreData?.score ?? '--', variant: (scoreData?.overall_score ?? scoreData?.score ?? 0) >= 80 ? 'success' : 'warning' },
    { id: 'entries', label: 'Journal Entries', value: fmt(summary.total) },
    { id: 'pending', label: 'Pending Posting', value: fmt(summary.pending), variant: summary.pending > 0 ? 'warning' : 'success' },
    { id: 'queue', label: 'Queue In Progress', value: fmt(summary.queuePending), variant: summary.queuePending > 0 ? 'warning' : 'default' },
  ]

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 bg-white border-b border-slate-200">
        <h1 className="text-[18px] font-bold text-[#0F2D5C]">Finance Command Center</h1>
        <p className="text-[12px] text-slate-500 mt-0.5">Operational cockpit for GL health, posting queue, and month-end readiness.</p>
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
          subtitle="Live anomalies from canonical integrity checks"
          icon={<ShieldCheck size={16} />}
          className="xl:col-span-2"
          action={<Link to="/gl/health-integrity" className="text-[12px] text-[#0F2D5C] font-semibold">View all</Link>}
        >
          <div className="space-y-2">
            {(issuesData?.checks ?? []).slice(0, 6).map((check) => {
              const variant = check.severity === 'critical' ? 'reversed' : check.severity === 'high' ? 'draft' : 'posted'
              return (
                <div key={check.name} className="flex items-center justify-between border border-slate-200 rounded px-3 py-2">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-800">{check.name.replace(/_/g, ' ')}</p>
                    <p className="text-[11px] text-slate-500">{check.count} affected records</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge type="status" variant={variant as any} label={check.severity} />
                  </div>
                </div>
              )
            })}
            {(issuesData?.checks?.length ?? 0) === 0 && (
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
          title="Month-End Readiness"
          subtitle="Readiness signal based on integrity and posting state"
          icon={<AlertTriangle size={16} />}
          className="xl:col-span-1"
        >
          <div className="space-y-2 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Integrity score</span>
              <span className="font-semibold text-slate-800">{scoreData?.overall_score ?? scoreData?.score ?? '--'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Unposted entries</span>
              <span className="font-semibold text-slate-800">{fmt(summary.pending)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Reversed entries</span>
              <span className="font-semibold text-slate-800">{fmt(summary.reversed)}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500">
              Status: {(scoreData?.overall_score ?? scoreData?.score ?? 0) >= 80 && summary.pending === 0 ? 'Ready to close' : 'Needs attention'}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
