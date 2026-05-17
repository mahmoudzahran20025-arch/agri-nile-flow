import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, ShieldCheck, PlayCircle } from 'lucide-react';
import { glApi } from '../../api/client';

interface Check {
  id:          string;
  label:       string;
  description: string;
  value:       number;
  threshold:   number;
  status:      'pass' | 'fail' | 'warning';
  severity:    'blocker' | 'warning';
}

interface ChecklistResponse {
  checks:  Check[];
  summary: {
    total:           number;
    passing:         number;
    blockers_failed: number;
    warnings_failed: number;
    clean:           boolean;
    as_of:           string;
  };
}

interface DailyLogRow {
  run_date:       string;
  gl_balance:     number;
  error_events:   number;
  stale_balances: number;
  zero_jel:       number;
  pending_outbox: number;
  alerts:         string | null;
  status:         'ok' | 'warning' | 'critical';
}

function StatusIcon({ status }: { status: Check['status'] }) {
  if (status === 'pass')    return <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />;
  if (status === 'fail')    return <XCircle      size={16} className="text-red-500    shrink-0" />;
  return <AlertTriangle size={16} className="text-amber-500 shrink-0" />;
}

function statusBadge(status: 'ok' | 'warning' | 'critical') {
  if (status === 'ok')       return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">OK</span>;
  if (status === 'warning')  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">WARN</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">CRITICAL</span>;
}

export default function VerificationDashboardPage() {
  const qc = useQueryClient();

  const { data: cl, isLoading: clLoading, isRefetching: clRefetching } = useQuery({
    queryKey: ['gl-verification-checklist'],
    queryFn:  () => glApi.verificationChecklist() as Promise<{ data: ChecklistResponse }>,
    refetchInterval: 60_000,
  });

  const { data: logData, isLoading: logLoading } = useQuery({
    queryKey: ['gl-health-daily-log'],
    queryFn:  () => glApi.healthDailyLog(14) as Promise<{ data: DailyLogRow[] }>,
  });

  const runNow = useMutation({
    mutationFn: () => glApi.healthRunNow() as Promise<unknown>,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['gl-health-daily-log'] });
      qc.invalidateQueries({ queryKey: ['gl-verification-checklist'] });
    },
  });

  const checklist = cl?.data;
  const logRows   = (logData as unknown as { data: DailyLogRow[] })?.data ?? [];

  const blockers  = checklist?.checks.filter(c => c.severity === 'blocker') ?? [];
  const warnings  = checklist?.checks.filter(c => c.severity === 'warning') ?? [];

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck size={20} className="text-[#0F2D5C]" />
            <div>
              <h1 className="text-[18px] font-bold text-[#0F2D5C]">Governance Verification</h1>
              <p className="text-[12px] text-slate-500 mt-0.5">
                {checklist?.summary.as_of ? `As of ${checklist.summary.as_of}` : 'Live data integrity checks'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-white bg-[#0F2D5C] hover:bg-[#1a3d7c] rounded border border-[#0F2D5C] disabled:opacity-50"
            >
              <PlayCircle size={13} className={runNow.isPending ? 'animate-spin' : ''} />
              {runNow.isPending ? 'Running…' : 'Run Health Check'}
            </button>
            <button
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['gl-verification-checklist'] });
                qc.invalidateQueries({ queryKey: ['gl-health-daily-log'] });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
            >
              <RefreshCw size={13} className={clRefetching ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* Summary strip */}
        {checklist && (
          <div className="grid grid-cols-4 gap-4">
            {[
              {
                label: 'Overall Status',
                value: checklist.summary.clean ? 'CLEAN' : 'ISSUES FOUND',
                sub:   `${checklist.summary.passing}/${checklist.summary.total} checks passing`,
                color: checklist.summary.clean ? 'text-emerald-600' : 'text-red-600',
                bg:    checklist.summary.clean ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200',
              },
              {
                label: 'Blockers Failed',
                value: String(checklist.summary.blockers_failed),
                sub:   'Must be 0 before period close',
                color: checklist.summary.blockers_failed > 0 ? 'text-red-600' : 'text-emerald-600',
                bg:    'bg-white border-slate-200',
              },
              {
                label: 'Warnings',
                value: String(checklist.summary.warnings_failed),
                sub:   'Review before close',
                color: checklist.summary.warnings_failed > 0 ? 'text-amber-600' : 'text-emerald-600',
                bg:    'bg-white border-slate-200',
              },
              {
                label: 'Passing',
                value: `${checklist.summary.passing}/${checklist.summary.total}`,
                sub:   'All governance checks',
                color: 'text-[#0F2D5C]',
                bg:    'bg-white border-slate-200',
              },
            ].map(k => (
              <div key={k.label} className={`rounded-lg border p-4 ${k.bg}`}>
                <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-1">{k.label}</p>
                <p className={`text-[22px] font-bold ${k.color}`}>{k.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Blockers */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <XCircle size={15} className="text-red-500" />
            <h2 className="text-[13px] font-bold text-slate-700">Blocker Checks</h2>
            <span className="ml-1 text-[11px] text-slate-400">Must all pass before period close</span>
          </div>
          {clLoading ? (
            <div className="px-4 py-6 text-center text-slate-400 text-[12px]">Loading…</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {blockers.map(check => (
                <div key={check.id} className={`flex items-start gap-3 px-4 py-3 ${check.status === 'fail' ? 'bg-red-50/40' : ''}`}>
                  <StatusIcon status={check.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-slate-800">{check.label}</span>
                      {check.status === 'fail' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">FAIL</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{check.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[18px] font-bold tabular-nums ${check.status === 'fail' ? 'text-red-600' : 'text-emerald-600'}`}>
                      {check.value}
                    </p>
                    <p className="text-[10px] text-slate-400">threshold: ≤{check.threshold}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Warnings */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500" />
            <h2 className="text-[13px] font-bold text-slate-700">Warning Checks</h2>
          </div>
          {clLoading ? (
            <div className="px-4 py-6 text-center text-slate-400 text-[12px]">Loading…</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {warnings.map(check => (
                <div key={check.id} className={`flex items-start gap-3 px-4 py-3 ${check.status !== 'pass' ? 'bg-amber-50/40' : ''}`}>
                  <StatusIcon status={check.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-slate-800">{check.label}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{check.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[18px] font-bold tabular-nums ${check.status !== 'pass' ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {check.id === 'ap_subledger_gap' ? `${check.value} EGP` : check.value}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      threshold: {check.id === 'ap_subledger_gap' ? `≤${check.threshold} EGP` : `≤${check.threshold}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Daily health log */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-[13px] font-bold text-slate-700">Daily Finance Health Log</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Last 14 days — runs nightly at 22:00 UTC</p>
          </div>
          {logLoading ? (
            <div className="px-4 py-6 text-center text-slate-400 text-[12px]">Loading…</div>
          ) : logRows.length === 0 ? (
            <div className="px-4 py-6 text-center text-slate-400 text-[12px]">No health runs recorded yet</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Date', 'Status', 'GL Balance', 'Error Events', 'Stale Balances', 'Zero JEL', 'Pending Outbox', 'Alerts'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {logRows.map((row, i) => {
                  const alerts: string[] = row.alerts ? JSON.parse(row.alerts) : [];
                  return (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">{row.run_date}</td>
                      <td className="px-4 py-2.5">{statusBadge(row.status)}</td>
                      <td className={`px-4 py-2.5 tabular-nums font-medium ${Math.abs(row.gl_balance) > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {row.gl_balance.toFixed(2)}
                      </td>
                      <td className={`px-4 py-2.5 tabular-nums ${row.error_events > 0 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                        {row.error_events}
                      </td>
                      <td className={`px-4 py-2.5 tabular-nums ${row.stale_balances > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {row.stale_balances}
                      </td>
                      <td className={`px-4 py-2.5 tabular-nums ${row.zero_jel > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {row.zero_jel}
                      </td>
                      <td className={`px-4 py-2.5 tabular-nums ${row.pending_outbox > 50 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                        {row.pending_outbox}
                      </td>
                      <td className="px-4 py-2.5">
                        {alerts.length === 0 ? (
                          <span className="text-emerald-500 text-[11px]">None</span>
                        ) : (
                          <span className="text-amber-600 text-[11px]">{alerts.length} alert{alerts.length > 1 ? 's' : ''}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}
