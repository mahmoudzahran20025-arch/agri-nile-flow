import { Download, Filter, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useGlAuditLog, useGlIntegrityIssues, useGlSystemIntegrityScore } from '../../hooks/useGlFinance'
import SectionCard from '../../components/ui/SectionCard'
import StatusBadge from '../../components/ui/StatusBadge'

type Severity = 'all' | 'critical' | 'high' | 'medium'

function csvEscape(val: unknown): string {
  const str = String(val ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export default function HealthIntegrityPage() {
  const [severity, setSeverity] = useState<Severity>('all')
  const [showDetailed, setShowDetailed] = useState(false)

  const { data: scoreData } = useGlSystemIntegrityScore()
  const { data: issuesData, isLoading: issuesLoading } = useGlIntegrityIssues(showDetailed)
  const { data: auditData } = useGlAuditLog({ page: 1, size: 15 })

  const filtered = useMemo(() => {
    const rows = issuesData?.checks ?? []
    if (severity === 'all') return rows
    return rows.filter((r) => r.severity === severity)
  }, [issuesData, severity])

  const onExportCsv = () => {
    const rows = filtered
    const csvLines = [
      'check,severity,count',
      ...rows.map((r) => [csvEscape(r.name), csvEscape(r.severity), csvEscape(r.count)].join(',')),
    ]
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gl-integrity-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 bg-white border-b border-slate-200 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Health & Integrity</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Canonical control room for GL consistency and auditability.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary h-8 px-3 text-[12px] inline-flex items-center gap-2" onClick={onExportCsv}>
            <Download size={14} />
            Export CSV
          </button>
          <Link to="/gl/entries" className="btn-primary h-8 px-3 text-[12px] inline-flex items-center">Go To Entries</Link>
        </div>
      </div>

      <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center gap-3">
        <div className="text-[12px] text-slate-500">Overall score</div>
        <div className="text-[22px] font-semibold text-[#0F2D5C] leading-none">{scoreData?.overall_score ?? scoreData?.score ?? '--'}</div>
        <StatusBadge type="status" variant={(scoreData?.overall_score ?? scoreData?.score ?? 0) >= 80 ? 'posted' : 'draft'} label={scoreData?.status || 'unknown'} />

        <div className="h-6 w-px bg-slate-200 mx-1" />

        <Filter size={14} className="text-slate-400" />
        <select
          className="input h-8 text-[12px] py-1 w-36"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
        >
          <option value="all">All severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
        </select>

        <label className="inline-flex items-center gap-2 text-[12px] text-slate-600">
          <input type="checkbox" checked={showDetailed} onChange={(e) => setShowDetailed(e.target.checked)} />
          Detailed mode
        </label>
      </div>

      <div className="p-6 grid grid-cols-1 xl:grid-cols-3 gap-5 overflow-y-auto">
        <SectionCard
          title="Integrity Checks"
          subtitle="Issue matrix with severity and count"
          icon={<ShieldAlert size={16} />}
          className="xl:col-span-2"
        >
          <div className="space-y-2">
            {issuesLoading && <div className="text-[12px] text-slate-500">Loading checks...</div>}
            {!issuesLoading && filtered.map((check) => {
              const badgeVariant = check.severity === 'critical' ? 'reversed' : check.severity === 'high' ? 'draft' : 'posted'
              const ctaHref = check.name === 'unbalanced_entries' ? '/gl/entries' : check.name === 'orphan_lines' ? '/gl/entries' : '/gl/accounts'
              return (
                <div key={check.name} className="border border-slate-200 rounded p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-semibold text-slate-800">{check.name.replace(/_/g, ' ')}</p>
                      <p className="text-[11px] text-slate-500">{check.count} affected row(s)</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge type="status" variant={badgeVariant as any} label={check.severity} />
                      <Link to={ctaHref} className="text-[11px] font-semibold text-[#0F2D5C]">Investigate</Link>
                    </div>
                  </div>
                  {showDetailed && check.details && check.details.length > 0 && (
                    <pre className="mt-2 bg-slate-900 text-slate-100 rounded p-2 text-[10px] overflow-auto">{JSON.stringify(check.details.slice(0, 5), null, 2)}</pre>
                  )}
                </div>
              )
            })}
            {!issuesLoading && filtered.length === 0 && (
              <div className="text-[12px] text-[#1D9E75] font-semibold">No issues for current filter.</div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Recent Audit Trail"
          subtitle="Most recent finance mutations"
          className="xl:col-span-1"
        >
          <div className="space-y-2">
            {(auditData?.data ?? []).slice(0, 10).map((row) => (
              <div key={row.id} className="border border-slate-200 rounded px-3 py-2">
                <div className="text-[12px] font-semibold text-slate-800">{row.action} · {row.table_name}</div>
                <div className="text-[11px] text-slate-500">#{row.record_id || '-'} · {row.user_name || row.user_email || 'System'}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{row.created_at}</div>
              </div>
            ))}
            {(auditData?.data?.length ?? 0) === 0 && (
              <p className="text-[12px] text-slate-500">No recent audit entries.</p>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
