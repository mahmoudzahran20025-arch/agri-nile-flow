/**
 * GlTransactionFlowReference — collapsible reference panel showing
 * how each transaction type maps to DR/CR accounts via posting rules.
 * Extracted as shared component used by PostingSetupHealthPage and PostingRulesPage.
 */
import { useState } from 'react'

const FLOWS = [
  {
    id: 'supplier_invoice',
    label: 'فاتورة مورد',
    trigger: 'عند استلام فاتورة شراء من مورد',
    engine: 'resolveSupplierInvoice',
    steps: [
      { side: 'DR', account: 'المشتريات (purchases)', source: 'posting_rules (rule_type=general)', code: 'PG-GPS-001' },
      { side: 'CR', account: 'الموردون / الدائنون (accounts_payable)', source: 'posting_rules (rule_type=control)', code: null },
    ],
    color: 'blue',
  },
  {
    id: 'supplier_payment',
    label: 'دفعة مورد',
    trigger: 'عند تسجيل مدفوعة لمورد',
    engine: 'resolveSupplierPayment',
    steps: [
      { side: 'DR', account: 'الموردون / الدائنون (accounts_payable)', source: 'posting_rules (rule_type=control)', code: null },
      { side: 'CR', account: 'الخزينة / البنك (cash / bank)', source: 'posting_rules (rule_type=control)', code: null },
    ],
    color: 'indigo',
  },
  {
    id: 'inventory_in',
    label: 'حركة مخزون وارد',
    trigger: 'عند استلام بضاعة في المستودع',
    engine: 'resolveInventoryMovement',
    steps: [
      { side: 'DR', account: 'حساب المخزون (inventory_account)', source: 'posting_rules (rule_type=inventory)', code: 'PG-INV-001' },
      { side: 'CR', account: 'المشتريات (purchases)', source: 'posting_rules (rule_type=general)', code: 'PG-GPS-001' },
    ],
    color: 'teal',
  },
  {
    id: 'inventory_out',
    label: 'صرف مخزون / تكلفة',
    trigger: 'عند صرف بضاعة من المستودع',
    engine: 'resolveInventoryMovement',
    steps: [
      { side: 'DR', account: 'تكلفة البضاعة المباعة (cogs)', source: 'posting_rules (rule_type=general)', code: 'PG-GPS-002' },
      { side: 'CR', account: 'حساب المخزون (inventory_account)', source: 'posting_rules (rule_type=inventory)', code: 'PG-INV-001' },
    ],
    color: 'orange',
  },
  {
    id: 'expense',
    label: 'مصروف تشغيلي',
    trigger: 'عند تسجيل مدفوعة نقدية أو مصروف',
    engine: 'resolveExpensePosting',
    steps: [
      { side: 'DR', account: 'المصروفات (expense_account)', source: 'posting_rules (rule_type=general)', code: 'PG-GPS-002' },
      { side: 'CR', account: 'الخزينة / البنك (cash / bank)', source: 'posting_rules (rule_type=control)', code: null },
    ],
    color: 'red',
  },
  {
    id: 'payroll',
    label: 'اعتماد رواتب',
    trigger: 'عند اعتماد مسير الرواتب',
    engine: 'resolvePayrollPosting',
    steps: [
      { side: 'DR', account: 'أجور ورواتب (wages)', source: 'posting_rules (rule_type=control)', code: null },
      { side: 'CR', account: 'مستحقات الرواتب (wages_payable)', source: 'posting_rules (rule_type=control)', code: null },
    ],
    color: 'purple',
  },
  {
    id: 'payroll_pay',
    label: 'صرف رواتب',
    trigger: 'عند صرف الرواتب للعمال',
    engine: 'resolvePayrollPosting',
    steps: [
      { side: 'DR', account: 'مستحقات الرواتب (wages_payable)', source: 'posting_rules (rule_type=control)', code: null },
      { side: 'CR', account: 'الخزينة / البنك (cash / bank)', source: 'posting_rules (rule_type=control)', code: null },
    ],
    color: 'slate',
  },
]

const COLOR_CLASSES: Record<string, { badge: string; sideDR: string; sideCR: string }> = {
  blue:   { badge: 'bg-blue-100 text-blue-700',     sideDR: 'bg-blue-50 text-blue-800 border-blue-200',   sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  indigo: { badge: 'bg-indigo-100 text-indigo-700', sideDR: 'bg-indigo-50 text-indigo-800 border-indigo-200', sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  teal:   { badge: 'bg-teal-100 text-teal-700',     sideDR: 'bg-teal-50 text-teal-800 border-teal-200',   sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  orange: { badge: 'bg-orange-100 text-orange-700', sideDR: 'bg-orange-50 text-orange-800 border-orange-200', sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  red:    { badge: 'bg-red-100 text-red-700',       sideDR: 'bg-red-50 text-red-800 border-red-200',     sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  purple: { badge: 'bg-purple-100 text-purple-700', sideDR: 'bg-purple-50 text-purple-800 border-purple-200', sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  slate:  { badge: 'bg-slate-100 text-slate-700',   sideDR: 'bg-slate-50 text-slate-800 border-slate-200', sideCR: 'bg-white text-slate-600 border-slate-100' },
}

export default function GlTransactionFlowReference() {
  const [open, setOpen] = useState(false)
  return (
    <div className="card overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-5 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-700">مرجع تدفق القيود المحاسبية</h2>
          <p className="text-xs text-slate-400 mt-0.5">كيف يُحوِّل المحرك كل نوع معاملة إلى قيد مدين/دائن</p>
        </div>
        <span className="text-slate-400 text-lg">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {FLOWS.map(flow => {
              const c = COLOR_CLASSES[flow.color] ?? COLOR_CLASSES.slate
              return (
                <div key={flow.id} className="rounded-xl border border-slate-100 bg-white p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${c.badge}`}>
                      {flow.label}
                    </span>
                    <p className="text-xs text-slate-500 leading-relaxed">{flow.trigger}</p>
                  </div>
                  <div className="space-y-1.5">
                    {flow.steps.map((step, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${step.side === 'DR' ? c.sideDR : c.sideCR}`}
                      >
                        <span className="font-black text-[11px] shrink-0 w-6">{step.side}</span>
                        <div className="flex-1">
                          <p className="font-medium leading-snug">{step.account}</p>
                          <p className="text-[10px] opacity-60 mt-0.5">
                            المصدر: {step.source}
                            {step.code && <span className="font-mono mr-1 opacity-80">[{step.code}]</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">engine: {flow.engine}()</p>
                </div>
              )
            })}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 leading-relaxed">
              <strong className="text-slate-700">منطق التسلسل الهرمي (4 مراحل):</strong>{' '}
              يبحث المحرك عن حساب بالترتيب: (1) تطابق تام BPG×PPG → (2) BPG فقط (PPG فارغ) →
              (3) PPG فقط (BPG فارغ) → (4) NULL×NULL (القاعدة الافتراضية). إذا لم يُعثر على حساب في أي مرحلة،
              يُرجع خطأ من نوع <span className="font-mono">PG-GPS-001</span> أو <span className="font-mono">PG-INV-001</span>.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
