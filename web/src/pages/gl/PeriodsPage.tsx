import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi } from '../../api/client';
import { Lock, Unlock, Plus, CalendarDays, Loader2, AlertTriangle } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import { KpiStrip, KpiItem } from '../../components/ui/KpiStrip';
import { CommandBar, CommandAction } from '../../components/shell/CommandBar';

interface FinancialPeriod {
  id: number; company_id: number;
  name: string; period_type: string;
  start_date: string; end_date: string;
  is_closed: number; closed_at?: string; closed_by?: number;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual',
};

const PERIOD_TYPES = ['monthly', 'quarterly', 'annual'];

export default function PeriodsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [confirmClose, setConfirmClose] = useState<FinancialPeriod | null>(null);
  const [form, setForm] = useState({
    name: '', period_type: 'monthly', start_date: '', end_date: '',
  });
  const [createError, setCreateError] = useState('');

  const { data: periods = [], isLoading } = useQuery({
    queryKey: ['gl-periods'],
    queryFn: () => glApi.periods() as Promise<FinancialPeriod[]>,
  });

  const createMut = useMutation({
    mutationFn: () => glApi.createPeriod(form),
    onSuccess: (res: any) => {
      if (!res?.success) {
        setCreateError(res?.error ?? 'فشل إنشاء الفترة');
        return;
      }
      qc.invalidateQueries({ queryKey: ['gl-periods'] });
      setShowAdd(false);
      setCreateError('');
      setForm({ name: '', period_type: 'monthly', start_date: '', end_date: '' });
    },
    onError: () => setCreateError('حدث خطأ في الاتصال بالخادم'),
  });

  const closeMut = useMutation({
    mutationFn: (id: number) => glApi.closePeriod(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-periods'] });
      setConfirmClose(null);
    },
  });

  const reopenMut = useMutation({
    mutationFn: (id: number) => glApi.reopenPeriod(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gl-periods'] }),
  });

  function prefillCurrentMonth() {
    const now = new Date();
    const y   = now.getFullYear();
    const m   = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    const monthNames = ['','January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    setForm({
      name: `${monthNames[now.getMonth() + 1]} ${y}`,
      period_type: 'monthly',
      start_date: `${y}-${m}-01`,
      end_date:   `${y}-${m}-${lastDay}`,
    });
  }

  const open   = periods.filter(p => !p.is_closed);
  const closed = periods.filter(p =>  p.is_closed);

  const kpiItems: KpiItem[] = [
    { id: 'total', label: 'TOTAL PERIODS', value: periods.length },
    { id: 'open', label: 'OPEN PERIODS', value: open.length, variant: 'success' },
    { id: 'closed', label: 'CLOSED PERIODS', value: closed.length, variant: 'warning' },
    { id: 'status', label: 'POSTING STATUS', value: open.length > 0 ? 'ACCEPTING' : 'BLOCKED', variant: open.length > 0 ? 'success' : 'warning' },
  ];

  const actions: CommandAction[] = [
    { id: 'new', label: 'New Period', icon: <Plus />, variant: 'primary', onClick: () => { setShowAdd(true); prefillCurrentMonth(); } },
  ];

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Financial Periods</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Manage fiscal periods — journal entries are blocked on closed periods</p>
        </div>
      </div>

      <CommandBar actions={actions} />
      <KpiStrip items={kpiItems} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Warning: no open periods */}
        {!isLoading && open.length === 0 && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded p-4">
            <AlertTriangle size={20} className="text-amber-500 shrink-0" />
            <div>
              <p className="font-semibold text-[13px] text-amber-800">No open financial periods</p>
              <p className="text-[12px] text-amber-700">No journal entries or transactions will be accepted until an open period exists.</p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-20 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : (
          <>
            {open.length > 0 && (
              <section>
                <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Unlock size={12} className="text-[#1D9E75]" /> Open Periods ({open.length})
                </h2>
                <div className="space-y-2">
                  {open.map(p => (
                    <PeriodRow key={p.id} period={p} onClose={() => setConfirmClose(p)} onReopen={() => {}} />
                  ))}
                </div>
              </section>
            )}

            {closed.length > 0 && (
              <section>
                <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Lock size={12} className="text-red-400" /> Closed Periods ({closed.length})
                </h2>
                <div className="space-y-2">
                  {closed.map(p => (
                    <PeriodRow key={p.id} period={p} onClose={() => {}} onReopen={() => reopenMut.mutate(p.id)} reopening={reopenMut.isPending} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Create Period Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setCreateError(''); }} title="Add New Financial Period" size="md">
        <div className="space-y-4 text-[13px]">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Period Name *</label>
            <input
              className="input"
              placeholder="e.g. January 2026"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Period Type</label>
            <select className="input" value={form.period_type} onChange={e => setForm(f => ({ ...f, period_type: e.target.value }))}>
              {PERIOD_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
          {createError && (
            <div className="col-span-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 text-[12px]">
              {createError}
            </div>
          )}
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Start Date</label>
              <input type="date" className="input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-slate-600 font-semibold mb-1">End Date</label>
              <input type="date" className="input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => createMut.mutate()}
            disabled={!form.name || !form.start_date || !form.end_date || createMut.isPending}
          >
            {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Create Period
          </button>
        </div>
      </Modal>

      {/* Confirm Close Modal */}
      {confirmClose && (
        <Modal open={!!confirmClose} onClose={() => setConfirmClose(null)} title="Confirm Period Close" size="md">
          <div className="space-y-4 text-[13px]">
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded p-4">
              <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-800">This action cannot be easily reversed</p>
                <p className="text-[12px] text-red-700 mt-1">
                  After closing <strong>{confirmClose.name}</strong>, no journal entries within its date range will be accepted.
                  Re-opening requires elevated permissions.
                </p>
              </div>
            </div>
            <div className="text-slate-600">
              <p><span className="font-medium">Period:</span> {confirmClose.name}</p>
              <p><span className="font-medium">Range:</span> {confirmClose.start_date} — {confirmClose.end_date}</p>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button className="btn-secondary" onClick={() => setConfirmClose(null)}>Cancel</button>
            <button
              className="btn-primary bg-red-600 border-red-600 hover:bg-red-700"
              onClick={() => closeMut.mutate(confirmClose.id)}
              disabled={closeMut.isPending}
            >
              {closeMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
              Close Period
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PeriodRow({
  period, onClose, onReopen, reopening,
}: {
  period: FinancialPeriod;
  onClose:  () => void;
  onReopen: () => void;
  reopening?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 p-4 rounded border transition-all bg-white ${period.is_closed ? 'border-slate-200 opacity-80' : 'border-[#1D9E75]/30 shadow-sm'}`}>
      <div className={`p-2 rounded flex-shrink-0 ${period.is_closed ? 'bg-slate-100' : 'bg-[#1D9E75]/10'}`}>
        <CalendarDays size={18} className={period.is_closed ? 'text-slate-400' : 'text-[#1D9E75]'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[13px] text-slate-800">{period.name}</span>
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${period.is_closed ? 'bg-red-100 text-red-700' : 'bg-[#1D9E75]/15 text-[#1D9E75]'}`}>
            {period.is_closed ? <><Lock size={9} /> CLOSED</> : <><Unlock size={9} /> OPEN</>}
          </span>
          <span className="text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{TYPE_LABELS[period.period_type] ?? period.period_type}</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">
          <span className="font-mono">{period.start_date}</span>
          <span className="mx-2 text-slate-300">→</span>
          <span className="font-mono">{period.end_date}</span>
          {period.closed_at && <span className="ml-3">Closed: {period.closed_at.slice(0, 10)}</span>}
        </p>
      </div>
      <div className="flex-shrink-0">
        {period.is_closed ? (
          <button
            onClick={onReopen} disabled={reopening}
            className="flex items-center gap-1.5 text-[11px] border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded px-3 py-2 transition-colors disabled:opacity-50"
          >
            {reopening ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
            Reopen
          </button>
        ) : (
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-[11px] border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 rounded px-3 py-2 transition-colors"
          >
            <Lock size={12} /> Close Period
          </button>
        )}
      </div>
    </div>
  );
}
