/**
 * PostingGroupsPage — Admin UI for managing Business / Product / Inventory posting groups.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi, PostingGroup, PgType } from '../../api/gl';
import Modal from '../../components/ui/Modal';
import { CommandBar, CommandAction } from '../../components/shell/CommandBar';
import { KpiStrip, KpiItem } from '../../components/ui/KpiStrip';
import { Plus, Download, Pencil } from 'lucide-react';

const TABS: { key: PgType; label: string }[] = [
  { key: 'business',  label: 'Business' },
  { key: 'product',   label: 'Product' },
  { key: 'inventory', label: 'Inventory' },
];

const TAB_DESC: Record<PgType, string> = {
  business:  'Assigned to vendors and customers — determines purchase/sales accounts by trading entity type.',
  product:   'Assigned to items and categories — determines cost/revenue accounts by product type.',
  inventory: 'Assigned to warehouses — determines inventory account by storage location.',
};

// ─── Add modal ──────────────────────────────────────────────────────────────
function AddGroupModal({ type, open, onClose }: { type: PgType; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [err, setErr]   = useState('');

  const mut = useMutation({
    mutationFn: () => glApi.createPostingGroup(type, { code: code.toUpperCase(), name, description: desc || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posting-groups', type] });
      setCode(''); setName(''); setDesc(''); setErr('');
      onClose();
    },
    onError: (e: unknown) => setErr((e as { message?: string })?.message ?? 'An error occurred'),
  });

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr('');
    if (!code.trim() || !name.trim()) { setErr('Code and name are required'); return; }
    if (!/^[A-Z0-9_-]{1,20}$/i.test(code)) { setErr('Code: 1–20 letters, digits, underscores or dashes'); return; }
    mut.mutate();
  };

  return (
    <Modal open={open} title="Add Posting Group" onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4 text-[13px]">
        <div>
          <label className="block text-slate-600 font-semibold mb-1">Code *</label>
          <input className="input uppercase" placeholder="e.g. DOMESTIC" value={code}
            onChange={e => setCode(e.target.value.toUpperCase())} maxLength={20} />
          <p className="text-[11px] text-slate-400 mt-1">Uppercase letters, digits, underscore or dash — max 20 chars</p>
        </div>
        <div>
          <label className="block text-slate-600 font-semibold mb-1">Name *</label>
          <input className="input" placeholder="e.g. Domestic Customers" value={name}
            onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-slate-600 font-semibold mb-1">Description (optional)</label>
          <input className="input" placeholder="Short description..." value={desc}
            onChange={e => setDesc(e.target.value)} />
        </div>
        {err && <p className="text-[12px] text-red-600 bg-red-50 p-2 rounded border border-red-200">{err}</p>}
      </form>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => document.querySelector<HTMLFormElement>('form')?.requestSubmit()} disabled={mut.isPending}>
          {mut.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Edit modal ──────────────────────────────────────────────────────────────
function EditGroupModal({ type, group, open, onClose }: { type: PgType; group: PostingGroup; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName]   = useState(group.name);
  const [desc, setDesc]   = useState(group.description ?? '');
  const [active, setActive] = useState(group.is_active === 1);
  const [err, setErr]     = useState('');

  const mut = useMutation({
    mutationFn: () => glApi.updatePostingGroup(type, group.code, { name, description: desc || undefined, is_active: active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['posting-groups', type] }); onClose(); },
    onError: (e: unknown) => setErr((e as { message?: string })?.message ?? 'An error occurred'),
  });

  return (
    <Modal open={open} title={`Edit: ${group.code}`} onClose={onClose} size="sm">
      <div className="space-y-4 text-[13px]">
        <div>
          <label className="block text-slate-600 font-semibold mb-1">Name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-slate-600 font-semibold mb-1">Description</label>
          <input className="input" value={desc} onChange={e => setDesc(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pg-active" checked={active} onChange={e => setActive(e.target.checked)} className="rounded" />
          <label htmlFor="pg-active" className="text-slate-700">Active</label>
        </div>
        {!active && group.is_active === 1 && (
          <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
            Ensure this group is not referenced in posting setup before deactivating.
          </p>
        )}
        {err && <p className="text-[12px] text-red-600 bg-red-50 p-2 rounded border border-red-200">{err}</p>}
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => { setErr(''); mut.mutate(); }} disabled={mut.isPending}>
          {mut.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Group list ──────────────────────────────────────────────────────────────
function GroupList({ type, adding, setAdding }: { type: PgType; adding: boolean; setAdding: (v: boolean) => void }) {
  const [editing, setEditing] = useState<PostingGroup | null>(null);
  const [query, setQuery]     = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['posting-groups', type],
    queryFn:  () => glApi.postingGroups(type),
  });

  const groups = data ?? [];
  const filtered = useMemo(() => {
    if (!query.trim()) return groups;
    return groups.filter(g =>
      `${g.code} ${g.name} ${g.description ?? ''}`.toLowerCase().includes(query.toLowerCase())
    );
  }, [groups, query]);

  if (isLoading) return (
    <div className="space-y-2 p-4">
      {[1,2,3].map(i => <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />)}
    </div>
  );
  if (error) return <div className="p-6 text-center text-red-500 text-[13px]">Failed to load data</div>;

  function exportCsv() {
    const lines = [
      ['code', 'name', 'description', 'is_active'].join(','),
      ...filtered.map(g => [g.code, g.name, g.description ?? '', String(g.is_active)]
        .map(v => `"${String(v).split('"').join('""')}"`).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `posting-groups-${type}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white shrink-0">
        <input className="input max-w-xs text-[12px]" placeholder="Search by code, name or description…" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn-secondary text-[12px] flex items-center gap-1" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
          <p className="text-slate-400 text-[14px] mb-2">No posting groups yet</p>
          <p className="text-slate-400 text-[12px] mb-6">Add at least one group, or leave empty to use NULL/NULL default setup.</p>
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus size={14} className="mr-1" /> Add First Group
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Code</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Name</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Description</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(g => (
                <tr key={g.code} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#0F2D5C]">{g.code}</td>
                  <td className="px-4 py-3 text-slate-700 font-medium">{g.name}</td>
                  <td className="px-4 py-3 text-slate-400">{g.description ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${g.is_active === 1 ? 'bg-[#1D9E75]/15 text-[#1D9E75]' : 'bg-slate-100 text-slate-400'}`}>
                      {g.is_active === 1 ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-slate-400 hover:text-[#0F2D5C] transition-colors" onClick={() => setEditing(g)}>
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddGroupModal type={type} open={adding} onClose={() => setAdding(false)} />
      {editing && <EditGroupModal type={type} group={editing} open={true} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function PostingGroupsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'business') as PgType;
  const [adding, setAdding] = useState(false);

  const setTab = (t: PgType) => setParams({ tab: t });

  const { data: bpgData } = useQuery({ queryKey: ['posting-groups', 'business'],  queryFn: () => glApi.postingGroups('business') });
  const { data: ppgData } = useQuery({ queryKey: ['posting-groups', 'product'],   queryFn: () => glApi.postingGroups('product') });
  const { data: ipgData } = useQuery({ queryKey: ['posting-groups', 'inventory'], queryFn: () => glApi.postingGroups('inventory') });

  const kpiItems: KpiItem[] = [
    { id: 'bpg', label: 'BUSINESS GROUPS',   value: bpgData?.length ?? '—' },
    { id: 'ppg', label: 'PRODUCT GROUPS',    value: ppgData?.length ?? '—' },
    { id: 'ipg', label: 'INVENTORY GROUPS',  value: ipgData?.length ?? '—' },
    { id: 'total', label: 'TOTAL GROUPS',    value: ((bpgData?.length ?? 0) + (ppgData?.length ?? 0) + (ipgData?.length ?? 0)) || '—' },
  ];

  const actions: CommandAction[] = [
    { id: 'add', label: 'Add Group', icon: <Plus />, variant: 'primary', onClick: () => setAdding(true) },
  ];

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Posting Groups</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Manage Business, Product and Inventory posting groups — Microsoft Dynamics pattern</p>
        </div>
      </div>

      <CommandBar actions={actions} />
      <KpiStrip items={kpiItems} />

      <div className="flex-1 flex flex-col overflow-hidden px-6 pb-6">
        {/* Tab bar */}
        <div className="flex gap-1 pt-4 pb-0 shrink-0">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-[12px] font-semibold rounded-t border border-b-0 transition-colors ${
                tab === t.key
                  ? 'bg-white border-slate-200 text-[#0F2D5C]'
                  : 'bg-slate-100 border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content card */}
        <div className="bg-white rounded-b rounded-tr border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden">
          {/* Description strip */}
          <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 text-[12px] text-blue-800">
            {TAB_DESC[tab]}
          </div>
          <GroupList key={tab} type={tab} adding={adding} setAdding={setAdding} />
        </div>
      </div>
    </div>
  );
}

