import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { reportsApi, configApi } from '../../api/client';
import type { Season } from '../../types';

const GROUP_LABELS: Record<string, string> = {
  MECHANIZATION: 'Mechanization',
  LABOR:         'Labor',
  SUPPLY:        'Supply / Inventory',
  SUPERVISION:   'Supervision',
  LOGISTICS:     'Logistics',
  SPARE_PARTS:   'Spare Parts',
  OTHER:         'Other',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

function pct(val: number, total: number) {
  if (!total) return '—';
  return `${Math.round((val / total) * 100)}%`;
}

function exportCsv(groups: string[], rows: Array<{ center_name: string; by_service_group: Record<string, number>; total: number }>) {
  const header = ['Cost Center', ...groups.map(g => GROUP_LABELS[g] ?? g), 'Total'].join(',');
  const lines  = rows.map(r =>
    [
      `"${r.center_name}"`,
      ...groups.map(g => r.by_service_group[g] ?? 0),
      r.total,
    ].join(',')
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `pivot-costs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

export default function PivotCostsPage() {
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [showMeta, setShowMeta] = useState(false);

  const { data: seasons } = useQuery({
    queryKey: ['seasons-list'],
    queryFn:  () => configApi.seasons() as Promise<Season[]>,
  });

  useEffect(() => {
    if (seasons && (seasons as Season[]).length > 0 && !seasonId) {
      setSeasonId((seasons as Season[])[0].id);
    }
  }, [seasons, seasonId]);

  const { data, isLoading } = useQuery({
    queryKey: ['pivot-costs', seasonId],
    queryFn:  () => reportsApi.pivotCosts(seasonId!),
    enabled:  seasonId != null,
  });

  const { data: svcData, isLoading: svcLoading } = useQuery({
    queryKey: ['service-type-summary', seasonId],
    queryFn:  () => reportsApi.serviceTypeSummary(seasonId!),
    enabled:  seasonId != null,
  });

  const groups = data?.service_groups ?? [];
  const rows   = data?.rows ?? [];
  const meta   = data?.meta;

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-bold text-[#0F2D5C]">Pivot Cost Matrix</h1>
            <p className="text-[12px] text-slate-500 mt-0.5">Cost breakdown by pivot (cost center) × service type</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="input h-8 text-[12px] w-48"
              value={seasonId ?? ''}
              onChange={e => setSeasonId(Number(e.target.value))}
            >
              {((seasons as Season[]) ?? []).map((s: Season) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              onClick={() => exportCsv(groups, rows)}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100 rounded border border-slate-200 disabled:opacity-40"
            >
              <Download size={13} /> Export
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        
        {/* Coverage Banner */}
        {meta && (
          <div 
            className={`px-4 py-2 rounded-lg border flex items-center justify-between cursor-pointer transition-colors ${
              Number(meta.coverage_pct) === 100 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                : Number(meta.coverage_pct) >= 95 
                  ? 'bg-amber-50 border-amber-200 text-amber-700' 
                  : 'bg-red-50 border-red-200 text-red-700'
            }`}
            onClick={() => setShowMeta(true)}
          >
            <div className="flex items-center gap-2 text-[12px] font-medium">
              {Number(meta.coverage_pct) === 100 ? (
                <><span>✓</span> يشمل 100% من الحركات</>
              ) : (
                <>
                  <span>⚠</span> يشمل {meta.coverage_pct}% من الحركات — {meta.excluded_movements} حركة مستبعدة
                </>
              )}
            </div>
            <button className="text-[11px] underline opacity-70 hover:opacity-100">التفاصيل</button>
          </div>
        )}

        {/* Coverage Modal */}
        {showMeta && meta && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-800">تفاصيل تغطية البيانات</h3>
                <button onClick={() => setShowMeta(false)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">إجمالي الحركات</p>
                    <p className="text-[18px] font-bold text-slate-700 tabular-nums">{meta.total_movements}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-lg">
                    <p className="text-[10px] text-emerald-600 uppercase font-bold mb-1">المشمولة</p>
                    <p className="text-[18px] font-bold text-emerald-700 tabular-nums">{meta.included_movements}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-slate-500 mb-2">أسباب الاستبعاد:</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[12px] p-2 hover:bg-slate-50 rounded transition-colors">
                      <span className="text-slate-600">بدون مركز تكلفة (center_code is null)</span>
                      <span className="font-bold text-red-600">{meta.excluded_reasons.null_center_code}</span>
                    </div>
                    <div className="flex justify-between text-[12px] p-2 hover:bg-slate-50 rounded transition-colors">
                      <span className="text-slate-600">بدون تصنيف خدمة (service_type_code is null)</span>
                      <span className="font-bold text-amber-600">{meta.excluded_reasons.null_service_type_code}</span>
                    </div>
                    <div className="flex justify-between text-[12px] p-2 hover:bg-slate-50 rounded transition-colors">
                      <span className="text-slate-600">خارج نطاق الموسم (season_id is null)</span>
                      <span className="font-bold text-slate-600">{meta.excluded_reasons.null_season_id}</span>
                    </div>
                    <div className="flex justify-between text-[12px] p-2 hover:bg-slate-50 rounded transition-colors">
                      <span className="text-slate-600">حركات مستقبلية</span>
                      <span className="font-bold text-slate-600">{meta.excluded_reasons.future_blocked}</span>
                    </div>
                  </div>
                </div>
                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <button 
                    onClick={() => setShowMeta(false)}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg text-[12px] font-bold hover:bg-slate-700"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Grand total KPIs */}
        {data && (
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-1">Total Season Cost</p>
              <p className="text-[22px] font-bold text-[#0F2D5C]">{fmt(data.grand_total)}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{rows.length} pivots active</p>
            </div>
            {groups.slice(0, 3).map(g => (
              <div key={g} className="bg-white rounded-lg border border-slate-200 p-4">
                <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-1">{GROUP_LABELS[g] ?? g}</p>
                <p className="text-[22px] font-bold text-[#0F2D5C]">{fmt(data.column_totals[g] ?? 0)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{pct(data.column_totals[g] ?? 0, data.grand_total)} of total</p>
              </div>
            ))}
          </div>
        )}

        {/* Pivot cost matrix table */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-[13px] font-bold text-slate-700">Cost by Pivot × Service Type</h2>
          </div>
          {isLoading ? (
            <div className="px-4 py-8 text-center text-slate-400 text-[12px]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-400 text-[12px]">No cost data for this season</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider sticky left-0 bg-slate-50">Pivot / Center</th>
                  {groups.map(g => (
                    <th key={g} className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {GROUP_LABELS[g] ?? g}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-700 uppercase tracking-wider">Total</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">% of Season</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(row => (
                  <tr key={row.center_code} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 sticky left-0 bg-white hover:bg-slate-50">
                      <p className="font-medium text-slate-800">{row.center_name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{row.center_code}</p>
                    </td>
                    {groups.map(g => (
                      <td key={g} className="px-4 py-2.5 tabular-nums text-right text-slate-600">
                        {row.by_service_group[g] ? fmt(row.by_service_group[g]) : '—'}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 tabular-nums text-right font-bold text-slate-800">{fmt(row.total)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-right text-slate-500">
                      {pct(row.total, data?.grand_total ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {data && (
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2.5 text-[11px] font-bold text-slate-600 uppercase">Total</td>
                    {groups.map(g => (
                      <td key={g} className="px-4 py-2.5 tabular-nums text-right font-bold text-slate-700">
                        {fmt(data.column_totals[g] ?? 0)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 tabular-nums text-right font-bold text-[#0F2D5C] text-[13px]">{fmt(data.grand_total)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400 text-[11px]">100%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>

        {/* Service type GL reconciliation */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-[13px] font-bold text-slate-700">Service Type — GL Reconciliation</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Ops sub-ledger vs. posted GL entries — gap highlights unposted transactions</p>
          </div>
          {svcLoading ? (
            <div className="px-4 py-6 text-center text-slate-400 text-[12px]">Loading…</div>
          ) : !svcData ? null : (
            <>
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Service Type', 'Group', 'Ops Total', 'GL Total', 'Gap', 'Gap %', 'Txns'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {svcData.rows.map(row => (
                    <tr key={row.service_type_code} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{row.name_ar}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{row.service_type_code}</p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{GROUP_LABELS[row.service_group] ?? row.service_group}</td>
                      <td className="px-4 py-2.5 tabular-nums font-medium text-slate-800">{fmt(row.ops_total)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">{fmt(row.gl_total)}</td>
                      <td className={`px-4 py-2.5 tabular-nums font-medium ${Math.abs(row.gap) > 1 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {Math.abs(row.gap) > 0.01 ? fmt(row.gap) : '✓'}
                      </td>
                      <td className={`px-4 py-2.5 tabular-nums ${Math.abs(row.gap_pct) > 5 ? 'text-amber-600 font-bold' : 'text-slate-500'}`}>
                        {Math.abs(row.gap) > 0.01 ? `${row.gap_pct}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-500">{row.txn_count}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td colSpan={2} className="px-4 py-2.5 text-[11px] font-bold text-slate-600 uppercase">Total</td>
                    <td className="px-4 py-2.5 tabular-nums font-bold text-slate-800">{fmt(svcData.totals.ops_total)}</td>
                    <td className="px-4 py-2.5 tabular-nums font-bold text-slate-700">{fmt(svcData.totals.gl_total)}</td>
                    <td className={`px-4 py-2.5 tabular-nums font-bold ${Math.abs(svcData.totals.gap) > 1 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {Math.abs(svcData.totals.gap) > 0.01 ? fmt(svcData.totals.gap) : '✓'}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
