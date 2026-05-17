import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Download, RefreshCw, Link2, CheckCircle, X } from 'lucide-react';
import { suppliersApi } from '../../api/client';

// Shape returned by GET /suppliers/aging-summary (payments.ts)
interface APAgingRow {
  id:                number;
  invoice_number:    string | null;
  invoice_date:      string;
  supplier_code:     number;
  supplier_name:     string | null;
  due_date:          string | null;
  total_amount:      number;
  paid_amount:       number;
  outstanding:       number;
  po_number:         string | null;
  days_overdue:      number;
  due_date_estimated: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function ageBucket(days: number): { label: string; color: string } {
  if (days <= 0)  return { label: 'جارية',    color: 'text-emerald-600' };
  if (days <= 30) return { label: '1-30 يوم',  color: 'text-sky-600' };
  if (days <= 60) return { label: '31-60 يوم', color: 'text-amber-500' };
  if (days <= 90) return { label: '61-90 يوم', color: 'text-orange-500' };
  return { label: '+90 يوم', color: 'text-red-600' };
}

function exportCsv(rows: APAgingRow[]) {
  const header = 'Invoice ID,Invoice Number,Invoice Date,Supplier Code,Supplier Name,Due Date,Total,Paid,Outstanding,Days Overdue';
  const lines = rows.map(r =>
    [r.id, r.invoice_number ?? '', r.invoice_date, r.supplier_code, `"${r.supplier_name ?? ''}"`,
     r.due_date ?? '', r.total_amount, r.paid_amount, r.outstanding, r.days_overdue].join(',')
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `ap-aging-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Match Payment Modal ────────────────────────────────────────────────────────

interface MatchPaymentModalProps {
  invoice: APAgingRow;
  onClose: () => void;
  onDone:  () => void;
}

function MatchPaymentModal({ invoice, onClose, onDone }: MatchPaymentModalProps) {
  const qc = useQueryClient();
  const [paymentId, setPaymentId] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);
  const [apiError, setApiError] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => suppliersApi.matchPayment(invoice.supplier_code, {
      payment_id:    Number(paymentId),
      invoice_id:    invoice.id,
      allow_partial: allowPartial,
    }),
    onSuccess: (res: any) => {
      if (res?.success === false) {
        if (res.code === 'PARTIAL_MATCH_REQUIRED') {
          setApiError(`مبلغ الدفع أقل من قيمة الفاتورة بـ ${fmt(res.shortfall)} ج.م — فعّل المطابقة الجزئية للمتابعة`)
          setAllowPartial(true)
          return
        }
        setApiError(res.error ?? 'حدث خطأ')
        return
      }
      qc.invalidateQueries({ queryKey: ['ap-aging-rows'] })
      onDone()
    },
    onError: () => setApiError('حدث خطأ في الاتصال'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-[#0F2D5C]">مطابقة دفعة بالفاتورة</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Invoice summary */}
          <div className="bg-slate-50 rounded-lg p-3 text-[12px] space-y-1 text-slate-600">
            <div className="flex justify-between">
              <span>الفاتورة</span>
              <span className="font-mono font-semibold">{invoice.invoice_number ?? `#${invoice.id}`}</span>
            </div>
            <div className="flex justify-between">
              <span>المورد</span>
              <span className="font-medium">{invoice.supplier_name ?? invoice.supplier_code}</span>
            </div>
            <div className="flex justify-between">
              <span>المبلغ المتبقي</span>
              <span className="font-bold text-slate-800">{fmt(invoice.outstanding)} ج.م</span>
            </div>
            {invoice.due_date && (
              <div className="flex justify-between">
                <span>تاريخ الاستحقاق</span>
                <span className={invoice.days_overdue > 0 ? 'text-red-600 font-semibold' : ''}>{invoice.due_date}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1">
              رقم سند الدفع <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="أدخل ID سند الدفع من المعاملات"
              value={paymentId}
              onChange={e => { setPaymentId(e.target.value); setApiError('') }}
            />
            <p className="text-[10px] text-slate-400 mt-1">يجب أن يكون سند دفع (نوع م) منشور وغير مُقابَل بعد</p>
          </div>

          {allowPartial && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-[12px] text-amber-700">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">مطابقة جزئية</p>
                <p>سيُقفَل سند الدفع كاملاً وتبقى الفاتورة مفتوحة بالفرق.</p>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={allowPartial} onChange={e => setAllowPartial(e.target.checked)} />
                  <span>الموافقة على المطابقة الجزئية</span>
                </label>
              </div>
            </div>
          )}

          {apiError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-[12px] text-red-700">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              {apiError}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            إلغاء
          </button>
          <button
            onClick={() => mutate()}
            disabled={!paymentId || isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40"
          >
            {isPending
              ? <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              : <CheckCircle size={14} />
            }
            تأكيد المطابقة
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function APAgingPage() {
  const navigate = useNavigate();
  const [matchInvoice, setMatchInvoice] = useState<APAgingRow | null>(null);
  const [filterSupplier, setFilterSupplier] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['ap-aging-rows'],
    queryFn:  () => suppliersApi.agingSummary() as Promise<{ data: APAgingRow[] }>,
    select:   (res: any) => (res?.data ?? res ?? []) as APAgingRow[],
  });

  const rows: APAgingRow[] = data as unknown as APAgingRow[] ?? [];

  const filtered = useMemo(() => {
    if (!filterSupplier) return rows;
    const q = filterSupplier.toLowerCase();
    return rows.filter(r =>
      (r.supplier_name ?? '').toLowerCase().includes(q) ||
      String(r.supplier_code).includes(q)
    );
  }, [rows, filterSupplier]);

  const totals = useMemo(() => filtered.reduce(
    (acc, r) => ({
      total:     acc.total     + (r.outstanding ?? 0),
      overdue:   acc.overdue   + (r.days_overdue > 0 ? (r.outstanding ?? 0) : 0),
      count:     acc.count     + 1,
    }),
    { total: 0, overdue: 0, count: 0 }
  ), [filtered]);

  const overduePct = totals.total > 0 ? Math.round((totals.overdue / totals.total) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-1">
              <button onClick={() => navigate('/suppliers')} className="hover:text-slate-600">الموردون</button>
              <ChevronRight size={12} />
              <span className="text-slate-600 font-medium">ذمم الموردين</span>
            </div>
            <h1 className="text-[18px] font-bold text-[#0F2D5C]">تقرير ذمم الموردين (AP Aging)</h1>
            <p className="text-[12px] text-slate-500 mt-0.5">الفواتير المفتوحة غير المُقابَلة — مرتبة حسب تاريخ الاستحقاق</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="بحث بالمورد..."
              value={filterSupplier}
              onChange={e => setFilterSupplier(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12px] w-48 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
            <button
              onClick={() => exportCsv(rows)}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100 rounded border border-slate-200 disabled:opacity-40"
            >
              <Download size={13} /> تصدير CSV
            </button>
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
            >
              <RefreshCw size={13} className={isRefetching ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-2">إجمالي الذمم</p>
            <p className="text-[24px] font-bold text-[#0F2D5C]">{isLoading ? '…' : fmt(totals.total)}</p>
            <p className="text-[11px] text-slate-400 mt-1">{totals.count} فاتورة مفتوحة</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-2">متأخرة السداد</p>
            <p className={`text-[24px] font-bold ${totals.overdue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {isLoading ? '…' : fmt(totals.overdue)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">{overduePct}% من الإجمالي</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-2">جارية (لم تتجاوز)</p>
            <p className="text-[24px] font-bold text-emerald-600">
              {isLoading ? '…' : fmt(totals.total - totals.overdue)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">{100 - overduePct}% من الإجمالي</p>
          </div>
        </div>

        {/* Overdue alert */}
        {!isLoading && totals.overdue > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-700">
            <AlertTriangle size={14} />
            {fmt(totals.overdue)} ج.م متأخرة على {filtered.filter(r => r.days_overdue > 0).length} فاتورة
          </div>
        )}

        {/* Aging table */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">المورد</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">رقم الفاتورة</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">التاريخ</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">الاستحقاق</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">الإجمالي</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">المدفوع</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-600 uppercase tracking-wider">المتبقي</th>
                <th className="px-4 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">الحالة</th>
                <th className="px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">مطابقة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">جاري التحميل…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  {rows.length === 0 ? 'لا توجد ذمم مفتوحة' : 'لا توجد نتائج للبحث'}
                </td></tr>
              ) : (
                filtered.map(row => {
                  const bucket = ageBucket(row.days_overdue);
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{row.supplier_name ?? '—'}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{row.supplier_code}</p>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{row.invoice_number ?? `#${row.id}`}</td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-500">{row.invoice_date}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {row.due_date
                          ? <span className={row.days_overdue > 0 ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                              {row.due_date}
                              {row.due_date_estimated ? <span className="text-[10px] text-slate-400 mr-1">(تقديري)</span> : null}
                            </span>
                          : <span className="text-slate-400">—</span>
                        }
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-right text-slate-700">{fmt(row.total_amount)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-right text-emerald-600">{row.paid_amount > 0 ? fmt(row.paid_amount) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-right font-bold text-slate-800">{fmt(row.outstanding)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[11px] font-bold ${bucket.color}`}>
                          {bucket.label}
                          {row.days_overdue > 0 && (
                            <span className="text-[10px] font-normal text-slate-400 mr-1">({row.days_overdue}ي)</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => setMatchInvoice(row)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-brand-600 hover:bg-brand-50 rounded border border-brand-200 transition-colors"
                          title="مطابقة دفعة بهذه الفاتورة"
                        >
                          <Link2 size={11} /> مطابقة
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {filtered.length > 0 && (
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td colSpan={6} className="px-4 py-2.5 text-[11px] font-bold text-slate-600 uppercase">
                    الإجمالي ({filtered.length} فاتورة)
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-right font-bold text-slate-800 text-[13px]">
                    {fmt(totals.total)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {matchInvoice && (
        <MatchPaymentModal
          invoice={matchInvoice}
          onClose={() => setMatchInvoice(null)}
          onDone={() => setMatchInvoice(null)}
        />
      )}
    </div>
  );
}
