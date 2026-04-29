import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, PlayCircle, RefreshCw } from 'lucide-react';
import { glApi, PostingRule } from '../../api/gl';
import { useToast } from '../../contexts/ToastContext';
import { KpiStrip, KpiItem } from '../../components/ui/KpiStrip';
import { CommandBar, CommandAction } from '../../components/shell/CommandBar';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';

// ── Transaction Flow Reference ──────────────────────────────────
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
];

const COLOR_CLASSES: Record<string, { badge: string; sideDR: string; sideCR: string }> = {
  blue:   { badge: 'bg-blue-100 text-blue-700',     sideDR: 'bg-blue-50 text-blue-800 border-blue-200',   sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  indigo: { badge: 'bg-indigo-100 text-indigo-700', sideDR: 'bg-indigo-50 text-indigo-800 border-indigo-200', sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  teal:   { badge: 'bg-teal-100 text-teal-700',     sideDR: 'bg-teal-50 text-teal-800 border-teal-200',   sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  orange: { badge: 'bg-orange-100 text-orange-700', sideDR: 'bg-orange-50 text-orange-800 border-orange-200', sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  red:    { badge: 'bg-red-100 text-red-700',       sideDR: 'bg-red-50 text-red-800 border-red-200',     sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  purple: { badge: 'bg-purple-100 text-purple-700', sideDR: 'bg-purple-50 text-purple-800 border-purple-200', sideCR: 'bg-slate-50 text-slate-700 border-slate-200' },
  slate:  { badge: 'bg-slate-100 text-slate-700',   sideDR: 'bg-slate-50 text-slate-800 border-slate-200', sideCR: 'bg-white text-slate-600 border-slate-100' },
};

function TransactionFlowReference() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded border border-slate-200 shadow-sm mt-6">
      <button
        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div>
          <h2 className="text-[14px] font-bold text-[#0F2D5C]">Transaction Engine Reference</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">How the engine converts operational events to Dr/Cr entries</p>
        </div>
        <span className="text-slate-400 font-mono text-[10px]">{open ? 'HIDE DETAILS' : 'SHOW DETAILS'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 p-4 rtl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {FLOWS.map(flow => {
              const c = COLOR_CLASSES[flow.color] || COLOR_CLASSES.slate;
              return (
                <div key={flow.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${c.badge}`}>
                      {flow.label}
                    </span>
                    <p className="text-[12px] text-slate-600 font-medium">{flow.trigger}</p>
                  </div>
                  <div className="space-y-1.5">
                    {flow.steps.map((step, i) => (
                      <div key={i} className={`flex items-start gap-2 rounded border px-3 py-2 text-[12px] ${step.side === 'DR' ? c.sideDR : c.sideCR}`}>
                        <span className="font-black text-[11px] shrink-0 w-6">{step.side}</span>
                        <div className="flex-1">
                          <p className="font-semibold leading-snug">{step.account}</p>
                          <p className="text-[10px] opacity-70 mt-0.5">
                            Source: {step.source}
                            {step.code && <span className="font-mono ml-1 opacity-80">[{step.code}]</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono text-left" dir="ltr">engine: {flow.engine}()</p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 p-3 rounded bg-blue-50 border border-blue-100">
            <p className="text-[12px] text-blue-800 leading-relaxed">
              <strong>Resolution Hierarchy (4 Phases):</strong> The engine searches for accounts in this strict order: 
              (1) Exact Match BPG×PPG → (2) BPG Only (PPG=NULL) → (3) PPG Only (BPG=NULL) → (4) NULL×NULL (Default Fallback). 
              If no account is found at any phase, the transaction is rejected to prevent unmapped entries.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PostingRulesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');

  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ['posting-rules', page, typeFilter],
    queryFn: () => glApi.postingRules({ page, size: 50, rule_type: typeFilter as any || undefined }),
  });

  const { data: healthData, isLoading: healthLoading, refetch: healthRefetch } = useQuery({
    queryKey: ['posting-setup-health'],
    queryFn: () => glApi.postingHealth(),
  });

  const rules = rulesData?.data || [];
  const total = rulesData?.total || 0;

  const fixGeneral = useMutation({
    mutationFn: () => glApi.createGeneralSetup({ bus_posting_group_code: null, prod_posting_group_code: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posting-setup-health'] });
      qc.invalidateQueries({ queryKey: ['posting-rules'] });
      toast('Created Default General Rule', 'success');
    },
  });

  const fixInventory = useMutation({
    mutationFn: () => glApi.createInventorySetup({ inv_posting_group_code: null, prod_posting_group_code: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posting-setup-health'] });
      qc.invalidateQueries({ queryKey: ['posting-rules'] });
      toast('Created Default Inventory Rule', 'success');
    },
  });

  const kpiItems: KpiItem[] = [
    { id: 'total', label: 'TOTAL RULES', value: total.toString() },
    { id: 'active', label: 'ACTIVE RULES', value: rules.filter(r => r.is_active).length.toString(), variant: 'success' },
    { id: 'locked', label: 'SYSTEM LOCKED', value: rules.filter(r => r.priority === 0).length.toString(), variant: 'warning' }, // Approximation
    { id: 'health', label: 'SYSTEM HEALTH', value: healthData?.is_ready ? 'READY' : 'NEEDS SETUP', variant: healthData?.is_ready ? 'success' : 'warning' },
  ];

  const actions: CommandAction[] = [
    { id: 'new', label: 'New Rule', icon: <Plus />, variant: 'primary' },
    { id: 'sep1', isSeparator: true },
    { id: 'test', label: 'Test Engine', icon: <PlayCircle /> },
    { id: 'refresh', label: 'Refresh Health', icon: <RefreshCw />, onClick: () => healthRefetch(), variant: 'secondary' },
  ];

  const rightSlot = (
    <select className="input h-8 text-[12px] py-1 w-40" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
      <option value="">All Rule Types</option>
      <option value="general">General Setup</option>
      <option value="inventory">Inventory Setup</option>
      <option value="control">Control Account</option>
    </select>
  );

  const columns: Column<PostingRule>[] = [
    { key: 'id', header: 'Rule ID', render: r => <span className="font-mono text-[#0F2D5C] font-semibold">#{r.id}</span> },
    { key: 'rule_type', header: 'Type', render: r => <span className="capitalize">{r.rule_type}</span> },
    { key: 'mapping', header: 'Source Mapping', render: r => {
      if (r.rule_type === 'general') return <span className="font-mono text-[11px] text-slate-500">{r.bus_posting_group_code || 'NULL'} × {r.prod_posting_group_code || 'NULL'}</span>;
      if (r.rule_type === 'inventory') return <span className="font-mono text-[11px] text-slate-500">{r.inv_posting_group_code || 'NULL'} × {r.prod_posting_group_code || 'NULL'}</span>;
      return <span className="font-mono text-[11px] text-slate-500">{r.mapping_key}</span>;
    }},
    { key: 'accounts', header: 'Destination Accounts', render: r => {
      const accts = [r.account_code, r.sales_account, r.purchases_account, r.cogs_account, r.inventory_account].filter(Boolean);
      return <span className="font-mono text-[11px] text-[#0F2D5C] truncate max-w-[200px] block" title={accts.join(', ')}>{accts.join(', ') || 'None'}</span>;
    }},
    { key: 'priority', header: 'Priority', align: 'center', render: r => <span className="text-slate-500">{r.priority}</span> },
    { key: 'is_active', header: 'Status', render: r => <StatusBadge variant={r.is_active ? 'active' : 'inactive'} /> },
  ];

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] overflow-y-auto">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Posting Rules Matrix</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Configure operational-to-financial transaction mappings</p>
        </div>
      </div>

      <CommandBar actions={actions} rightSlot={rightSlot} />
      <KpiStrip items={kpiItems} />

      <div className="p-6 space-y-6">
        {/* Health Banner */}
        {healthData && !healthLoading && (
          <div className={`p-4 rounded border ${healthData.is_ready ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'} flex items-start gap-4`}>
            <div className="mt-1">{healthData.is_ready ? <ShieldCheck size={24} className="text-[#1D9E75]" /> : <span className="text-2xl">⚠️</span>}</div>
            <div className="flex-1">
              <h3 className={`font-bold text-[14px] ${healthData.is_ready ? 'text-[#0F2D5C]' : 'text-amber-800'}`}>
                {healthData.is_ready ? 'System Ready for Auto-Posting' : 'Setup Incomplete - Auto-Posting Blocked'}
              </h3>
              <p className="text-[12px] text-slate-600 mt-1">
                {healthData.is_ready 
                  ? 'All catch-all default rules are correctly defined. The Posting Engine will process operational events securely.' 
                  : `${healthData.issues.length} blocking issues found. Please resolve them to enable auto-posting.`}
              </p>
            </div>
            {!healthData.is_ready && (
              <div className="flex flex-col gap-2">
                {!healthData.setup.has_catch_all_general && (
                  <button onClick={() => fixGeneral.mutate()} disabled={fixGeneral.isPending} className="btn-primary text-[11px] h-7 px-3 bg-red-600 border-red-600 hover:bg-red-700">
                    Fix General Setup
                  </button>
                )}
                {!healthData.setup.has_catch_all_inventory && (
                  <button onClick={() => fixInventory.mutate()} disabled={fixInventory.isPending} className="btn-primary text-[11px] h-7 px-3 bg-red-600 border-red-600 hover:bg-red-700">
                    Fix Inventory Setup
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Data Table */}
        <div className="bg-white rounded border border-slate-200 shadow-sm overflow-hidden">
          <DataTable
            columns={columns}
            data={rules}
            loading={rulesLoading}
            total={total}
            page={page}
            pageSize={50}
            onPage={setPage}
            rowKey={r => r.id}
          />
        </div>

        {/* Reference */}
        <TransactionFlowReference />
      </div>
    </div>
  );
}
