/**
 * PostingSetupPage — Manage General Posting Setup (BPG × PPG matrix)
 * and Inventory Posting Setup (IPG × PPG matrix).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi, GeneralSetupRow, InventorySetupRow } from '../../api/gl';
import Modal from '../../components/ui/Modal';
import PostingGroupSelector from '../../components/gl/PostingGroupSelector';
import AccountPicker from '../../components/gl/AccountPicker';
import { CommandBar, CommandAction } from '../../components/shell/CommandBar';
import { KpiStrip, KpiItem } from '../../components/ui/KpiStrip';
import { Plus, Pencil } from 'lucide-react';

// ─── helpers ────────────────────────────────────────────────────────────────
const NULL_LABEL = '— DEFAULT (all groups) —'

function groupLabel(code: string | null) {
  return code ?? NULL_LABEL
}

function hasGeneralCoreGaps(row: GeneralSetupRow) {
  return !row.sales_account || !row.purchases_account || !row.cogs_account
}

function hasInventoryCoreGaps(row: InventorySetupRow) {
  return !row.inventory_account
}

// ─── General setup add/edit modal ────────────────────────────────────────────
interface GeneralFormState {
  bus_posting_group_code:  string
  prod_posting_group_code: string
  sales_account:           string
  purchases_account:       string
  cogs_account:            string
  sales_returns_account:   string
  purch_returns_account:   string
  expense_account:         string
}

const BLANK_GENERAL: GeneralFormState = {
  bus_posting_group_code: '', prod_posting_group_code: '',
  sales_account: '', purchases_account: '', cogs_account: '',
  sales_returns_account: '', purch_returns_account: '', expense_account: '',
}

function toNullable(v: string): string | null { return v.trim() || null }

function GeneralSetupModal({
  open, onClose, existing, existingRows,
}: {
  open: boolean; onClose: () => void
  existing?: GeneralSetupRow
  existingRows: GeneralSetupRow[]
}) {
  const qc  = useQueryClient()
  const isEdit = !!existing

  const [form, setForm] = useState<GeneralFormState>(isEdit ? {
    bus_posting_group_code:  existing!.bus_posting_group_code  ?? '',
    prod_posting_group_code: existing!.prod_posting_group_code ?? '',
    sales_account:           existing!.sales_account           ?? '',
    purchases_account:       existing!.purchases_account       ?? '',
    cogs_account:            existing!.cogs_account            ?? '',
    sales_returns_account:   existing!.sales_returns_account   ?? '',
    purch_returns_account:   existing!.purch_returns_account   ?? '',
    expense_account:         existing!.expense_account         ?? '',
  } : BLANK_GENERAL)
  const [active, setActive] = useState(existing ? existing.is_active === 1 : true)
  const [err, setErr]       = useState('')

  const formBpg = toNullable(form.bus_posting_group_code)
  const formPpg = toNullable(form.prod_posting_group_code)

  const inlineValidation = useMemo(() => {
    const issues: string[] = []
    const hints: string[] = []

    if (!toNullable(form.sales_account)) issues.push('Sales account is required');
    if (!toNullable(form.purchases_account)) issues.push('Purchases account is required');
    if (!toNullable(form.cogs_account)) issues.push('COGS account is required');

    const exactConflict = existingRows.some((row) =>
      row.id !== existing?.id
      && (row.bus_posting_group_code ?? null) === formBpg
      && (row.prod_posting_group_code ?? null) === formPpg
    )
    if (exactConflict) {
      issues.push('Conflict: this BPG × PPG combination already exists');
    }

    const hasCatchAll = existingRows.some((row) =>
      row.id !== existing?.id
      && row.bus_posting_group_code === null
      && row.prod_posting_group_code === null
      && row.is_active === 1
    )
    if (hasCatchAll && (formBpg !== null || formPpg !== null)) {
      hints.push('A default rule (NULL × NULL) exists — this more specific row will take priority.');
    }

    if (formBpg !== null && formPpg !== null) {
      const byBpgWildcard = existingRows.some((row) =>
        row.id !== existing?.id
        && row.is_active === 1
        && row.bus_posting_group_code === formBpg
        && row.prod_posting_group_code === null
      );
      const byPpgWildcard = existingRows.some((row) =>
        row.id !== existing?.id
        && row.is_active === 1
        && row.bus_posting_group_code === null
        && row.prod_posting_group_code === formPpg
      );
      if (byBpgWildcard) hints.push('A row with same BPG and PPG=NULL exists. This new row will take priority.');
      if (byPpgWildcard) hints.push('A row with same PPG and BPG=NULL exists. This new row will take priority.');
    }

    if (formBpg === null && formPpg === null && existingRows.length > 0) {
      hints.push('Editing/adding the default row affects all entities without an assigned group.');
    }

    return { issues, hints }
  }, [existingRows, existing?.id, form.sales_account, form.purchases_account, form.cogs_account, formBpg, formPpg])

  const mut = useMutation({
    mutationFn: () => isEdit
      ? glApi.updateGeneralSetup(existing!.id, {
          sales_account:           toNullable(form.sales_account),
          purchases_account:       toNullable(form.purchases_account),
          cogs_account:            toNullable(form.cogs_account),
          sales_returns_account:   toNullable(form.sales_returns_account),
          purch_returns_account:   toNullable(form.purch_returns_account),
          expense_account:         toNullable(form.expense_account),
          is_active:               active ? 1 : 0,
        })
      : glApi.createGeneralSetup({
          bus_posting_group_code:  toNullable(form.bus_posting_group_code),
          prod_posting_group_code: toNullable(form.prod_posting_group_code),
          sales_account:           toNullable(form.sales_account),
          purchases_account:       toNullable(form.purchases_account),
          cogs_account:            toNullable(form.cogs_account),
          sales_returns_account:   toNullable(form.sales_returns_account),
          purch_returns_account:   toNullable(form.purch_returns_account),
          expense_account:         toNullable(form.expense_account),
        }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['general-posting-setup'] }); onClose() },
    onError: async (e: unknown) => setErr((e as { message?: string })?.message ?? 'حدث خطأ'),
  })

  const acctField = (
    label: string,
    field: keyof GeneralFormState,
    accountType: 'asset' | 'revenue' | 'expense' = 'asset',
    required = false,
  ) => (
    <AccountPicker
      value={form[field] || null}
      onChange={value => setForm(prev => ({ ...prev, [field]: value ?? '' }))}
      accountType={accountType}
      label={label}
      required={required}
    />
  )

  return (
    <Modal open={open} title={isEdit ? 'Edit Posting Setup' : 'Add Posting Setup Row'} onClose={onClose} size="lg">
      <form onSubmit={e => { e.preventDefault(); setErr(''); mut.mutate(); }} className="space-y-5 text-[13px]">
        {!isEdit && (
          <div className="grid grid-cols-2 gap-4">
            <PostingGroupSelector
              type="business"
              value={form.bus_posting_group_code || null}
              onChange={value => setForm(prev => ({ ...prev, bus_posting_group_code: value ?? '' }))}
              label="Business Posting Group (BPG)"
              showRecent
            />
            <PostingGroupSelector
              type="product"
              value={form.prod_posting_group_code || null}
              onChange={value => setForm(prev => ({ ...prev, prod_posting_group_code: value ?? '' }))}
              label="Product Posting Group (PPG)"
              showRecent
            />
          </div>
        )}

        {inlineValidation.issues.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-[12px] text-red-700 space-y-1">
            {inlineValidation.issues.map((issue, idx) => <p key={idx}>• {issue}</p>)}
          </div>
        )}

        {inlineValidation.hints.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-[12px] text-amber-700 space-y-1">
            {inlineValidation.hints.map((hint, idx) => <p key={idx}>⚠ {hint}</p>)}
          </div>
        )}

        {!isEdit && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-[12px] text-blue-700">
            Leave both empty to create a <strong>default rule (NULL × NULL)</strong> applied to all entities without an assigned group.
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {acctField('Sales Account', 'sales_account', 'revenue', true)}
          {acctField('Purchases Account', 'purchases_account', 'asset', true)}
          {acctField('Cost of Goods Sold (COGS)', 'cogs_account', 'expense', true)}
          {acctField('Sales Returns Account', 'sales_returns_account', 'revenue')}
          {acctField('Purchase Returns Account', 'purch_returns_account', 'asset')}
          {acctField('Expense Account', 'expense_account', 'expense')}
        </div>

        {isEdit && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gps-active" checked={active} onChange={e => setActive(e.target.checked)} className="rounded" />
            <label htmlFor="gps-active" className="text-slate-700">Active</label>
          </div>
        )}

        {err && <p className="text-[12px] text-red-600 bg-red-50 p-2 rounded border border-red-200">{err}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending || inlineValidation.issues.length > 0}>
            {mut.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── General setup tab ───────────────────────────────────────────────────────
function GeneralSetupTab() {
  const { data, isLoading } = useQuery({ queryKey: ['general-posting-setup'], queryFn: () => glApi.generalSetup() })

  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState<GeneralSetupRow | null>(null)

  if (isLoading) return (
    <div className="space-y-2 p-4">{[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
  );

  const rows = data ?? [];
  const hasCatchAll = rows.some(r => r.bus_posting_group_code === null && r.prod_posting_group_code === null && r.is_active === 1);
  const rowsWithGaps = rows.filter(hasGeneralCoreGaps);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
        <div className="flex gap-3">
          <span className={`text-[11px] px-2 py-1 rounded border ${hasCatchAll ? 'border-[#1D9E75]/30 bg-[#1D9E75]/10 text-[#1D9E75]' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {hasCatchAll ? '✓ Default rule (NULL × NULL) exists' : '✗ No default rule (NULL × NULL)'}
          </span>
          <span className={`text-[11px] px-2 py-1 rounded border ${rowsWithGaps.length === 0 ? 'border-[#1D9E75]/30 bg-[#1D9E75]/10 text-[#1D9E75]' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            {rowsWithGaps.length === 0 ? '✓ No rows with missing core accounts' : `⚠ ${rowsWithGaps.length} rows with missing core accounts`}
          </span>
        </div>
        <button className="btn-primary text-[12px] flex items-center gap-1" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add Row
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
          <p className="text-slate-400 text-[14px] mb-2">No general posting setup rows</p>
          <p className="text-slate-400 text-[12px] mb-6">Add one row with BPG=empty × PPG=empty as the default rule for all entities.</p>
          <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" /> Add Default Row</button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">BPG</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">PPG</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Sales</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Purchases</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">COGS</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Expense</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{groupLabel(r.bus_posting_group_code)}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{groupLabel(r.prod_posting_group_code)}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{r.sales_account ?? <span className="text-red-400">—</span>}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{r.purchases_account ?? <span className="text-red-400">—</span>}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{r.cogs_account ?? <span className="text-red-400">—</span>}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{r.expense_account ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.is_active === 1 ? 'bg-[#1D9E75]/15 text-[#1D9E75]' : 'bg-slate-100 text-slate-400'}`}>
                      {r.is_active === 1 ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-slate-400 hover:text-[#0F2D5C]" onClick={() => setEditing(r)}><Pencil size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding  && <GeneralSetupModal open onClose={() => setAdding(false)} existingRows={rows} />}
      {editing && <GeneralSetupModal open existing={editing} onClose={() => setEditing(null)} existingRows={rows} />}
    </div>
  );
}

// ─── Inventory setup modal ───────────────────────────────────────────────────
function InventorySetupModal({
  open, onClose, existing, existingRows,
}: {
  open: boolean; onClose: () => void
  existing?: InventorySetupRow
  existingRows: InventorySetupRow[]
}) {
  const qc    = useQueryClient()
  const isEdit = !!existing

  const [ipg,   setIpg]   = useState(existing?.inv_posting_group_code  ?? '')
  const [ppg,   setPpg]   = useState(existing?.prod_posting_group_code ?? '')
  const [acct,  setAcct]  = useState(existing?.inventory_account       ?? '')
  const [active, setActive] = useState(existing ? existing.is_active === 1 : true)
  const [err,   setErr]   = useState('')

  const formIpg = toNullable(ipg)
  const formPpg = toNullable(ppg)
  const inlineValidation = useMemo(() => {
    const issues: string[] = []
    const hints: string[] = []

    if (!toNullable(acct)) issues.push('Inventory account is required');

    const exactConflict = existingRows.some((row) =>
      row.id !== existing?.id
      && (row.inv_posting_group_code ?? null) === formIpg
      && (row.prod_posting_group_code ?? null) === formPpg
    )
    if (exactConflict) issues.push('Conflict: this IPG × PPG combination already exists');

    const hasCatchAll = existingRows.some((row) =>
      row.id !== existing?.id
      && row.inv_posting_group_code === null
      && row.prod_posting_group_code === null
      && row.is_active === 1
    )
    if (hasCatchAll && (formIpg !== null || formPpg !== null)) {
      hints.push('A default rule (NULL × NULL) exists — this more specific row will take priority.');
    }

    if (formIpg === null && formPpg === null && existingRows.length > 0) {
      hints.push('Editing/adding the inventory default row affects all warehouses and items without an assigned group.');
    }

    return { issues, hints }
  }, [acct, existingRows, existing?.id, formIpg, formPpg])

  const mut = useMutation({
    mutationFn: () => isEdit
      ? glApi.updateInventorySetup(existing!.id, { inventory_account: toNullable(acct), is_active: active ? 1 : 0 })
      : glApi.createInventorySetup({ inv_posting_group_code: toNullable(ipg), prod_posting_group_code: toNullable(ppg), inventory_account: toNullable(acct) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-posting-setup'] }); onClose() },
    onError: async (e: unknown) => setErr((e as { message?: string })?.message ?? 'حدث خطأ'),
  })

  return (
    <Modal open={open} title={isEdit ? 'Edit Inventory Setup' : 'Add Inventory Setup Row'} onClose={onClose} size="sm">
      <form onSubmit={e => { e.preventDefault(); setErr(''); mut.mutate(); }} className="space-y-4 text-[13px]">
        {!isEdit && (
          <>
            <PostingGroupSelector type="inventory" value={ipg || null} onChange={value => setIpg(value ?? '')} label="Inventory Posting Group (IPG)" showRecent />
            <PostingGroupSelector type="product" value={ppg || null} onChange={value => setPpg(value ?? '')} label="Product Posting Group (PPG)" showRecent />
          </>
        )}

        {inlineValidation.issues.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-[12px] text-red-700 space-y-1">
            {inlineValidation.issues.map((issue, idx) => <p key={idx}>• {issue}</p>)}
          </div>
        )}

        {inlineValidation.hints.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-[12px] text-amber-700 space-y-1">
            {inlineValidation.hints.map((hint, idx) => <p key={idx}>⚠ {hint}</p>)}
          </div>
        )}

        <AccountPicker value={acct || null} onChange={value => setAcct(value ?? '')} accountType="asset" label="Inventory Account" required />
        {isEdit && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="ips-active" checked={active} onChange={e => setActive(e.target.checked)} className="rounded" />
            <label htmlFor="ips-active" className="text-slate-700">Active</label>
          </div>
        )}
        {err && <p className="text-[12px] text-red-600 bg-red-50 p-2 rounded border border-red-200">{err}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending || inlineValidation.issues.length > 0}>
            {mut.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Inventory setup tab ─────────────────────────────────────────────────────
function InventorySetupTab() {
  const { data, isLoading } = useQuery({ queryKey: ['inventory-posting-setup'], queryFn: () => glApi.inventorySetup() })

  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState<InventorySetupRow | null>(null)

  if (isLoading) return (
    <div className="space-y-2 p-4">{[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
  );

  const rows = data ?? [];
  const hasCatchAll = rows.some(r => r.inv_posting_group_code === null && r.prod_posting_group_code === null && r.is_active === 1);
  const rowsWithGaps = rows.filter(hasInventoryCoreGaps);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
        <div className="flex gap-3">
          <span className={`text-[11px] px-2 py-1 rounded border ${hasCatchAll ? 'border-[#1D9E75]/30 bg-[#1D9E75]/10 text-[#1D9E75]' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {hasCatchAll ? '✓ Default rule (NULL × NULL) exists' : '✗ No default rule (NULL × NULL)'}
          </span>
          <span className={`text-[11px] px-2 py-1 rounded border ${rowsWithGaps.length === 0 ? 'border-[#1D9E75]/30 bg-[#1D9E75]/10 text-[#1D9E75]' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            {rowsWithGaps.length === 0 ? '✓ No rows with missing inventory account' : `⚠ ${rowsWithGaps.length} rows missing inventory account`}
          </span>
        </div>
        <button className="btn-primary text-[12px] flex items-center gap-1" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add Row
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
          <p className="text-slate-400 text-[14px] mb-2">No inventory posting setup rows</p>
          <p className="text-slate-400 text-[12px] mb-6">Add one row with IPG=empty × PPG=empty as the default rule for all warehouses and items.</p>
          <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" /> Add Default Row</button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
              <tr>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">IPG</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">PPG</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Inventory Account</th>
                <th className="text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{groupLabel(r.inv_posting_group_code)}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{groupLabel(r.prod_posting_group_code)}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{r.inventory_account ?? <span className="text-red-400">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.is_active === 1 ? 'bg-[#1D9E75]/15 text-[#1D9E75]' : 'bg-slate-100 text-slate-400'}`}>
                      {r.is_active === 1 ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-slate-400 hover:text-[#0F2D5C]" onClick={() => setEditing(r)}><Pencil size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding  && <InventorySetupModal open onClose={() => setAdding(false)} existingRows={rows} />}
      {editing && <InventorySetupModal open existing={editing} onClose={() => setEditing(null)} existingRows={rows} />}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
type SetupTab = 'general' | 'inventory';

const SETUP_TABS: { key: SetupTab; label: string }[] = [
  { key: 'general',   label: 'General Setup (BPG × PPG)' },
  { key: 'inventory', label: 'Inventory Setup (IPG × PPG)' },
];

export default function PostingSetupPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'general') as SetupTab;

  const { data: genData } = useQuery({ queryKey: ['general-posting-setup'],   queryFn: () => glApi.generalSetup() });
  const { data: invData } = useQuery({ queryKey: ['inventory-posting-setup'], queryFn: () => glApi.inventorySetup() });

  const kpiItems: KpiItem[] = [
    { id: 'gen',  label: 'GENERAL SETUP ROWS',   value: genData?.length ?? '—' },
    { id: 'inv',  label: 'INVENTORY SETUP ROWS',  value: invData?.length ?? '—' },
    { id: 'gcov', label: 'GEN COVERAGE', value: genData ? (genData.some(r => r.bus_posting_group_code === null) ? '✓ Default' : '✗ No Default') : '—', variant: genData?.some(r => r.bus_posting_group_code === null) ? 'success' : 'warning' },
    { id: 'icov', label: 'INV COVERAGE', value: invData ? (invData.some(r => r.inv_posting_group_code === null) ? '✓ Default' : '✗ No Default') : '—', variant: invData?.some(r => r.inv_posting_group_code === null) ? 'success' : 'warning' },
  ];

  const actions: CommandAction[] = [];

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Posting Setup</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Define accounts for each combination of business, product and inventory posting groups</p>
        </div>
      </div>

      <CommandBar actions={actions} />
      <KpiStrip items={kpiItems} />

      <div className="flex-1 flex flex-col overflow-hidden px-6 pb-6">
        {/* Tab bar */}
        <div className="flex gap-1 pt-4 pb-0 shrink-0">
          {SETUP_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setParams({ tab: t.key })}
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

        <div className="bg-white rounded-b rounded-tr border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden">
          {tab === 'general'   && <GeneralSetupTab />}
          {tab === 'inventory' && <InventorySetupTab />}
        </div>
      </div>
    </div>
  );
}
