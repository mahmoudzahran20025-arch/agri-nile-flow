import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { glApi, downloadCsv } from '../../api/client';
import { GlPeriod, fiscalYearStart, fiscalYearEnd, periodLabel } from '../../lib/gl/glPeriods';
import { KpiStrip, KpiItem } from '../../components/ui/KpiStrip';
import { CommandBar, CommandAction } from '../../components/shell/CommandBar';
import DataTable, { Column } from '../../components/ui/DataTable';

type Tab = 'pl' | 'balance' | 'trial';

interface PLRow { code: string; name: string; account_type: string; amount: number; }
interface BSRow { code: string; name: string; account_type: string; is_header: number; balance: number; }
interface TBRow {
  code: string; name: string; account_type: string; level: number; is_header: number;
  total_debit: number; total_credit: number; balance: number; normal_balance: string;
}

const TYPE_AR: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expense',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}

const TODAY = new Date().toISOString().slice(0, 10);

export default function FinancialStatementsPage() {
  const [tab, setTab] = useState<Tab>('trial');
  const [startDate, setS] = useState<string>(TODAY);
  const [endDate, setE] = useState<string>(TODAY);
  const [asOf, setAO] = useState<string>(TODAY);
  const [periodsReady, setPeriodsReady] = useState(false);

  const { data: periods = [] } = useQuery({
    queryKey: ['gl-periods'],
    queryFn: () => glApi.periods() as Promise<GlPeriod[]>,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!periodsReady && periods.length > 0) {
      setS(fiscalYearStart(periods));
      setE(fiscalYearEnd(periods));
      setAO(fiscalYearEnd(periods));
      setPeriodsReady(true);
    }
  }, [periods, periodsReady]);

  function applyPeriod(p: GlPeriod) {
    setS(p.start_date);
    setE(p.end_date);
    setAO(p.end_date);
  }

  const { data: plData } = useQuery({
    queryKey: ['gl-pl', startDate, endDate],
    queryFn: () => glApi.incomeStatement(startDate, endDate),
    enabled: tab === 'pl',
  });
  const { data: bsData } = useQuery({
    queryKey: ['gl-bs', asOf],
    queryFn: () => glApi.balanceSheet(asOf),
    enabled: tab === 'balance',
  });
  const { data: tbData, isLoading: tbLoading } = useQuery({
    queryKey: ['gl-tb', startDate, endDate],
    queryFn: () => glApi.trialBalance(startDate, endDate),
    enabled: tab === 'trial',
  });

  const pl = plData as any;
  const bs = bsData as any;
  const tb = tbData as any;

  // KPIs
  const kpiItems = useMemo<KpiItem[]>(() => {
    if (tab === 'trial') {
      const v = Math.abs((tb?.total_debit || 0) - (tb?.total_credit || 0));
      return [
        { id: 'dr', label: 'TOTAL DEBITS', value: fmt(tb?.total_debit || 0) },
        { id: 'cr', label: 'TOTAL CREDITS', value: fmt(tb?.total_credit || 0) },
        { id: 'var', label: 'VARIANCE', value: fmt(v), variant: v < 1 ? 'success' : 'warning' },
        { id: 'ni', label: 'NET INCOME', value: 'Calculated' } // Optional static placeholder
      ];
    }
    if (tab === 'pl') {
      return [
        { id: 'rev', label: 'REVENUE', value: fmt(pl?.total_revenue || 0), variant: 'success' },
        { id: 'exp', label: 'EXPENSES', value: fmt(pl?.total_expenses || 0), variant: 'warning' },
        { id: 'ni', label: 'NET INCOME', value: fmt(Math.abs(pl?.net_income || 0)), variant: (pl?.net_income || 0) >= 0 ? 'success' : 'warning' },
      ];
    }
    if (tab === 'balance') {
      const v = Math.abs((bs?.total_assets || 0) - ((bs?.total_liabilities || 0) + (bs?.total_equity || 0)));
      return [
        { id: 'ast', label: 'ASSETS', value: fmt(bs?.total_assets || 0), variant: 'default' },
        { id: 'liab', label: 'LIABILITIES', value: fmt(bs?.total_liabilities || 0), variant: 'warning' },
        { id: 'eq', label: 'EQUITY', value: fmt(bs?.total_equity || 0), variant: 'success' },
        { id: 'var', label: 'BALANCE CHECK', value: v < 1 ? 'BALANCED' : 'UNBALANCED', variant: v < 1 ? 'success' : 'warning' },
      ];
    }
    return [];
  }, [tab, tb, pl, bs]);

  const actions: CommandAction[] = [
    { id: 'export', label: 'Export CSV', icon: <Download />, onClick: () => {
      if (tab === 'pl') downloadCsv('/gl/income-statement', 'income-statement', { start: startDate, end: endDate });
      if (tab === 'trial') downloadCsv('/gl/trial-balance', 'trial-balance', { start: startDate, end: endDate });
      if (tab === 'balance') downloadCsv('/gl/balance-sheet', 'balance-sheet', { as_of: asOf });
    }},
    { id: 'print', label: 'Print', icon: <Printer />, variant: 'secondary', onClick: () => window.print() },
  ];

  const rightSlot = (
    <div className="flex items-center gap-3 mr-4">
      {periods.length > 0 && (
        <select
          className="input h-8 text-[12px] py-1 w-48"
          defaultValue=""
          onChange={e => {
            const p = periods.find(x => String(x.id) === e.target.value);
            if (p) applyPeriod(p);
          }}
        >
          <option value="">— Select Period —</option>
          {[...periods].sort((a, b) => b.start_date.localeCompare(a.start_date)).map(p => (
            <option key={p.id} value={p.id}>{periodLabel(p)}</option>
          ))}
        </select>
      )}
      {tab !== 'balance' ? (
        <div className="flex items-center gap-2">
          <input type="date" className="input h-8 text-[12px] py-1 w-32" value={startDate} onChange={e => setS(e.target.value)} />
          <span className="text-slate-400">-</span>
          <input type="date" className="input h-8 text-[12px] py-1 w-32" value={endDate} onChange={e => setE(e.target.value)} />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-slate-500">As of:</span>
          <input type="date" className="input h-8 text-[12px] py-1 w-32" value={asOf} onChange={e => setAO(e.target.value)} />
        </div>
      )}
    </div>
  );

  const tbColumns: Column<TBRow>[] = [
    { key: 'code', header: 'Account Code', render: r => <span className="font-mono text-[#0F2D5C]">{r.code}</span> },
    { key: 'name', header: 'Account Name', render: r => <span className={r.is_header ? 'font-semibold' : ''}>{r.is_header ? '▸ ' : ''}{r.name}</span> },
    { key: 'account_type', header: 'Type', render: r => <span className="text-slate-500">{TYPE_AR[r.account_type] || r.account_type}</span> },
    { key: 'total_debit', header: 'Dr', align: 'right', render: r => <span className="text-[#0F2D5C] font-mono">{r.total_debit > 0 ? fmt(r.total_debit) : '—'}</span> },
    { key: 'total_credit', header: 'Cr', align: 'right', render: r => <span className="text-[#1D9E75] font-mono">{r.total_credit > 0 ? fmt(r.total_credit) : '—'}</span> },
    { key: 'balance', header: 'Closing Bal', align: 'right', render: r => <span className={`font-mono font-bold ${r.balance < 0 ? 'text-red-600' : 'text-slate-800'}`}>{r.balance !== 0 ? fmt(Math.abs(r.balance)) : '—'}</span> },
  ];

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Financial Statements</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Real-time ledger reporting and statements</p>
        </div>
      </div>

      <CommandBar actions={actions} rightSlot={rightSlot} />
      <KpiStrip items={kpiItems} />

      <div className="px-6 pt-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex gap-6">
          {([
            { id: 'trial', label: 'Trial Balance' },
            { id: 'pl', label: 'Income Statement' },
            { id: 'balance', label: 'Balance Sheet' }
          ] as { id: Tab, label: string }[]).map(t => (
            <button 
              key={t.id} 
              className={`pb-3 text-[13px] font-semibold transition-colors relative ${tab === t.id ? 'text-[#0F2D5C]' : 'text-slate-500 hover:text-slate-800'}`} 
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {tab === t.id && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[#0F2D5C] rounded-t-full" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-6 overflow-hidden flex flex-col">
        {tab === 'trial' && (
          <DataTable
            columns={tbColumns}
            data={tb?.accounts || []}
            loading={tbLoading}
            rowKey={r => r.code}
            total={tb?.accounts?.length || 0}
          />
        )}

        {tab === 'pl' && (
          <div className="flex-1 overflow-auto flex gap-6">
            <div className="flex-1 bg-white rounded border border-slate-200 shadow-sm flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-[13px] text-slate-800">Revenue</h3>
              </div>
              <div className="flex-1 overflow-auto p-0">
                <table className="w-full text-[12px]">
                  <tbody>
                    {(pl?.revenue || []).map((r: PLRow) => (
                      <tr key={r.code} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="p-3 font-mono text-slate-400 w-24">{r.code}</td>
                        <td className="p-3 text-slate-700">{r.name}</td>
                        <td className="p-3 text-right font-medium text-[#1D9E75]">{fmt(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-between font-bold text-[13px]">
                <span>Total Revenue</span>
                <span className="text-[#1D9E75]">{fmt(pl?.total_revenue || 0)}</span>
              </div>
            </div>

            <div className="flex-1 bg-white rounded border border-slate-200 shadow-sm flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-[13px] text-slate-800">Expenses</h3>
              </div>
              <div className="flex-1 overflow-auto p-0">
                <table className="w-full text-[12px]">
                  <tbody>
                    {(pl?.expenses || []).map((r: PLRow) => (
                      <tr key={r.code} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="p-3 font-mono text-slate-400 w-24">{r.code}</td>
                        <td className="p-3 text-slate-700">{r.name}</td>
                        <td className="p-3 text-right font-medium text-red-600">{fmt(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-between font-bold text-[13px]">
                <span>Total Expenses</span>
                <span className="text-red-600">{fmt(pl?.total_expenses || 0)}</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'balance' && (
          <div className="flex-1 overflow-auto flex gap-6">
            <div className="flex-1 bg-white rounded border border-slate-200 shadow-sm flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-[13px] text-slate-800">Assets</h3>
              </div>
              <div className="flex-1 overflow-auto p-0">
                <table className="w-full text-[12px]">
                  <tbody>
                    {(bs?.assets || []).map((r: BSRow) => (
                      <tr key={r.code} className={`border-b border-slate-50 ${r.is_header ? 'bg-slate-50 font-semibold' : 'hover:bg-slate-50'}`}>
                        <td className="p-3 font-mono text-slate-400 w-24">{r.code}</td>
                        <td className="p-3 text-slate-700">{r.is_header ? '▸ ' : ''}{r.name}</td>
                        <td className="p-3 text-right font-medium text-[#0F2D5C]">{!r.is_header && r.balance !== 0 ? fmt(r.balance) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-between font-bold text-[13px]">
                <span>Total Assets</span>
                <span className="text-[#0F2D5C]">{fmt(bs?.total_assets || 0)}</span>
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-6">
              <div className="flex-1 bg-white rounded border border-slate-200 shadow-sm flex flex-col">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="font-bold text-[13px] text-slate-800">Liabilities</h3>
                </div>
                <div className="flex-1 overflow-auto p-0">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {(bs?.liabilities || []).map((r: BSRow) => (
                        <tr key={r.code} className={`border-b border-slate-50 ${r.is_header ? 'bg-slate-50 font-semibold' : 'hover:bg-slate-50'}`}>
                          <td className="p-3 font-mono text-slate-400 w-24">{r.code}</td>
                          <td className="p-3 text-slate-700">{r.is_header ? '▸ ' : ''}{r.name}</td>
                          <td className="p-3 text-right font-medium text-red-600">{!r.is_header && r.balance !== 0 ? fmt(r.balance) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-between font-bold text-[13px]">
                  <span>Total Liabilities</span>
                  <span className="text-red-600">{fmt(bs?.total_liabilities || 0)}</span>
                </div>
              </div>

              <div className="flex-1 bg-white rounded border border-slate-200 shadow-sm flex flex-col">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="font-bold text-[13px] text-slate-800">Equity</h3>
                </div>
                <div className="flex-1 overflow-auto p-0">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {(bs?.equity || []).map((r: BSRow) => (
                        <tr key={r.code} className={`border-b border-slate-50 ${r.is_header ? 'bg-slate-50 font-semibold' : 'hover:bg-slate-50'}`}>
                          <td className="p-3 font-mono text-slate-400 w-24">{r.code}</td>
                          <td className="p-3 text-slate-700">{r.is_header ? '▸ ' : ''}{r.name}</td>
                          <td className="p-3 text-right font-medium text-[#1D9E75]">{!r.is_header && r.balance !== 0 ? fmt(r.balance) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-between font-bold text-[13px]">
                  <span>Total Equity</span>
                  <span className="text-[#1D9E75]">{fmt(bs?.total_equity || 0)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
