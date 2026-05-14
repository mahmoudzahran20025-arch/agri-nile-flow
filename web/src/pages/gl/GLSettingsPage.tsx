import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Settings, CalendarDays, Link2, AlertTriangle, CheckCircle2, Pencil, Trash2, X, Save } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import PeriodsPage from './PeriodsPage'
import { glApi } from '../../api/client'

type Tab = 'periods' | 'control-accounts'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'periods',          icon: <CalendarDays size={15} />, label: 'الفترات المالية' },
  { id: 'control-accounts', icon: <Link2 size={15} />,        label: 'حسابات التحكم' },
]

// Human-readable labels + descriptions for each mapping key
const KEY_META: Record<string, { label: string; desc: string; critical: boolean }> = {
  accounts_payable:        { label: 'ذمم الموردين (AP)',          desc: 'الحساب الدائن الافتراضي عند تسجيل فاتورة مورد',           critical: true  },
  accounts_receivable:     { label: 'ذمم العملاء (AR)',           desc: 'الحساب المدين عند تسجيل إيراد أو حصاد مباع',              critical: true  },
  cash:                    { label: 'الخزينة / النقدية',          desc: 'حساب النقدية لعمليات الصرف والاستلام',                    critical: true  },
  inventory:               { label: 'المخزون',                   desc: 'حساب أصل المخزون عند الاستلام (GRN)',                     critical: true  },
  cost_of_goods:           { label: 'تكلفة البضاعة (COGS)',       desc: 'حساب التكلفة عند صرف المخزون للحقل (ISSUE) أو الحصاد',   critical: true  },
  revenue_default:         { label: 'الإيرادات (افتراضي)',        desc: 'حساب الإيراد الافتراضي إذا لم يوجد ربط محصول محدد',       critical: true  },
  revenue_crops:           { label: 'إيرادات المحاصيل',          desc: 'حساب إيراد الحصاد — يُستخدم في postHarvestLedger',        critical: true  },
  expense_default:         { label: 'المصروفات (افتراضي)',        desc: 'حساب المصروف الافتراضي للعمليات التشغيلية',               critical: false },
  deferred_revenue:        { label: 'الإيرادات المؤجلة',         desc: 'حساب الدفعات المقدمة من العملاء (عقود البيع)',             critical: false },
  equity:                  { label: 'حقوق الملكية',              desc: 'حساب رأس المال عند ضخ رأس مال أو تسوية',                  critical: false },
  partner_capital:         { label: 'رأس مال الشركاء',           desc: 'حساب رأس مال كل شريك (مدفوع)',                           critical: false },
  partner_current_account: { label: 'الحسابات الجارية للشركاء',  desc: 'حسابات الشركاء الجارية للمسحوبات والإضافات',              critical: false },
  wages_expense:           { label: 'مصروف الرواتب',             desc: 'حساب المدين عند ترحيل الرواتب',                          critical: false },
  wages_payable:           { label: 'الرواتب المستحقة',          desc: 'حساب المطلوبات عند إنشاء قيد الرواتب',                   critical: false },
  depreciation_expense:    { label: 'مصروف الإهلاك',             desc: 'المدين في قيد الإهلاك الشهري',                           critical: false },
  accumulated_depreciation:{ label: 'مجمع الإهلاك',             desc: 'الدائن في قيد الإهلاك الشهري',                           critical: false },
  wip_asset:               { label: 'أصول الإنتاج تحت التشغيل', desc: 'WIP carry-forward للمحاصيل متعددة المواسم',               critical: false },
  wip_contra:              { label: 'مقابل WIP',                 desc: 'الحساب المقابل في قيد ترحيل WIP',                        critical: false },
}

interface ControlRow {
  mapping_key:  string
  id:           number | null
  account_code: string | null
  is_active:    number
  updated_at:   string | null
  seeded:       boolean
}

function ControlAccountsTab() {
  const qc = useQueryClient()
  const [editing, setEditing]   = useState<string | null>(null)
  const [inputVal, setInputVal] = useState('')
  const [error, setError]       = useState('')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['gl-control-accounts'],
    queryFn:  () => glApi.controlAccounts() as Promise<ControlRow[]>,
  })

  const upsert = useMutation({
    mutationFn: ({ key, code }: { key: string; code: string }) =>
      glApi.upsertControlAccount(key, code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-control-accounts'] })
      setEditing(null)
      setInputVal('')
      setError('')
    },
    onError: (e: Error) => setError(e.message ?? 'حدث خطأ'),
  })

  const remove = useMutation({
    mutationFn: (key: string) => glApi.deleteControlAccount(key),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['gl-control-accounts'] }),
  })

  const criticalUnseeded = (rows as ControlRow[]).filter(
    r => KEY_META[r.mapping_key]?.critical && (!r.seeded || !r.is_active || !r.account_code)
  )

  const startEdit = (row: ControlRow) => {
    setEditing(row.mapping_key)
    setInputVal(row.account_code ?? '')
    setError('')
  }

  const save = (key: string) => {
    if (!inputVal.trim()) { setError('كود الحساب مطلوب'); return }
    upsert.mutate({ key, code: inputVal.trim() })
  }

  return (
    <div className="space-y-4">
      {/* Alert banner for critical missing */}
      {criticalUnseeded.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-bold">{criticalUnseeded.length} حسابات تحكم أساسية غير مربوطة</span>
            <span className="text-red-500 mr-1">— ترحيل الحصاد وصرف المخزون سيفشل بدونها</span>
          </div>
        </div>
      )}

      {/* Critical section */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-red-50/30">
          <h3 className="text-[13px] font-bold text-slate-700">حسابات أساسية <span className="text-red-500 text-[11px] font-normal mr-1">(مطلوبة للترحيل)</span></h3>
        </div>
        {isLoading ? (
          <div className="px-4 py-6 text-center text-slate-400 text-[12px]">جاري التحميل…</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['المفتاح', 'الوصف', 'كود الحساب', 'الحالة', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(rows as ControlRow[]).filter(r => KEY_META[r.mapping_key]?.critical).map(row => (
                <ControlRow
                  key={row.mapping_key} row={row}
                  editing={editing} inputVal={inputVal} error={error}
                  onEdit={() => startEdit(row)}
                  onInputChange={setInputVal}
                  onSave={() => save(row.mapping_key)}
                  onCancel={() => { setEditing(null); setError('') }}
                  onRemove={() => remove.mutate(row.mapping_key)}
                  saving={upsert.isPending}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Optional section */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-[13px] font-bold text-slate-700">حسابات اختيارية</h3>
        </div>
        {isLoading ? null : (
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['المفتاح', 'الوصف', 'كود الحساب', 'الحالة', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(rows as ControlRow[]).filter(r => !KEY_META[r.mapping_key]?.critical).map(row => (
                <ControlRow
                  key={row.mapping_key} row={row}
                  editing={editing} inputVal={inputVal} error={error}
                  onEdit={() => startEdit(row)}
                  onInputChange={setInputVal}
                  onSave={() => save(row.mapping_key)}
                  onCancel={() => { setEditing(null); setError('') }}
                  onRemove={() => remove.mutate(row.mapping_key)}
                  saving={upsert.isPending}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ControlRow({
  row, editing, inputVal, error,
  onEdit, onInputChange, onSave, onCancel, onRemove, saving,
}: {
  row: ControlRow
  editing: string | null
  inputVal: string
  error: string
  onEdit: () => void
  onInputChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
  onRemove: () => void
  saving: boolean
}) {
  const meta    = KEY_META[row.mapping_key]
  const isActive = row.seeded && row.is_active && row.account_code
  const isEditing = editing === row.mapping_key

  return (
    <tr className={`hover:bg-slate-50 ${!isActive && meta?.critical ? 'bg-red-50/30' : ''}`}>
      <td className="px-4 py-2.5">
        <span className="font-mono text-[11px] text-slate-600">{row.mapping_key}</span>
      </td>
      <td className="px-4 py-2.5 text-slate-500 max-w-[260px]">
        <p className="font-medium text-slate-700 text-[12px]">{meta?.label ?? row.mapping_key}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">{meta?.desc}</p>
      </td>
      <td className="px-4 py-2.5">
        {isEditing ? (
          <div className="space-y-1">
            <input
              autoFocus
              type="text"
              className="input h-7 text-[12px] w-32 font-mono"
              placeholder="كود الحساب"
              value={inputVal}
              onChange={e => onInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel() }}
            />
            {error && <p className="text-[10px] text-red-600">{error}</p>}
          </div>
        ) : (
          <span className={`font-mono text-[12px] ${isActive ? 'text-slate-800' : 'text-slate-300 italic'}`}>
            {row.account_code ?? '— غير مربوط —'}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {isActive
          ? <span className="flex items-center gap-1 text-emerald-600 text-[11px]"><CheckCircle2 size={12} /> نشط</span>
          : <span className="flex items-center gap-1 text-slate-400 text-[11px]"><AlertTriangle size={12} className={meta?.critical ? 'text-red-400' : ''} /> غير مربوط</span>
        }
      </td>
      <td className="px-4 py-2.5">
        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <button onClick={onSave} disabled={saving}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-[#0F2D5C] text-white hover:bg-[#1a3d7c] disabled:opacity-50">
              <Save size={11} /> {saving ? '…' : 'حفظ'}
            </button>
            <button onClick={onCancel}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-500 hover:bg-slate-100">
              <X size={11} /> إلغاء
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button onClick={onEdit}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-500 hover:bg-slate-100 border border-slate-200">
              <Pencil size={11} /> {row.seeded ? 'تعديل' : 'ربط'}
            </button>
            {row.seeded && (
              <button onClick={onRemove}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-400 hover:text-red-600 hover:bg-red-50">
                <Trash2 size={11} />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

export default function GLSettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'periods'

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Settings size={22} className="text-slate-500" />
          <div>
            <h1 className="page-title">إعدادات المحاسبة</h1>
            <p className="text-sm text-slate-500">الفترات المالية · حسابات التحكم</p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-end gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`
              flex items-center gap-2 px-5 py-2.5 text-sm font-bold border-b-2 -mb-px transition-all
              ${tab === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'}
            `}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'periods' && (
          <div className="[&_.page-header]:hidden [&_.page-title]:hidden">
            <PeriodsPage />
          </div>
        )}
        {tab === 'control-accounts' && <ControlAccountsTab />}
      </div>
    </div>
  )
}
