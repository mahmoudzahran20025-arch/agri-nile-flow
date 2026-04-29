import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Eye, List, GitBranch, ChevronRight, ChevronDown, Shield, Info, Pencil, PowerOff, Power, Lock, Download, Upload } from 'lucide-react';
import { glApi } from '../../api/client';
import { usePermission } from '../../hooks/usePermission';
import Modal from '../../components/ui/Modal';
import { useToast } from '../../contexts/ToastContext';
import { KpiStrip, KpiItem } from '../../components/ui/KpiStrip';
import { CommandBar, CommandAction } from '../../components/shell/CommandBar';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';

interface Account {
  code: string;
  name: string;
  account_type: string;
  normal_balance: string;
  level: number;
  is_header: number;
  is_active: number;
  parent_code: string | null;
  notes?: string;
}

interface AccountUsageMeta {
  account_code: string;
  usage_count: number;
  last_used_date: string | null;
  is_locked: number;
}

const TYPE_AR: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity',
  revenue: 'Revenue', expense: 'Expense',
};

const TYPE_COLOR: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  asset:     { bg: 'bg-blue-50',   text: 'text-blue-800',   border: 'border-blue-200',   dot: 'bg-blue-400' },
  liability: { bg: 'bg-red-50',    text: 'text-red-800',    border: 'border-red-200',    dot: 'bg-red-400' },
  equity:    { bg: 'bg-amber-50',  text: 'text-amber-800',  border: 'border-amber-200',  dot: 'bg-amber-400' },
  revenue:   { bg: 'bg-emerald-50',text: 'text-emerald-800',border: 'border-emerald-200',dot: 'bg-emerald-400' },
  expense:   { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200', dot: 'bg-orange-400' },
};

interface AccountNode extends Account { children: AccountNode[] }

function buildTree(accounts: Account[]): AccountNode[] {
  const map: Record<string, AccountNode> = {};
  const roots: AccountNode[] = [];
  for (const a of accounts) map[a.code] = { ...a, children: [] };
  for (const a of accounts) {
    if (a.parent_code && map[a.parent_code]) {
      map[a.parent_code].children.push(map[a.code]);
    } else {
      roots.push(map[a.code]);
    }
  }
  return roots;
}

function AccountTreeNode({ node, navigate, usageMap, depth = 0 }: { node: AccountNode; navigate: (p: string) => void; usageMap: Record<string, AccountUsageMeta>; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const colors = TYPE_COLOR[node.account_type] ?? TYPE_COLOR.expense;
  const hasChildren = node.children.length > 0;
  const usage = usageMap[node.code];
  const isLocked = Number(usage?.is_locked ?? 0) === 1;

  return (
    <div className="select-none text-[12px] rtl">
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-50 transition-colors group cursor-pointer ${node.is_header ? 'font-semibold' : ''}`}
        style={{ paddingLeft: `${8 + depth * 20}px` }}
        onClick={() => hasChildren ? setOpen(o => !o) : navigate(`/gl/ledger/${node.code}`)}
      >
        <span className="w-4 shrink-0 text-slate-400">
          {hasChildren
            ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
            : <span className="inline-block w-3 h-px bg-slate-200 ml-1" />}
        </span>

        <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
        <span className="font-mono text-slate-400 w-16 shrink-0">{node.code}</span>
        
        <span className={`flex-1 ${node.is_active === 0 ? 'line-through text-slate-400' : 'text-slate-700'}`}>
          {node.name}
        </span>

        {node.is_active === 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 border border-slate-200 shrink-0">Inactive</span>
        )}

        {isLocked && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 shrink-0 inline-flex items-center gap-1">
            <Lock size={10} /> Locked
          </span>
        )}

        {node.is_header && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
            {TYPE_AR[node.account_type] ?? node.account_type}
          </span>
        )}

        {!node.is_header && (
          <button
            onClick={e => { e.stopPropagation(); navigate(`/gl/ledger/${node.code}`); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-[#0F2D5C] hover:bg-[#0F2D5C]/10 transition-all shrink-0"
            title="Ledger"
          >
            <Eye size={13} />
          </button>
        )}
      </div>

      {hasChildren && open && (
        <div className={`ml-2 border-l-2 ${colors.border}`}>
          {node.children.map(child => (
            <AccountTreeNode key={child.code} node={child} navigate={navigate} usageMap={usageMap} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChartOfAccountsPage() {
  const { canRead, canWrite } = usePermission();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [lockedOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('tree');
  
  const [openAdd, setOpenAdd] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', account_type: 'expense', parent_code: '', notes: '' });

  const [openEdit, setOpenEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({ name: '', parent_code: '', notes: '' });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn: () => glApi.accounts(),
  });
  
  const { data: usageMetadata = [] } = useQuery({
    queryKey: ['gl-accounts-usage-metadata'],
    queryFn: () => glApi.accountUsageMetadata(),
  });

  const list = accounts as Account[];
  const usageMap = useMemo(() => {
    const map: Record<string, AccountUsageMeta> = {};
    for (const row of usageMetadata as AccountUsageMeta[]) map[row.account_code] = row;
    return map;
  }, [usageMetadata]);

  const filtered = useMemo(() => list.filter(a => {
    const matchText = !filter || a.code.includes(filter) || a.name.toLowerCase().includes(filter.toLowerCase());
    const matchType = typeFilter === 'all' || a.account_type === typeFilter;
    const matchLocked = !lockedOnly || Number(usageMap[a.code]?.is_locked ?? 0) === 1;
    return matchText && matchType && matchLocked;
  }), [list, filter, typeFilter, lockedOnly, usageMap]);

  const tree = useMemo(() => buildTree(filtered.length < list.length ? filtered : list), [list, filtered]);

  const editAcc = useMutation({
    mutationFn: () => glApi.updateAccount(editTarget!.code, {
      name: editForm.name || undefined,
      parent_code: editForm.parent_code || null,
      notes: editForm.notes || undefined,
    }),
    onSuccess: (res: any) => {
      if (!res.success) { toast(res.error ?? 'Error', 'error'); return; }
      qc.invalidateQueries({ queryKey: ['gl-accounts'] });
      toast('Account updated successfully', 'success');
      setOpenEdit(false);
    },
  });

  const toggleActive = useMutation({
    mutationFn: (acc: Account) => glApi.updateAccount(acc.code, { is_active: acc.is_active === 1 ? 0 : 1 }),
    onSuccess: (res: any) => {
      if (!res.success) { toast(res.error ?? 'Error', 'error'); return; }
      qc.invalidateQueries({ queryKey: ['gl-accounts'] });
      toast('Account status updated', 'success');
    },
  });

  const createAcc = useMutation({
    mutationFn: () => glApi.createAccount(form),
    onSuccess: (res: any) => {
      if (!res.success) { toast(res.error ?? 'Error', 'error'); return; }
      qc.invalidateQueries({ queryKey: ['gl-accounts'] });
      toast('Account created successfully', 'success');
      setOpenAdd(false);
      setForm({ code: '', name: '', account_type: 'expense', parent_code: '', notes: '' });
    },
  });

  if (!canRead('gl')) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-20 text-center bg-[#f8fafc]">
        <Shield size={48} className="text-slate-300 mb-4" />
        <h2 className="text-[18px] font-bold text-slate-800">Access Denied</h2>
        <p className="text-[13px] text-slate-500">You need 'gl.read' permissions to view the Chart of Accounts.</p>
      </div>
    );
  }

  const kpiItems: KpiItem[] = [
    { id: 'total', label: 'TOTAL ACCOUNTS', value: list.length.toLocaleString() },
    { id: 'assets', label: 'ASSETS', value: list.filter(a => a.account_type === 'asset').length, variant: 'default' },
    { id: 'liabs', label: 'LIABILITIES', value: list.filter(a => a.account_type === 'liability').length, variant: 'warning' },
    { id: 'reveexp', label: 'REVENUE & EXPENSE', value: list.filter(a => a.account_type === 'revenue' || a.account_type === 'expense').length, variant: 'success' },
  ];

  const actions: CommandAction[] = [
    { id: 'new', label: 'New Account', icon: <Plus />, variant: 'primary', onClick: () => setOpenAdd(true), disabled: !canWrite('gl') },
    { id: 'sep1', isSeparator: true },
    { id: 'import', label: 'Import CoA', icon: <Upload />, disabled: !canWrite('gl') },
    { id: 'export', label: 'Export', icon: <Download />, variant: 'secondary' },
  ];

  const rightSlot = (
    <>
      <div className="flex items-center bg-slate-100 rounded p-0.5 gap-1 mr-4">
        <button
          onClick={() => setViewMode('tree')}
          className={`flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium transition-all rounded-sm ${
            viewMode === 'tree' ? 'bg-white shadow-sm text-[#0F2D5C]' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <GitBranch size={14} /> Tree
        </button>
        <button
          onClick={() => setViewMode('table')}
          className={`flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium transition-all rounded-sm ${
            viewMode === 'table' ? 'bg-white shadow-sm text-[#0F2D5C]' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <List size={14} /> Table
        </button>
      </div>
      <select className="input h-8 text-[12px] py-1 w-36" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
        <option value="all">All Types</option>
        <option value="asset">Asset</option>
        <option value="liability">Liability</option>
        <option value="equity">Equity</option>
        <option value="revenue">Revenue</option>
        <option value="expense">Expense</option>
      </select>
    </>
  );

  const columns: Column<Account>[] = [
    { key: 'code', header: 'Account Code', render: (row) => <span className="font-mono text-[#0F2D5C]">{row.code}</span> },
    { key: 'name', header: 'Name', render: (row) => <span className={row.is_header ? 'font-semibold' : ''}>{row.is_header ? '▸ ' : ''}{row.name}</span> },
    { key: 'account_type', header: 'Type', render: (row) => <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${TYPE_COLOR[row.account_type]?.bg} ${TYPE_COLOR[row.account_type]?.text} ${TYPE_COLOR[row.account_type]?.border}`}>{TYPE_AR[row.account_type] || row.account_type}</span> },
    { key: 'normal_balance', header: 'Balance', render: (row) => <span className="capitalize">{row.normal_balance}</span> },
    { key: 'is_active', header: 'Status', render: (row) => <StatusBadge variant={row.is_active ? 'active' : 'inactive'} /> },
    { key: 'actions', header: '', align: 'right', render: (row) => (
      <div className="flex justify-end gap-1">
        {!row.is_header && (
          <button onClick={() => navigate(`/gl/ledger/${row.code}`)} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
            <Eye size={14} />
          </button>
        )}
        {canWrite('gl') && (
          <button onClick={() => { setEditTarget(row); setEditForm({ name: row.name, parent_code: row.parent_code || '', notes: row.notes || '' }); setOpenEdit(true); }} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
            <Pencil size={14} />
          </button>
        )}
        {canWrite('gl') && !row.is_header && (
          <button 
            onClick={() => toggleActive.mutate(row)}
            disabled={toggleActive.isPending || (Number(usageMap[row.code]?.is_locked) === 1 && row.is_active === 1)}
            className={`p-1 rounded ${row.is_active ? 'text-amber-500 hover:bg-amber-50' : 'text-[#1D9E75] hover:bg-[#1D9E75]/10'} disabled:opacity-40`}
          >
            {row.is_active ? <PowerOff size={14} /> : <Power size={14} />}
          </button>
        )}
      </div>
    )}
  ];

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Chart of Accounts</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Manage financial classification structures</p>
        </div>
      </div>

      <CommandBar actions={actions} rightSlot={rightSlot} />
      <KpiStrip items={kpiItems} />

      <div className="flex-1 p-6 overflow-hidden flex flex-col">
        {viewMode === 'tree' ? (
          <div className="bg-white rounded border border-slate-200 shadow-sm flex-1 overflow-auto p-4">
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
              <input
                className="input h-8 w-64 text-[12px]"
                placeholder="Search code or name..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
            {tree.length === 0 && <p className="text-center text-slate-400 py-8 text-[13px]">No accounts found</p>}
            {tree.map(node => (
              <AccountTreeNode key={node.code} node={node} navigate={navigate} usageMap={usageMap} depth={0} />
            ))}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            loading={isLoading}
            rowKey={(r) => r.code}
            total={filtered.length}
          />
        )}
      </div>

      <Modal open={openEdit} onClose={() => setOpenEdit(false)} title={`Edit: ${editTarget?.name}`} size="md">
        <div className="space-y-4 text-[13px]">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Account Name *</label>
            <input className="input" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Parent Account (Code)</label>
            <input className="input font-mono" value={editForm.parent_code} onChange={e => setEditForm(p => ({ ...p, parent_code: e.target.value }))} placeholder="Leave blank for root accounts" />
            <p className="text-[11px] text-slate-400 mt-1">Current Code: <span className="font-mono font-bold">{editTarget?.code}</span></p>
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Notes</label>
            <input className="input" value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={() => setOpenEdit(false)}>Cancel</button>
          <button className="btn-primary" onClick={() => editAcc.mutate()} disabled={editAcc.isPending || !editForm.name}>
            {editAcc.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </Modal>

      <Modal open={openAdd} onClose={() => setOpenAdd(false)} title="Add New Account" size="md">
        <div className="space-y-4 text-[13px]">
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-[12px] text-blue-700 flex gap-2">
            <Info size={16} className="shrink-0" />
            <p>Ensure correct numbering convention. Parent account must exist and be defined as a Header account.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Account Code *</label>
              <input className="input font-mono" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder="1100" />
            </div>
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Account Type *</label>
              <select className="input" value={form.account_type} onChange={e => setForm(p => ({ ...p, account_type: e.target.value }))}>
                <option value="asset">Asset</option>
                <option value="liability">Liability</option>
                <option value="equity">Equity</option>
                <option value="revenue">Revenue</option>
                <option value="expense">Expense</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-slate-600 font-semibold mb-1">Account Name *</label>
              <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Main Bank Account" />
            </div>
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Parent Account (Code)</label>
              <input className="input font-mono" value={form.parent_code} onChange={e => setForm(p => ({ ...p, parent_code: e.target.value }))} placeholder="1000" />
            </div>
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Notes</label>
              <input className="input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn-secondary" onClick={() => setOpenAdd(false)}>Cancel</button>
          <button
            className="btn-primary"
            onClick={() => {
              if (form.parent_code && !list.find(a => a.code === form.parent_code)) {
                toast('Parent code not found in the chart', 'error');
                return;
              }
              createAcc.mutate();
            }}
            disabled={createAcc.isPending || !form.code || !form.name}
          >
            {createAcc.isPending ? 'Saving...' : 'Create Account'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
