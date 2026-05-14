import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, PlayCircle, Eye, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { glApi } from '../../api/client';

type Scope = 'all' | 'by_source' | 'by_period';

const SOURCE_OPTIONS = [
  { value: 'inventory_movement', label: 'حركات المخزون' },
  { value: 'cash_transaction',   label: 'المعاملات النقدية' },
  { value: 'supplier_transaction', label: 'معاملات الموردين' },
  { value: 'business_event',    label: 'أحداث الأعمال' },
];

function pct(num: number, denom: number) {
  if (!denom) return 0;
  return Math.round((num / denom) * 10000) / 100;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US').format(n);
}

export default function JERegenerationPage() {
  const qc = useQueryClient();

  const [scope, setScope]         = useState<Scope>('all');
  const [sourceRef, setSourceRef] = useState('inventory_movement');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd,   setPeriodEnd]   = useState('');
  const [dryRun, setDryRun]       = useState(true);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(null);

  const { data: progress, isLoading: progLoading } = useQuery({
    queryKey: ['je-regen-progress'],
    queryFn:  () => glApi.regenerationProgress() as Promise<{
      regeneration_progress: {
        total_journal_entries: number;
        with_trace_link:       number;
        with_posting_rule:     number;
        regenerated_count:     number;
        coverage_pct:          number;
      }
    }>,
    refetchInterval: 8000,
  });

  const { data: report } = useQuery({
    queryKey: ['je-regen-report'],
    queryFn:  () => glApi.regenerationReport() as Promise<{
      reconciliation_report: Array<{
        ref_type:     string;
        entry_count:  number;
        traced:       number;
        untraced:     number;
      }>
    }>,
  });

  const rebuild = useMutation({
    mutationFn: () => {
      const scopeValue =
        scope === 'by_source' ? sourceRef :
        scope === 'by_period' ? `${periodStart}|${periodEnd}` :
        undefined;
      return glApi.regenerationRebuild(
        scope === 'all' ? undefined : scope,
        scopeValue,
        dryRun,
      ) as Promise<Record<string, unknown>>;
    },
    onSuccess: (data) => {
      setLastResult(data);
      qc.invalidateQueries({ queryKey: ['je-regen-progress'] });
      qc.invalidateQueries({ queryKey: ['je-regen-report'] });
    },
  });

  const prog = progress?.regeneration_progress;
  const coveragePct = prog?.coverage_pct ?? 0;

  const coverageColor =
    coveragePct >= 90 ? 'text-emerald-600' :
    coveragePct >= 60 ? 'text-amber-500'  :
    'text-red-500';

  const scopeValue =
    scope === 'by_source' ? sourceRef :
    scope === 'by_period' ? `${periodStart}|${periodEnd}` :
    'all entries';

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-bold text-[#0F2D5C]">JE Regeneration Engine</h1>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Rebuild journal entry trace metadata from business events
            </p>
          </div>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['je-regen-progress'] })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* Coverage KPIs */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total JEs',       value: fmt(prog?.total_journal_entries ?? 0),  icon: <Clock size={16} /> },
            { label: 'With Trace',      value: fmt(prog?.with_trace_link ?? 0),         icon: <CheckCircle2 size={16} className="text-emerald-500" /> },
            { label: 'Regenerated',     value: fmt(prog?.regenerated_count ?? 0),       icon: <RefreshCw size={16} className="text-indigo-500" /> },
            { label: 'Coverage',        value: `${coveragePct}%`,                        icon: <Eye size={16} /> },
          ].map(k => (
            <div key={k.label} className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-center gap-2 text-slate-400 mb-2">{k.icon}<span className="text-[11px] uppercase tracking-wider font-bold">{k.label}</span></div>
              <p className={`text-[22px] font-bold ${k.label === 'Coverage' ? coverageColor : 'text-[#0F2D5C]'}`}>{progLoading ? '…' : k.value}</p>
            </div>
          ))}
        </div>

        {/* Coverage bar */}
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-semibold text-slate-600">Trace Coverage</span>
            <span className={`text-[12px] font-bold ${coverageColor}`}>{coveragePct}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-700 ${coveragePct >= 90 ? 'bg-emerald-500' : coveragePct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${Math.min(100, coveragePct)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            {fmt((prog?.total_journal_entries ?? 0) - (prog?.with_trace_link ?? 0))} entries still without trace link
          </p>
        </div>

        {/* Reconciliation report */}
        {report?.reconciliation_report && report.reconciliation_report.length > 0 && (
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-[13px] font-bold text-slate-700">Coverage by Source Type</h2>
            </div>
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Source', 'Total JEs', 'Traced', 'Untraced', 'Coverage'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {report.reconciliation_report.map((row) => {
                  const cov = pct(row.traced, row.entry_count);
                  return (
                    <tr key={row.ref_type} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-slate-600">{row.ref_type}</td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-700">{fmt(row.entry_count)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-emerald-600 font-medium">{fmt(row.traced)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-red-500">{fmt(row.untraced)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-slate-100 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${cov >= 90 ? 'bg-emerald-500' : cov >= 60 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${cov}%` }} />
                          </div>
                          <span className={`text-[11px] font-bold ${cov >= 90 ? 'text-emerald-600' : cov >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{cov}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Run controls */}
        <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
          <h2 className="text-[13px] font-bold text-slate-700">Run Regeneration</h2>

          {/* Scope selector */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-slate-500 w-16 shrink-0">Scope</span>
            {(['all', 'by_source', 'by_period'] as Scope[]).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-1.5 rounded text-[12px] font-medium border transition-colors ${scope === s ? 'bg-[#0F2D5C] text-white border-[#0F2D5C]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {s === 'all' ? 'All Entries' : s === 'by_source' ? 'By Source' : 'By Period'}
              </button>
            ))}
          </div>

          {scope === 'by_source' && (
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-slate-500 w-16 shrink-0">Source</span>
              <select
                className="input h-8 text-[12px] w-52"
                value={sourceRef}
                onChange={e => setSourceRef(e.target.value)}
              >
                {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {scope === 'by_period' && (
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-slate-500 w-16 shrink-0">Period</span>
              <input type="date" className="input h-8 text-[12px] w-36" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              <span className="text-slate-400 text-[12px]">—</span>
              <input type="date" className="input h-8 text-[12px] w-36" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
          )}

          {/* Dry-run toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setDryRun(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors relative ${dryRun ? 'bg-amber-400' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${dryRun ? 'left-5' : 'left-0.5'}`} />
            </div>
            <span className="text-[12px] font-medium text-slate-600">
              {dryRun ? 'Dry Run (preview only — no writes)' : 'Live Run (will write to database)'}
            </span>
          </label>

          {!dryRun && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-700">
              <AlertTriangle size={14} />
              Live mode will update journal entries. Scope: <strong>{scopeValue}</strong>
            </div>
          )}

          <button
            onClick={() => rebuild.mutate()}
            disabled={rebuild.isPending || (scope === 'by_period' && (!periodStart || !periodEnd))}
            className="flex items-center gap-2 px-4 py-2 rounded text-[13px] font-semibold text-white bg-[#0F2D5C] hover:bg-[#1a3d7c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <PlayCircle size={15} />
            {rebuild.isPending ? 'Running…' : dryRun ? 'Preview Run' : 'Execute Regeneration'}
          </button>
        </div>

        {/* Last run result */}
        {lastResult && (
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h2 className="text-[13px] font-bold text-slate-700 mb-3">
              {dryRun || lastResult.dry_run ? 'Preview Result' : 'Run Complete'}
            </h2>
            <div className="grid grid-cols-3 gap-4 mb-4">
              {[
                { label: 'Events Processed', value: lastResult.business_events_processed as number },
                { label: 'JEs Created',      value: lastResult.journal_entries_created as number },
                { label: 'Lines Updated',    value: lastResult.journal_entry_lines_created as number },
              ].map(k => (
                <div key={k.label} className="bg-slate-50 rounded p-3">
                  <p className="text-[11px] text-slate-400 uppercase tracking-wider">{k.label}</p>
                  <p className="text-[20px] font-bold text-[#0F2D5C] mt-1">{fmt(k.value ?? 0)}</p>
                </div>
              ))}
            </div>

            {Array.isArray(lastResult.errors) && (lastResult.errors as string[]).length > 0 && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                <p className="text-[12px] font-semibold text-red-700 mb-1.5 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {(lastResult.errors as string[]).length} errors
                </p>
                <ul className="space-y-0.5 max-h-32 overflow-auto">
                  {(lastResult.errors as string[]).map((e, i) => (
                    <li key={i} className="text-[11px] text-red-600 font-mono">{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {(lastResult.dry_run || dryRun) && Array.isArray(lastResult.preview) && (
              <div className="mt-3">
                <p className="text-[11px] text-slate-400 mb-1.5">Preview (first 5 events):</p>
                <pre className="text-[10px] bg-slate-50 rounded p-2 overflow-auto max-h-40 text-slate-600">
                  {JSON.stringify(lastResult.preview, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {rebuild.isError && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded text-[12px] text-red-700 flex items-center gap-2">
            <AlertTriangle size={14} /> {(rebuild.error as Error)?.message ?? 'Regeneration failed'}
          </div>
        )}
      </div>
    </div>
  );
}
