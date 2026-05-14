import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Download, RefreshCw } from 'lucide-react';
import { suppliersApi } from '../../api/client';

// Shape returned by GET /suppliers/aging-summary (payments.ts)
interface AgingRow {
  supplier_code:   string;
  supplier_name:   string;
  current_amt:     number;
  d1_30:           number;
  d31_60:          number;
  d61_90:          number;
  d90_plus:        number;
  total_outstanding: number;
}

interface AgingSummaryResponse {
  suppliers: AgingRow[];
  as_of:     string;
  totals:    { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number };
}

interface OpenItem {
  id:              number;
  txn_date:        string;
  invoice_ref:     string | null;
  description:     string;
  amount:          number;
  days_outstanding: number;
  aging_bucket:    string;
}

interface OpenItemsResponse {
  open_items:        OpenItem[];
  total_outstanding: number;
  gl_ap_balance:     number;
  reconciliation_gap: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function bucketColor(bucket: string) {
  if (bucket === 'current')  return 'text-emerald-600';
  if (bucket === '1-30')     return 'text-sky-600';
  if (bucket === '31-60')    return 'text-amber-500';
  if (bucket === '61-90')    return 'text-orange-500';
  return 'text-red-600';
}

function exportCsv(rows: AgingRow[]) {
  const header = 'Supplier Code,Supplier Name,Current,1-30d,31-60d,61-90d,90d+,Total Outstanding';
  const lines = rows.map(r =>
    [r.supplier_code, `"${r.supplier_name}"`, r.current_amt ?? 0, r.d1_30 ?? 0, r.d31_60 ?? 0, r.d61_90 ?? 0, r.d90_plus ?? 0, r.total_outstanding ?? 0].join(',')
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `ap-aging-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function OpenItemsPanel({ code, onClose }: { code: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['supplier-open-items', code],
    queryFn:  () => suppliersApi.supplierOpenItems(code) as Promise<OpenItemsResponse>,
  });

  const items = data?.open_items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
      <div className="bg-white rounded-t-xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-[14px] font-bold text-[#0F2D5C]">Open Items — {code}</h2>
            {data && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                Total outstanding: <strong>{fmt(data.total_outstanding)}</strong>
                {Math.abs(data.reconciliation_gap) > 0.01 && (
                  <span className="ml-2 text-amber-600">
                    GL gap: {fmt(data.reconciliation_gap)}
                  </span>
                )}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-[20px] leading-none">&times;</button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-[13px]">Loading…</div>
          ) : items.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-[13px]">No open items</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  {['Date', 'Invoice Ref', 'Description', 'Amount', 'Days', 'Bucket'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{item.txn_date}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{item.invoice_ref ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-700 max-w-[200px] truncate">{item.description}</td>
                    <td className="px-4 py-2.5 tabular-nums text-right font-medium text-slate-800">{fmt(item.amount)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-right text-slate-600">{item.days_outstanding}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] font-bold ${bucketColor(item.aging_bucket)}`}>{item.aging_bucket}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function APAgingPage() {
  const navigate = useNavigate();
  const [drillCode, setDrillCode] = useState<string | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['ap-aging-summary'],
    queryFn:  () => suppliersApi.agingSummary() as Promise<AgingSummaryResponse>,
  });

  const rows = data?.suppliers ?? [];

  const totals = data?.totals ?? rows.reduce(
    (acc, r) => ({
      current:           acc.current           + (r.current_amt ?? 0),
      d1_30:             acc.d1_30             + (r.d1_30       ?? 0),
      d31_60:            acc.d31_60            + (r.d31_60      ?? 0),
      d61_90:            acc.d61_90            + (r.d61_90      ?? 0),
      d90_plus:          acc.d90_plus          + (r.d90_plus    ?? 0),
      total:             acc.total             + (r.total_outstanding ?? 0),
    }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 }
  );

  const overdueTotal = (totals.d31_60 ?? 0) + (totals.d61_90 ?? 0) + (totals.d90_plus ?? 0);
  const overduePct   = (totals.total ?? 0) > 0
    ? Math.round((overdueTotal / (totals.total ?? 1)) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-1">
              <button onClick={() => navigate('/suppliers')} className="hover:text-slate-600">Suppliers</button>
              <ChevronRight size={12} />
              <span className="text-slate-600 font-medium">AP Aging</span>
            </div>
            <h1 className="text-[18px] font-bold text-[#0F2D5C]">Accounts Payable Aging</h1>
            {data?.as_of && (
              <p className="text-[12px] text-slate-500 mt-0.5">As of {data.as_of}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCsv(rows)}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100 rounded border border-slate-200 disabled:opacity-40"
            >
              <Download size={13} /> Export CSV
            </button>
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
            >
              <RefreshCw size={13} className={isRefetching ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-2">Total Outstanding</p>
            <p className="text-[24px] font-bold text-[#0F2D5C]">{isLoading ? '…' : fmt(totals.total ?? 0)}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{rows.length} suppliers</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-2">Overdue (31d+)</p>
            <p className={`text-[24px] font-bold ${overdueTotal > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {isLoading ? '…' : fmt(overdueTotal)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">{overduePct}% of total</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-2">Current (≤30d)</p>
            <p className="text-[24px] font-bold text-emerald-600">
              {isLoading ? '…' : fmt((totals.current ?? 0) + (totals.d1_30 ?? 0))}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">{100 - overduePct}% of total</p>
          </div>
        </div>

        {/* Overdue alert */}
        {!isLoading && overdueTotal > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-700">
            <AlertTriangle size={14} />
            {fmt(overdueTotal)} overdue across {rows.filter(r => (r.d31_60 ?? 0) + (r.d61_90 ?? 0) + (r.d90_plus ?? 0) > 0).length} suppliers
          </div>
        )}

        {/* Aging table */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Supplier</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-emerald-600 uppercase tracking-wider">Current</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-sky-600 uppercase tracking-wider">1–30d</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-amber-500 uppercase tracking-wider">31–60d</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-orange-500 uppercase tracking-wider">61–90d</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-red-600 uppercase tracking-wider">90d+</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-600 uppercase tracking-wider">Total</th>
                <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Risk</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No open payables</td></tr>
              ) : (
                rows.map(row => {
                  const overdue = (row.d31_60 ?? 0) + (row.d61_90 ?? 0) + (row.d90_plus ?? 0);
                  const risk = (row.d90_plus ?? 0) > 0 ? 'high' : overdue > 0 ? 'medium' : 'ok';
                  return (
                    <tr
                      key={row.supplier_code}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => setDrillCode(row.supplier_code)}
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{row.supplier_name}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{row.supplier_code}</p>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-right text-emerald-700">{(row.current_amt ?? 0) > 0 ? fmt(row.current_amt) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-right text-sky-700">{(row.d1_30 ?? 0) > 0 ? fmt(row.d1_30) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-right text-amber-600">{(row.d31_60 ?? 0) > 0 ? fmt(row.d31_60) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-right text-orange-600">{(row.d61_90 ?? 0) > 0 ? fmt(row.d61_90) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-right text-red-600 font-medium">{(row.d90_plus ?? 0) > 0 ? fmt(row.d90_plus) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-right font-bold text-slate-800">{fmt(row.total_outstanding ?? 0)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          risk === 'high'   ? 'bg-red-100 text-red-700' :
                          risk === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-emerald-100 text-emerald-700'
                        }`}>
                          {risk === 'high' ? 'HIGH' : risk === 'medium' ? 'MED' : 'OK'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-300 hover:text-slate-500">
                        <ChevronRight size={14} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Totals row */}
            {rows.length > 0 && (
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td className="px-4 py-2.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider">Total</td>
                  <td className="px-4 py-2.5 tabular-nums text-right font-bold text-emerald-700">{fmt(totals.current ?? 0)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-right font-bold text-sky-700">{fmt(totals.d1_30 ?? 0)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-right font-bold text-amber-600">{fmt(totals.d31_60 ?? 0)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-right font-bold text-orange-600">{fmt(totals.d61_90 ?? 0)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-right font-bold text-red-600">{fmt(totals.d90_plus ?? 0)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-right font-bold text-slate-800 text-[13px]">{fmt(totals.total ?? 0)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {drillCode && (
        <OpenItemsPanel code={drillCode} onClose={() => setDrillCode(null)} />
      )}
    </div>
  );
}
