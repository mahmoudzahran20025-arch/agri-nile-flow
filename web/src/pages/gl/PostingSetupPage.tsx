/**
 * PostingSetupPage — Manage General Posting Setup (BPG × PPG matrix)
 * and Inventory Posting Setup (IPG × PPG matrix).
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { glApi, GeneralSetupRow, InventorySetupRow } from '../../api/gl'
import Modal from '../../components/ui/Modal'
import PostingGroupSelector from '../../components/gl/PostingGroupSelector'
import AccountPicker from '../../components/gl/AccountPicker'

// ─── helpers ────────────────────────────────────────────────────────────────
const NULL_LABEL = '— DEFAULT (جميع المجموعات) —'

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

    if (!toNullable(form.sales_account)) issues.push('حساب المبيعات مطلوب')
    if (!toNullable(form.purchases_account)) issues.push('حساب المشتريات مطلوب')
    if (!toNullable(form.cogs_account)) issues.push('حساب تكلفة المبيعات (COGS) مطلوب')

    const exactConflict = existingRows.some((row) =>
      row.id !== existing?.id
      && (row.bus_posting_group_code ?? null) === formBpg
      && (row.prod_posting_group_code ?? null) === formPpg
    )
    if (exactConflict) {
      issues.push('تعارض مباشر: هذه التركيبة (BPG × PPG) موجودة بالفعل')
    }

    const hasCatchAll = existingRows.some((row) =>
      row.id !== existing?.id
      && row.bus_posting_group_code === null
      && row.prod_posting_group_code === null
      && row.is_active === 1
    )
    if (hasCatchAll && (formBpg !== null || formPpg !== null)) {
      hints.push('يوجد صف افتراضي (NULL × NULL) وسيتم تجاوزه عند تطابق هذا الصف الأكثر تحديداً')
    }

    if (formBpg !== null && formPpg !== null) {
      const byBpgWildcard = existingRows.some((row) =>
        row.id !== existing?.id
        && row.is_active === 1
        && row.bus_posting_group_code === formBpg
        && row.prod_posting_group_code === null
      )
      const byPpgWildcard = existingRows.some((row) =>
        row.id !== existing?.id
        && row.is_active === 1
        && row.bus_posting_group_code === null
        && row.prod_posting_group_code === formPpg
      )
      if (byBpgWildcard) hints.push('يوجد صف بنفس BPG وPPG = NULL. هذا الصف الجديد سيكون أكثر أولوية منه')
      if (byPpgWildcard) hints.push('يوجد صف بنفس PPG وBPG = NULL. هذا الصف الجديد سيكون أكثر أولوية منه')
    }

    if (formBpg === null && formPpg === null && existingRows.length > 0) {
      hints.push('تنبيه: تعديل/إضافة صف افتراضي يؤثر على كل الكيانات غير المعيّنة')
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
    <Modal open={open} title={isEdit ? 'تعديل إعداد الترحيل' : 'إضافة إعداد ترحيل جديد'} onClose={onClose} size="lg">
      <form onSubmit={e => { e.preventDefault(); setErr(''); mut.mutate() }} className="space-y-5">
        {!isEdit && (
          <div className="grid grid-cols-2 gap-4">
            <PostingGroupSelector
              type="business"
              value={form.bus_posting_group_code || null}
              onChange={value => setForm(prev => ({ ...prev, bus_posting_group_code: value ?? '' }))}
              label="مجموعة الأعمال (BPG)"
              showRecent
            />
            <PostingGroupSelector
              type="product"
              value={form.prod_posting_group_code || null}
              onChange={value => setForm(prev => ({ ...prev, prod_posting_group_code: value ?? '' }))}
              label="مجموعة المنتج (PPG)"
              showRecent
            />
          </div>
        )}

        {inlineValidation.issues.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 space-y-1">
            {inlineValidation.issues.map((issue, idx) => <p key={idx}>• {issue}</p>)}
          </div>
        )}

        {inlineValidation.hints.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-700 space-y-1">
            {inlineValidation.hints.map((hint, idx) => <p key={idx}>⚠ {hint}</p>)}
          </div>
        )}

        {!isEdit && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-700">
            اتركهما فارغتين لإنشاء <strong>قاعدة الافتراضي (NULL × NULL)</strong> التي تُطبَّق على جميع الكيانات بدون مجموعة معيَّنة.
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {acctField('حساب المبيعات', 'sales_account', 'revenue', true)}
          {acctField('حساب المشتريات', 'purchases_account', 'asset', true)}
          {acctField('تكلفة البضاعة المباعة (COGS)', 'cogs_account', 'expense', true)}
          {acctField('حساب مردودات المبيعات', 'sales_returns_account', 'revenue')}
          {acctField('حساب مردودات المشتريات', 'purch_returns_account', 'asset')}
          {acctField('حساب المصروفات', 'expense_account', 'expense')}
        </div>

        {isEdit && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="gps-active" checked={active} onChange={e => setActive(e.target.checked)} />
            <label htmlFor="gps-active" className="text-sm">نشط</label>
          </div>
        )}

        {err && <p className="text-sm text-red-500 bg-red-50 p-2 rounded">{err}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending || inlineValidation.issues.length > 0}>
            {mut.isPending ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── General setup tab ───────────────────────────────────────────────────────
function GeneralSetupTab() {
  const { data, isLoading } = useQuery({ queryKey: ['general-posting-setup'], queryFn: () => glApi.generalSetup() })

  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState<GeneralSetupRow | null>(null)

  if (isLoading) return <div className="py-16 text-center text-slate-400">جارٍ التحميل...</div>

  const rows = data ?? []
  const hasCatchAll = rows.some((row) => row.bus_posting_group_code === null && row.prod_posting_group_code === null && row.is_active === 1)
  const rowsWithGaps = rows.filter(hasGeneralCoreGaps)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{rows.length} صف إعداد</p>
        <button className="btn-primary text-sm" onClick={() => setAdding(true)}>+ إضافة صف</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={`rounded-lg border px-3 py-2 text-xs ${hasCatchAll ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {hasCatchAll ? '✅ توجد قاعدة افتراضية (NULL × NULL)' : '❌ لا توجد قاعدة افتراضية (NULL × NULL)'}
        </div>
        <div className={`rounded-lg border px-3 py-2 text-xs ${rowsWithGaps.length === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          {rowsWithGaps.length === 0 ? '✅ لا توجد صفوف ناقصة حسابات أساسية' : `⚠️ ${rowsWithGaps.length} صف يحتوي حسابات أساسية ناقصة`}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-2 border-dashed border-slate-200 rounded-xl py-16 text-center">
          <p className="text-slate-400 text-lg mb-2">لا يوجد إعداد ترحيل عام</p>
          <p className="text-slate-400 text-sm mb-6">
            أضف صف واحد بـ BPG=فارغ × PPG=فارغ كقاعدة افتراضية لجميع الكيانات.
          </p>
          <button className="btn-primary" onClick={() => setAdding(true)}>+ إضافة صف الافتراضي</button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-right text-slate-600">
                <th className="pb-2 font-medium">BPG</th>
                <th className="pb-2 font-medium">PPG</th>
                <th className="pb-2 font-medium">مبيعات</th>
                <th className="pb-2 font-medium">مشتريات</th>
                <th className="pb-2 font-medium">COGS</th>
                <th className="pb-2 font-medium">مصروفات</th>
                <th className="pb-2 font-medium">الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-2 font-mono">{groupLabel(r.bus_posting_group_code)}</td>
                  <td className="py-2 font-mono">{groupLabel(r.prod_posting_group_code)}</td>
                  <td className="py-2 font-mono">{r.sales_account ?? <span className="text-red-400">غير محدد</span>}</td>
                  <td className="py-2 font-mono">{r.purchases_account ?? <span className="text-red-400">غير محدد</span>}</td>
                  <td className="py-2 font-mono">{r.cogs_account ?? <span className="text-red-400">غير محدد</span>}</td>
                  <td className="py-2 font-mono">{r.expense_account ?? <span className="text-slate-300">—</span>}</td>
                  <td className="py-2">
                    {r.is_active === 1 ? <span className="badge-green">نشط</span> : <span className="badge-slate">معطل</span>}
                  </td>
                  <td className="py-2 text-left">
                    <button className="text-xs text-blue-600 hover:underline" onClick={() => setEditing(r)}>تعديل</button>
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
  )
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

    if (!toNullable(acct)) issues.push('حساب المخزون مطلوب')

    const exactConflict = existingRows.some((row) =>
      row.id !== existing?.id
      && (row.inv_posting_group_code ?? null) === formIpg
      && (row.prod_posting_group_code ?? null) === formPpg
    )
    if (exactConflict) issues.push('تعارض مباشر: هذه التركيبة (IPG × PPG) موجودة بالفعل')

    const hasCatchAll = existingRows.some((row) =>
      row.id !== existing?.id
      && row.inv_posting_group_code === null
      && row.prod_posting_group_code === null
      && row.is_active === 1
    )
    if (hasCatchAll && (formIpg !== null || formPpg !== null)) {
      hints.push('يوجد صف افتراضي (NULL × NULL) وسيتم تجاوزه عند تطابق هذا الصف الأكثر تحديداً')
    }

    if (formIpg === null && formPpg === null && existingRows.length > 0) {
      hints.push('تنبيه: تعديل/إضافة صف افتراضي للمخزون يؤثر على كل المستودعات/الأصناف غير المعيّنة')
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
    <Modal open={open} title={isEdit ? 'تعديل إعداد مخزون' : 'إضافة إعداد مخزون'} onClose={onClose} size="sm">
      <form onSubmit={e => { e.preventDefault(); setErr(''); mut.mutate() }} className="space-y-4">
        {!isEdit && (
          <>
            <PostingGroupSelector type="inventory" value={ipg || null} onChange={value => setIpg(value ?? '')} label="مجموعة المخزون (IPG)" showRecent />
            <PostingGroupSelector type="product" value={ppg || null} onChange={value => setPpg(value ?? '')} label="مجموعة المنتج (PPG)" showRecent />
          </>
        )}

        {inlineValidation.issues.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 space-y-1">
            {inlineValidation.issues.map((issue, idx) => <p key={idx}>• {issue}</p>)}
          </div>
        )}

        {inlineValidation.hints.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-700 space-y-1">
            {inlineValidation.hints.map((hint, idx) => <p key={idx}>⚠ {hint}</p>)}
          </div>
        )}

        <AccountPicker value={acct || null} onChange={value => setAcct(value ?? '')} accountType="asset" label="حساب المخزون" required />
        {isEdit && (
          <div className="flex items-center gap-2">
            <input type="checkbox" id="ips-active" checked={active} onChange={e => setActive(e.target.checked)} />
            <label htmlFor="ips-active" className="text-sm">نشط</label>
          </div>
        )}
        {err && <p className="text-sm text-red-500 bg-red-50 p-2 rounded">{err}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending || inlineValidation.issues.length > 0}>
            {mut.isPending ? 'جارٍ الحفظ...' : 'حفظ'}
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

  if (isLoading) return <div className="py-16 text-center text-slate-400">جارٍ التحميل...</div>

  const rows = data ?? []
  const hasCatchAll = rows.some((row) => row.inv_posting_group_code === null && row.prod_posting_group_code === null && row.is_active === 1)
  const rowsWithGaps = rows.filter(hasInventoryCoreGaps)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">{rows.length} صف إعداد</p>
        <button className="btn-primary text-sm" onClick={() => setAdding(true)}>+ إضافة صف</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={`rounded-lg border px-3 py-2 text-xs ${hasCatchAll ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {hasCatchAll ? '✅ توجد قاعدة افتراضية (NULL × NULL)' : '❌ لا توجد قاعدة افتراضية (NULL × NULL)'}
        </div>
        <div className={`rounded-lg border px-3 py-2 text-xs ${rowsWithGaps.length === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          {rowsWithGaps.length === 0 ? '✅ لا توجد صفوف ناقصة حساب المخزون' : `⚠️ ${rowsWithGaps.length} صف يحتوي حساب مخزون ناقص`}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-2 border-dashed border-slate-200 rounded-xl py-16 text-center">
          <p className="text-slate-400 text-lg mb-2">لا يوجد إعداد ترحيل مخزون</p>
          <p className="text-slate-400 text-sm mb-6">
            أضف صف واحد بـ IPG=فارغ × PPG=فارغ كقاعدة افتراضية لجميع المستودعات والأصناف.
          </p>
          <button className="btn-primary" onClick={() => setAdding(true)}>+ إضافة صف الافتراضي</button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-right text-slate-600">
                <th className="pb-2 font-medium">IPG</th>
                <th className="pb-2 font-medium">PPG</th>
                <th className="pb-2 font-medium">حساب المخزون</th>
                <th className="pb-2 font-medium">الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-2 font-mono">{groupLabel(r.inv_posting_group_code)}</td>
                  <td className="py-2 font-mono">{groupLabel(r.prod_posting_group_code)}</td>
                  <td className="py-2 font-mono">
                    {r.inventory_account ?? <span className="text-red-400">غير محدد</span>}
                  </td>
                  <td className="py-2">
                    {r.is_active === 1 ? <span className="badge-green">نشط</span> : <span className="badge-slate">معطل</span>}
                  </td>
                  <td className="py-2 text-left">
                    <button className="text-xs text-blue-600 hover:underline" onClick={() => setEditing(r)}>تعديل</button>
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
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
type SetupTab = 'general' | 'inventory'

export default function PostingSetupPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') ?? 'general') as SetupTab

  return (
    <div className="animate-fade-in space-y-6">
      <div className="page-header">
        <h1 className="page-title">إعداد الترحيل</h1>
        <p className="text-slate-500 text-sm mt-1">
          تعريف الحسابات لكل تركيبة من مجموعات الأعمال والمنتجات والمخزون
        </p>
        <div className="mt-3">
          <Link to="/gl/setup-wizard" className="btn-secondary text-sm">فتح معالج الإعداد</Link>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-6">
          {([['general', 'الإعداد العام (BPG × PPG)'], ['inventory', 'إعداد المخزون (IPG × PPG)']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setParams({ tab: k })}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === k ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="card p-6">
        {tab === 'general'    && <GeneralSetupTab />}
        {tab === 'inventory'  && <InventorySetupTab />}
      </div>
    </div>
  )
}
