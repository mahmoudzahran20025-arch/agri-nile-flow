import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Plus, Download, GitBranch, CheckCircle2, X, CornerDownRight, Search, Calendar, Filter, XCircle } from 'lucide-react';
import { glApi, configApi } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import NewEntryForm from '../../components/gl/NewEntryForm';
import GlEntryTraceDrawer from '../../components/gl/GlEntryTraceDrawer';
import { KpiStrip, KpiItem } from '../../components/ui/KpiStrip';
import { CommandBar, CommandAction } from '../../components/shell/CommandBar';
import DataTable, { Column, SortState } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';

interface JournalEntry {
  id: number; entry_date: string; description: string; entry_number?: string;
  ref_type?: string; ref_id?: number; period_name?: string;
  total_debit: number; total_credit: number; is_posted: number;
  reversal_entry_id?: number | null;
}
interface EntryLine {
  account_code: string; account_name?: string; debit: number; credit: number;
  description?: string; rule_slot?: string;
}
interface EntryDetail extends JournalEntry {
  lines: EntryLine[];
  posting_rule_trace?: string | null;
}

function fmt(n: number) { return Number(n || 0).toLocaleString('en-US'); }

export default function JournalEntriesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: 'entry_date', dir: 'desc' });
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'All' | 'Posted' | 'Drafts' | 'Voided' | 'Reversals'>('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [fyFilter, setFyFilter] = useState('');
  const [expenseFilter, setExpenseFilter] = useState('');
  const [centerFilter, setCenterFilter] = useState('');

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(timer);
  }, [search]);

  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const idParam = searchParams.get('id');
    return idParam ? Number(idParam) : null;
  });
  const [showNew, setShowNew] = useState(false);
  const [traceOpen, setTraceOpen] = useState(() => searchParams.get('trace') === '1');
  const [traceTab, setTraceTab] = useState<'source' | 'lines' | 'trace'>('source');

  useEffect(() => {
    if (selectedId != null) {
      setSearchParams(p => { p.set('id', String(selectedId)); return p; }, { replace: true });
    } else {
      setSearchParams(p => { p.delete('id'); return p; }, { replace: true });
      setTraceOpen(false);
    }
  }, [selectedId, setSearchParams]);

  const reverseMutation = useMutation({
    mutationFn: (id: number) => glApi.reverseEntry(id),
    onSuccess: () => {
      toast('Reversal entry created successfully', 'success');
      qc.invalidateQueries({ queryKey: ['gl-entries'] });
      qc.invalidateQueries({ queryKey: ['gl-entry', selectedId] });
    },
    onError: (err: any) => toast(err?.message || err?.error || 'Failed to reverse entry', 'error'),
  });

  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['config', 'expense-types'],
    queryFn: () => configApi.expenseTypes() as Promise<{ code: number; name: string }[]>,
    staleTime: 300_000,
  });

  const { data: costCenters = [] } = useQuery({
    queryKey: ['config', 'cost-centers'],
    queryFn: () => configApi.costCenters() as Promise<{ code: number; name: string }[]>,
    staleTime: 300_000,
  });

  const { data: entriesData, isLoading } = useQuery({
    queryKey: ['gl-entries', page, sourceFilter, fyFilter, debouncedSearch, startDate, endDate, expenseFilter, centerFilter],
    queryFn: () => glApi.entries({
      page,
      size: 50,
      ref_type: sourceFilter || undefined,
      search: debouncedSearch || undefined,
      start: startDate || undefined,
      end: endDate || undefined,
      expense_code: expenseFilter ? Number(expenseFilter) : undefined,
      center_code: centerFilter || undefined,
    }),
  });

  const rawEntries = ((entriesData as any)?.data ?? []) as JournalEntry[];
  const total = (entriesData as any)?.total ?? 0;

  const entries = useMemo(() => {
    let filtered = rawEntries;
    if (tab === 'Posted') filtered = filtered.filter(e => e.is_posted === 1 && !e.reversal_entry_id);
    if (tab === 'Drafts') filtered = filtered.filter(e => e.is_posted === 0);
    if (tab === 'Reversals') filtered = filtered.filter(e => !!e.reversal_entry_id);

    return filtered.sort((a, b) => {
      const av = sort.key === 'total_debit' ? a.total_debit : a.entry_date;
      const bv = sort.key === 'total_debit' ? b.total_debit : b.entry_date;
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rawEntries, tab, sort]);

  const totals = useMemo(() => {
    const debit = rawEntries.reduce((s, e) => s + Number(e.total_debit || 0), 0);
    const credit = rawEntries.reduce((s, e) => s + Number(e.total_credit || 0), 0);
    return { debit, credit };
  }, [rawEntries]);

  const { data: detail } = useQuery({
    queryKey: ['gl-entry', selectedId],
    queryFn: () => glApi.getEntry(selectedId!),
    enabled: !!selectedId,
  }) as { data?: EntryDetail };

  const { data: traceData, isFetching: traceLoading, isError: traceIsError, error: traceError } = useQuery({
    queryKey: ['gl-entry-trace', selectedId],
    queryFn: () => glApi.entryTrace(selectedId!),
    enabled: !!selectedId && traceOpen,
  });

  const columns: Column<JournalEntry>[] = [
    {
      key: 'entry_number',
      header: 'Entry No.',
      render: (row) => <span className="text-[#0F2D5C] font-semibold">#{row.entry_number || row.id}</span>
    },
    { key: 'entry_date', header: 'Date', sortable: true, width: '120px' },
    { key: 'description', header: 'Description', sortable: true },
    {
      key: 'ref_type',
      header: 'Source',
      sortable: true,
      render: (row) => <StatusBadge type="source" variant={(row.ref_type?.replace('_transaction', '')?.replace('_movement', '') || 'manual') as any} />
    },
    {
      key: 'total_debit',
      header: 'Debit',
      align: 'right',
      render: (row) => <span className="text-[#0F2D5C] font-mono font-medium">{fmt(row.total_debit)}</span>,
      sortable: true
    },
    {
      key: 'total_credit',
      header: 'Credit',
      align: 'right',
      render: (row) => <span className="text-red-600 font-mono font-medium">{fmt(row.total_credit)}</span>,
      sortable: true
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge 
          type="status" 
          variant={row.reversal_entry_id ? 'reversed' : row.is_posted ? 'posted' : 'draft'} 
        />
      )
    }
  ];

  const kpiItems: KpiItem[] = [
    { id: 'total', label: 'TOTAL ENTRIES', value: total.toLocaleString('en-US') },
    { id: 'posted', label: 'POSTED (PAGE)', value: rawEntries.filter(e => e.is_posted).length, variant: 'success' },
    { id: 'pending', label: 'PENDING (PAGE)', value: rawEntries.filter(e => !e.is_posted).length, variant: 'warning' },
    { id: 'balance', label: 'GL BALANCE (PAGE)', value: Math.abs(totals.debit - totals.credit) < 0.01 ? 'BALANCED' : 'UNBALANCED', variant: Math.abs(totals.debit - totals.credit) < 0.01 ? 'success' : 'warning' },
  ];

  const actions: CommandAction[] = [
    { id: 'new', label: 'New Entry', icon: <Plus />, variant: 'primary', onClick: () => setShowNew(true) },
    { id: 'sep1', isSeparator: true },
    { id: 'post', label: 'Post', disabled: !selectedId || detail?.is_posted === 1 },
    {
      id: 'void',
      label: 'Void / Reverse',
      onClick: () => selectedId && reverseMutation.mutate(selectedId),
      disabled: !selectedId || !detail?.is_posted || !!detail?.reversal_entry_id || reverseMutation.isPending,
    },
    {
      id: 'audit',
      label: 'Traceability',
      icon: <GitBranch />,
      onClick: () => {
        setTraceOpen(true);
        setTraceTab('source');
      },
      disabled: !selectedId,
    },
    { id: 'sep2', isSeparator: true },
    { id: 'export', label: 'Export', icon: <Download />, variant: 'secondary' },
  ];

  const rightSlot = (
    <div className="flex items-center gap-3 overflow-x-auto pb-2 pt-1 px-1 flex-1 justify-end no-scrollbar">
      <div className="flex items-center gap-3 shrink-0">
        
        {/* Search */}
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
            <Search size={14} />
          </div>
          <input
            type="text"
            className="block w-[220px] pl-9 pr-8 py-2 text-[12px] font-medium bg-slate-50/80 border border-slate-200/80 rounded-xl text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all shadow-sm"
            placeholder="Search descriptions or #..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setPage(1); }}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <XCircle size={14} />
            </button>
          )}
        </div>

        <div className="h-6 w-[1px] bg-slate-200" />

        {/* Date Range */}
        <div className="flex items-center gap-2 bg-slate-50/80 border border-slate-200/80 rounded-xl px-3 py-1.5 shadow-sm hover:bg-white hover:border-slate-300 transition-all">
          <Calendar size={14} className="text-indigo-400" />
          <input
            type="date"
            className="bg-transparent border-none p-0 text-[12px] font-semibold text-slate-700 focus:ring-0 w-28 cursor-pointer"
            value={startDate}
            onChange={e => { setStartDate(e.target.value); setPage(1); }}
          />
          <span className="text-slate-300 text-[10px] font-black tracking-widest">TO</span>
          <input
            type="date"
            className="bg-transparent border-none p-0 text-[12px] font-semibold text-slate-700 focus:ring-0 w-28 cursor-pointer"
            value={endDate}
            onChange={e => { setEndDate(e.target.value); setPage(1); }}
          />
        </div>

        <div className="h-6 w-[1px] bg-slate-200" />

        {/* Selects */}
        <div className="flex items-center gap-2">
          <select 
            className="text-[12px] py-2 pl-3 pr-8 bg-slate-50/80 border border-slate-200/80 rounded-xl text-slate-700 font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white appearance-none shadow-sm cursor-pointer hover:border-slate-300 transition-all"
            value={sourceFilter} 
            onChange={e => { setSourceFilter(e.target.value); setPage(1); }}
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2.5\' stroke=\'%2364748b\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M19 9l-7 7-7-7\' /%3E%3C/svg%3E")', backgroundPosition: 'right 0.6rem center', backgroundSize: '1em 1em', backgroundRepeat: 'no-repeat' }}
          >
            <option value="">All Sources</option>
            <option value="business_event">Business Event</option>
            <option value="cash_transaction">Cash (Treasury)</option>
            <option value="supplier_transaction">Supplier (A/P)</option>
            <option value="inventory_movement">Inventory</option>
            <option value="manual">Manual</option>
          </select>

          <select 
            className="text-[12px] py-2 pl-3 pr-8 bg-slate-50/80 border border-slate-200/80 rounded-xl text-slate-700 font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white appearance-none shadow-sm cursor-pointer hover:border-slate-300 transition-all"
            value={expenseFilter} 
            onChange={e => { setExpenseFilter(e.target.value); setPage(1); }}
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2.5\' stroke=\'%2364748b\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M19 9l-7 7-7-7\' /%3E%3C/svg%3E")', backgroundPosition: 'right 0.6rem center', backgroundSize: '1em 1em', backgroundRepeat: 'no-repeat' }}
          >
            <option value="">Expense Type</option>
            {expenseTypes.map(et => <option key={et.code} value={et.code}>{et.name}</option>)}
          </select>

          <select 
            className="text-[12px] py-2 pl-3 pr-8 bg-slate-50/80 border border-slate-200/80 rounded-xl text-slate-700 font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white appearance-none shadow-sm cursor-pointer hover:border-slate-300 transition-all"
            value={centerFilter} 
            onChange={e => { setCenterFilter(e.target.value); setPage(1); }}
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke-width=\'2.5\' stroke=\'%2364748b\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M19 9l-7 7-7-7\' /%3E%3C/svg%3E")', backgroundPosition: 'right 0.6rem center', backgroundSize: '1em 1em', backgroundRepeat: 'no-repeat' }}
          >
            <option value="">Cost Center</option>
            {costCenters.map(cc => <option key={cc.code} value={cc.code}>{cc.name}</option>)}
          </select>
        </div>

        {(search || startDate || endDate || sourceFilter || expenseFilter || centerFilter || fyFilter) && (
          <button
            onClick={() => {
              setSearch(''); setStartDate(''); setEndDate('');
              setSourceFilter(''); setExpenseFilter(''); setCenterFilter(''); setFyFilter(''); setPage(1);
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold text-red-500 bg-red-50 hover:bg-red-100 hover:text-red-700 rounded-xl transition-all shadow-sm ml-1"
          >
            <Filter size={14} /> Clear
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {showNew && (
        <NewEntryForm
          onCancel={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ['gl-entries'] });
          }}
        />
      )}

      {/* Page Header */}
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Journal Entries</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">{total.toLocaleString('en-US')} entries found in General Ledger</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-[12px] h-8 px-4">Import Data</button>
          <button className="btn-primary text-[12px] h-8 px-4" onClick={() => setShowNew(true)}>New Entry</button>
        </div>
      </div>

      <CommandBar actions={actions} rightSlot={rightSlot} />
      <KpiStrip items={kpiItems} />

      {/* Tabs */}
      <div className="px-6 pt-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex gap-6">
          {['All Entries', 'Posted', 'Drafts', 'Voided', 'Reversals'].map(t => (
            <button 
              key={t} 
              className={`pb-3 text-[13px] font-semibold transition-colors relative ${tab === t ? 'text-[#0F2D5C]' : 'text-slate-500 hover:text-slate-800'}`} 
              onClick={() => { setTab(t as Parameters<typeof setTab>[0]); setPage(1); setSelectedId(null); }}
            >
              {t}
              {tab === t && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[#0F2D5C] rounded-t-full" />}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex relative">
        <div className={`flex-1 p-6 min-h-0 flex flex-col transition-all duration-300 ${selectedId ? 'pl-4 pr-4' : ''}`}>
          <DataTable
            columns={columns}
            data={entries}
            loading={isLoading}
            total={total}
            page={page}
            pageSize={50}
            onPage={setPage}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelectedId(r.id)}
            sort={sort}
            onSort={setSort}
          />
        </div>

        {/* Side Panel for Detail */}
        {selectedId && (
          <div className="w-[450px] bg-white border-l border-slate-200 flex flex-col shrink-0 shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.1)] z-20 h-full relative">
            <div className="p-4 border-b border-slate-100 flex items-start justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-[14px] text-slate-800 flex items-center gap-2">
                  #{detail?.entry_number || detail?.id}
                  {detail?.is_posted === 1 && <CheckCircle2 size={14} className="text-[#1D9E75]" />}
                </h3>
                <p className="text-[12px] text-slate-500 mt-1">{detail?.description}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setTraceOpen(true); setTraceTab('source'); }}
                  className="p-1.5 hover:bg-indigo-100 rounded-full text-indigo-400 hover:text-indigo-700 transition-colors"
                  title="Open traceability"
                >
                  <GitBranch size={15} />
                </button>
                <button onClick={() => setSelectedId(null)} className="p-1.5 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-700 transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {detail ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                <div className="grid grid-cols-2 gap-4 text-[12px]">
                  <div>
                    <span className="text-slate-400 block mb-1">Date</span>
                    <span className="font-medium">{detail.entry_date}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-1">Source</span>
                    <span className="font-medium capitalize">{detail.ref_type?.replace('_transaction', '')?.replace('_movement', '') || 'Manual'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-1">Status</span>
                    <StatusBadge type="status" variant={detail.reversal_entry_id ? 'reversed' : detail.is_posted ? 'posted' : 'draft'} />
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-1">Period</span>
                    <span className="font-medium">{detail.period_name || '—'}</span>
                  </div>
                </div>

                {/* Reversal Chain */}
                {detail.reversal_entry_id && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-3">
                    <h4 className="text-[11px] font-bold text-amber-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <CornerDownRight size={12} /> Reversal Chain
                    </h4>
                    <div className="flex items-center gap-2 text-[12px] text-slate-700">
                      <span>Reversed by entry</span>
                      <button
                        onClick={() => setSelectedId(detail.reversal_entry_id!)}
                        className="font-mono font-semibold text-[#0F2D5C] hover:underline"
                      >
                        #{detail.reversal_entry_id}
                      </button>
                      <span className="text-slate-400 text-[11px]">— click to view</span>
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Ledger Lines</h4>
                  <div className="border border-slate-200 rounded overflow-hidden">
                    <table className="w-full text-[12px]">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2 px-3 text-left font-semibold">Account</th>
                          <th className="py-2 px-3 text-right font-semibold">Debit</th>
                          <th className="py-2 px-3 text-right font-semibold">Credit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detail.lines?.map((line, i) => (
                          <tr key={i}>
                            <td className="py-2 px-3">
                              <div className="font-mono text-[#0F2D5C]">{line.account_code}</div>
                              <div className="text-[10px] text-slate-500 truncate max-w-[150px]" title={line.account_name}>{line.account_name}</div>
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-[#0F2D5C] font-medium">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-red-600 font-medium">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                        <tr>
                          <td className="py-2 px-3">Total</td>
                          <td className="py-2 px-3 text-right tabular-nums text-[#0F2D5C]">
                            {fmt(detail.lines?.reduce((s, l) => s + (l.debit || 0), 0) || 0)}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-red-600">
                            {fmt(detail.lines?.reduce((s, l) => s + (l.credit || 0), 0) || 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 p-6 space-y-4">
                <div className="h-4 bg-slate-100 animate-pulse rounded w-1/3"></div>
                <div className="h-4 bg-slate-100 animate-pulse rounded w-1/2"></div>
                <div className="h-32 bg-slate-100 animate-pulse rounded w-full mt-6"></div>
              </div>
            )}
          </div>
        )}

        <GlEntryTraceDrawer
          isOpen={traceOpen && !!selectedId}
          loading={traceLoading}
          errorMessage={traceIsError ? ((traceError as Error)?.message || 'Failed to load trace data') : undefined}
          tab={traceTab}
          onTabChange={setTraceTab}
          onClose={() => setTraceOpen(false)}
          trace={traceData as any}
        />
      </div>
    </div>
  );
}
