import { useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, GitBranch, ChevronLeft, ChevronRight } from 'lucide-react';
import { glApi, downloadCsv } from '../../api/client';
import GlEntryTraceDrawer from '../../components/gl/GlEntryTraceDrawer';
import { KpiStrip, KpiItem } from '../../components/ui/KpiStrip';
import { CommandBar, CommandAction } from '../../components/shell/CommandBar';
import StatusBadge from '../../components/ui/StatusBadge';

interface LedgerLine {
  id:              number;
  entry_id:        number;
  account_code:    string;
  debit:           number;
  credit:          number;
  narration:       string | null;
  entry_date:      string;
  entry_desc:      string | null;
  ref_type:        string | null;
  ref_id:          number | null;
  running_balance: number;
  business_event_id?: number | null;
  has_trace?: boolean;
  entry_trace_path?: string;
}

interface Account {
  code:           string;
  name:           string;
  account_type:   string;
  normal_balance: string;
  level:          number;
  is_header:      number;
}

const REF_SOURCE_MAP: Record<string, 'cash' | 'manual' | 'inventory' | 'payroll'> = {
  cash_transaction:     'cash',
  supplier_transaction: 'manual',
  inventory_movement:   'inventory',
  manual:               'manual',
};

const TYPE_LABELS: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity',
  revenue: 'Revenue', expense: 'Expense',
};

function fmt(n: number) {
  if (!n) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function startOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

export default function AccountLedgerPage() {
  const { code } = useParams<{ code: string }>();
  const navigate  = useNavigate();

  const [start, setStart]     = useState(startOfYear());
  const [end,   setEnd]       = useState(today());
  const [search, setSearch]   = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [refType, setRefType] = useState('');
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [jumpInput, setJumpInput] = useState('');

  // Debounce search — only send to server after user stops typing 400ms
  const commitSearch = useCallback((val: string) => {
    setSearch(val);
    setPage(1);
  }, []);

  const [traceOpen, setTraceOpen] = useState(false);
  const [traceEntryId, setTraceEntryId] = useState<number | null>(null);
  const [traceTab, setTraceTab] = useState<'source' | 'lines' | 'trace'>('source');

  const { data, isLoading } = useQuery({
    queryKey: ['gl-ledger', code, start, end, search, refType, page, pageSize],
    queryFn:  () => glApi.ledger(code!, start || undefined, end || undefined, page, pageSize, search || undefined, refType || undefined) as Promise<{
      account:                Account;
      lines:                  LedgerLine[];
      total:                  number;
      page:                   number;
      size:                   number;
      total_pages:            number;
      opening_balance:        number;
      search_applied:         string | null;
      ref_type_filter:        string | null;
      matches_on_other_pages: number;
    }>,
    enabled: !!code,
  });

  const { data: traceData, isFetching: traceLoading, isError: traceIsError, error: traceError } = useQuery({
    queryKey: ['gl-entry-trace', traceEntryId],
    queryFn:  () => glApi.entryTrace(traceEntryId!),
    enabled:  !!traceEntryId && traceOpen,
  });

  const account        = data?.account;
  const lines          = data?.lines ?? [];
  const totalPages     = data?.total_pages ?? 1;
  const openingBalance        = data?.opening_balance ?? 0;
  const matchesOnOtherPages   = data?.matches_on_other_pages ?? 0;

  // Server already filtered — use lines directly
  const filteredLines = lines;
  const totalDebit    = filteredLines.reduce((s, l) => s + (l.debit  ?? 0), 0);
  const totalCredit   = filteredLines.reduce((s, l) => s + (l.credit ?? 0), 0);
  const netBalance    = totalDebit - totalCredit;

  const kpiItems: KpiItem[] = [
    { id: 'ob', label: 'OPENING BALANCE', value: fmt(openingBalance) || '0.00' },
    { id: 'dr', label: 'TOTAL DEBITS', value: fmt(totalDebit) || '0.00', variant: 'default' },
    { id: 'cr', label: 'TOTAL CREDITS', value: fmt(totalCredit) || '0.00' },
    { id: 'net', label: 'CLOSING BALANCE', value: fmt(Math.abs(netBalance)) || '0.00', variant: netBalance >= 0 ? 'success' : 'warning' },
  ];

  const actions: CommandAction[] = [
    { id: 'back', label: 'Back to CoA', icon: <ArrowLeft />, onClick: () => navigate('/gl/accounts'), variant: 'ghost' },
    { id: 'sep', isSeparator: true },
    { id: 'export', label: 'Export CSV', icon: <Download />, variant: 'secondary', onClick: () => downloadCsv(`/gl/ledger/${code}`, `ledger-${code}`, { start, end }) },
  ];

  const rightSlot = (
    <div className="flex items-center gap-3">
      <input type="date" className="input h-8 text-[12px] py-1 w-32" value={start} onChange={e => { setStart(e.target.value); setPage(1); }} />
      <span className="text-slate-400">—</span>
      <input type="date" className="input h-8 text-[12px] py-1 w-32" value={end} onChange={e => { setEnd(e.target.value); setPage(1); }} />
      <input
        className="input h-8 w-48 text-[12px]"
        placeholder="Search narration or entry ID..."
        value={searchInput}
        onChange={e => setSearchInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commitSearch(searchInput); }}
        onBlur={() => commitSearch(searchInput)}
      />
      <select className="input h-8 text-[12px] py-1 w-32" value={refType} onChange={e => { setRefType(e.target.value); setPage(1); }}>
        <option value="">All Sources</option>
        <option value="cash_transaction">Cash</option>
        <option value="supplier_transaction">Supplier</option>
        <option value="inventory_movement">Inventory</option>
        <option value="manual">Manual</option>
      </select>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] relative">
      {/* Page Header */}
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">
            Account Ledger
            {account && <span className="font-mono text-slate-400 text-[16px] ml-2">/ {account.code}</span>}
          </h1>
          {account && (
            <p className="text-[12px] text-slate-500 mt-0.5">
              {account.name} · {TYPE_LABELS[account.account_type] ?? account.account_type}
            </p>
          )}
        </div>
      </div>

      <CommandBar actions={actions} rightSlot={rightSlot} />
      <KpiStrip items={kpiItems} />

      {/* Other-page match banner */}
      {(search || refType) && matchesOnOtherPages > 0 && (
        <div className="mx-6 mt-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-700 flex items-center gap-2">
          <span className="font-semibold">{matchesOnOtherPages.toLocaleString()} more matches</span>
          on other pages — use pagination to navigate, or narrow the date range.
        </div>
      )}
      {(search || refType) && data && data.total !== undefined && (
        <div className="mx-6 mt-2 text-[11px] text-slate-400">
          {data.total.toLocaleString()} total matches for current filter
          {search && <span> · search: <em>"{search}"</em></span>}
          {refType && <span> · source: <em>{refType}</em></span>}
        </div>
      )}

      {/* Ledger Table */}
      <div className="flex-1 p-6 overflow-hidden flex flex-col">
        <div className="bg-white rounded border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex-1 p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
              ))}
            </div>
          ) : filteredLines.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              <p className="text-[13px]">No transactions found for the selected period.</p>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold text-slate-500 uppercase tracking-wider text-[11px] w-28">Date</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-500 uppercase tracking-wider text-[11px]">Narration</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-500 uppercase tracking-wider text-[11px] w-28">Source</th>
                      <th className="px-4 py-3 text-left font-bold text-slate-500 uppercase tracking-wider text-[11px] w-28">Entry</th>
                      <th className="px-4 py-3 text-right font-bold text-slate-500 uppercase tracking-wider text-[11px] w-32">Debit</th>
                      <th className="px-4 py-3 text-right font-bold text-slate-500 uppercase tracking-wider text-[11px] w-32">Credit</th>
                      <th className="px-4 py-3 text-right font-bold text-slate-500 uppercase tracking-wider text-[11px] w-36">Running Bal.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {page > 1 && (
                      <tr className="bg-blue-50/50">
                        <td colSpan={6} className="px-4 py-2 text-[11px] text-slate-400 italic">
                          Carried forward balance (prev. pages)
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className={`font-bold text-[12px] ${openingBalance >= 0 ? 'text-slate-700' : 'text-red-600'}`}>
                            {fmt(Math.abs(openingBalance))}
                            <span className="text-[10px] font-normal text-slate-400 ml-1">{openingBalance >= 0 ? 'Dr' : 'Cr'}</span>
                          </span>
                        </td>
                      </tr>
                    )}
                    {filteredLines.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-slate-500 text-[11px]">
                          {new Date(l.entry_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="text-slate-700 font-medium truncate max-w-xs" title={l.narration || l.entry_desc || ''}>
                            {l.narration || l.entry_desc || '—'}
                          </p>
                          {l.narration && l.entry_desc && l.narration !== l.entry_desc && (
                            <p className="text-[10px] text-slate-400 truncate max-w-xs">{l.entry_desc}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {l.ref_type
                            ? <StatusBadge type="source" variant={REF_SOURCE_MAP[l.ref_type] ?? 'manual'} />
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/gl/entries?id=${l.entry_id}`}
                              className="font-mono text-[#0F2D5C] hover:underline text-[11px] font-semibold"
                            >
                              #{l.entry_id}
                            </Link>
                            {l.has_trace && (
                              <button
                                onClick={() => { setTraceEntryId(l.entry_id); setTraceOpen(true); setTraceTab('source'); }}
                                className="inline-flex items-center gap-0.5 text-[10px] text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 px-1 py-0.5 rounded"
                                title="Open entry trace"
                              >
                                <GitBranch size={11} /> Trace
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {l.debit > 0
                            ? <span className="font-medium text-[#0F2D5C]">{fmt(l.debit)}</span>
                            : <span className="text-slate-200">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {l.credit > 0
                            ? <span className="font-medium text-red-600">{fmt(l.credit)}</span>
                            : <span className="text-slate-200">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <span className={`font-bold text-[12px] ${l.running_balance >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                            {fmt(Math.abs(l.running_balance))}
                            <span className="text-[10px] font-normal text-slate-400 ml-1">
                              {l.running_balance >= 0 ? 'Dr' : 'Cr'}
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 font-bold text-slate-600 text-[12px]">Page Total</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-[#0F2D5C]">{fmt(totalDebit)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-red-600">{fmt(totalCredit)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold">
                        <span className={netBalance >= 0 ? 'text-[#1D9E75]' : 'text-red-600'}>
                          {fmt(Math.abs(netBalance))}
                          <span className="text-[10px] font-normal ml-1">{netBalance >= 0 ? 'Dr' : 'Cr'}</span>
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-between bg-white shrink-0">
                  <button
                    className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft size={14} /> Previous
                  </button>
                  <form
                    className="flex items-center gap-2 text-[12px]"
                    onSubmit={e => {
                      e.preventDefault();
                      const n = parseInt(jumpInput, 10);
                      if (n >= 1 && n <= totalPages) { setPage(n); setJumpInput(''); }
                    }}
                  >
                    <span className="text-slate-500">Page</span>
                    <input
                      type="number" min={1} max={totalPages}
                      className="input w-14 text-center h-7 text-[12px] py-0"
                      placeholder={String(page)}
                      value={jumpInput}
                      onChange={e => setJumpInput(e.target.value)}
                    />
                    <span className="text-slate-400">of {totalPages}</span>
                    {data?.total != null && <span className="text-slate-400">({data.total.toLocaleString()} lines)</span>}
                    <select
                      className="input h-7 text-[12px] py-0 w-20 ml-2"
                      value={pageSize}
                      onChange={e => { setPageSize(Number(e.target.value)); setPage(1); setJumpInput(''); }}
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                  </form>
                  <button
                    className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <GlEntryTraceDrawer
        isOpen={traceOpen && !!traceEntryId}
        loading={traceLoading}
        errorMessage={traceIsError ? ((traceError as Error)?.message || 'Failed to load trace data') : undefined}
        tab={traceTab}
        onTabChange={setTraceTab}
        onClose={() => { setTraceOpen(false); setTraceEntryId(null); }}
        trace={traceData as any}
      />
    </div>
  );
}
