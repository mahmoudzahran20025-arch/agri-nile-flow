import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings, Calendar, Package, MapPin, BookOpen, Tag, Plus, ChevronDown } from 'lucide-react'
import { configApi, api } from '../../api/client'
import AddSeasonModal      from '../../components/forms/AddSeasonModal'
import AddItemModal        from '../../components/forms/AddItemModal'
import AddMasterRecordModal from '../../components/forms/AddMasterRecordModal'
import type { Season, Item, CostCenter } from '../../types'

type Tab = 'seasons' | 'items' | 'cost_centers' | 'accounts' | 'expense_types'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'seasons',       label: 'المواسم',         icon: <Calendar size={16} /> },
  { id: 'items',         label: 'الأصناف',          icon: <Package  size={16} /> },
  { id: 'cost_centers',  label: 'مراكز التكلفة',    icon: <MapPin   size={16} /> },
  { id: 'accounts',      label: 'الحسابات',         icon: <BookOpen size={16} /> },
  { id: 'expense_types', label: 'أنواع المصروفات',  icon: <Tag      size={16} /> },
]

const STATUS_BADGE: Record<string, string> = {
  planning:   'badge-blue',
  active:     'badge-green',
  harvesting: 'badge-amber',
  closed:     'badge-slate',
}
const STATUS_LABEL: Record<string, string> = {
  planning: 'تخطيط', active: 'نشط', harvesting: 'حصاد', closed: 'مغلق',
}
const STATUS_NEXT: Record<string, { label: string; value: string }[]> = {
  planning:   [{ label: 'تفعيل', value: 'active' }],
  active:     [{ label: 'حصاد', value: 'harvesting' }, { label: 'إغلاق', value: 'closed' }],
  harvesting: [{ label: 'إغلاق', value: 'closed' }],
  closed:     [],
}

interface Account  { code: number; company_id: number; name: string }
interface ExpenseType { code: number; company_id: number; name: string }

function SeasonStatusMenu({ season }: { season: Season }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const actions = STATUS_NEXT[season.status] ?? []
  if (!actions.length) return null

  const change = async (status: string) => {
    setOpen(false)
    await configApi.updateSeasonStatus(season.id, status)
    await qc.invalidateQueries({ queryKey: ['seasons'] })
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 hover:bg-brand-50 px-2 py-1 rounded-lg"
      >
        تغيير الحالة <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-slate-200 z-10 min-w-[110px]">
          {actions.map(a => (
            <button
              key={a.value}
              onClick={() => change(a.value)}
              className="block w-full text-right px-3 py-2 text-sm hover:bg-slate-50 text-slate-700"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ConfigPage() {
  const { tab: tabParam } = useParams<{ tab?: Tab }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>((tabParam as Tab) ?? 'seasons')

  const [seasonModal,   setSeasonModal]   = useState(false)
  const [itemModal,     setItemModal]     = useState(false)
  const [ccModal,       setCcModal]       = useState(false)
  const [acctModal,     setAcctModal]     = useState(false)
  const [expModal,      setExpModal]      = useState(false)

  const switchTab = (t: Tab) => { setTab(t); navigate(`/config/${t}`, { replace: true }) }

  const { data: seasons } = useQuery<Season[]>({
    queryKey: ['seasons'],
    queryFn:  () => configApi.seasons() as Promise<Season[]>,
    enabled:  tab === 'seasons',
  })
  const { data: items } = useQuery<Item[]>({
    queryKey: ['config', 'items'],
    queryFn:  () => configApi.items() as Promise<Item[]>,
    enabled:  tab === 'items',
  })
  const { data: cc } = useQuery<CostCenter[]>({
    queryKey: ['config', 'cc'],
    queryFn:  () => configApi.costCenters() as Promise<CostCenter[]>,
    enabled:  tab === 'cost_centers',
  })
  const { data: accounts } = useQuery<Account[]>({
    queryKey: ['config', 'accounts'],
    queryFn:  () => configApi.accounts() as Promise<Account[]>,
    enabled:  tab === 'accounts',
  })
  const { data: expenseTypes } = useQuery<ExpenseType[]>({
    queryKey: ['config', 'expense_types'],
    queryFn:  () => configApi.expenseTypes() as Promise<ExpenseType[]>,
    enabled:  tab === 'expense_types',
  })

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Settings size={22} className="text-slate-400" />
          الإعدادات
        </h1>
        {tab === 'seasons'       && <button className="btn-primary gap-2" onClick={() => setSeasonModal(true)}><Plus size={15}/>موسم جديد</button>}
        {tab === 'items'         && <button className="btn-primary gap-2" onClick={() => setItemModal(true)}><Plus size={15}/>صنف جديد</button>}
        {tab === 'cost_centers'  && <button className="btn-primary gap-2" onClick={() => setCcModal(true)}><Plus size={15}/>مركز تكلفة</button>}
        {tab === 'accounts'      && <button className="btn-primary gap-2" onClick={() => setAcctModal(true)}><Plus size={15}/>حساب جديد</button>}
        {tab === 'expense_types' && <button className="btn-primary gap-2" onClick={() => setExpModal(true)}><Plus size={15}/>نوع مصروف</button>}
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Seasons */}
      {tab === 'seasons' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الاسم','النوع','من','إلى','الحالة',''].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(seasons ?? []).map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {s.season_type === 'winter' ? 'شتوي' : s.season_type === 'summer' ? 'صيفي' : 'سنوي'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(s.start_date).toLocaleDateString('ar-EG')}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(s.end_date).toLocaleDateString('ar-EG')}</td>
                  <td className="px-4 py-3">
                    <span className={STATUS_BADGE[s.status] ?? 'badge-slate'}>{STATUS_LABEL[s.status] ?? s.status}</span>
                  </td>
                  <td className="px-4 py-3"><SeasonStatusMenu season={s} /></td>
                </tr>
              ))}
              {!(seasons ?? []).length && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">لا توجد مواسم — أضف موسماً للبدء</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Items */}
      {tab === 'items' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الكود','الصنف','الوحدة','المخزن','حد التنبيه','الحالة'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(items ?? []).map(i => (
                <tr key={i.code} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-400 font-mono">{i.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{i.name}</td>
                  <td className="px-4 py-3 text-slate-500">{i.unit ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{i.warehouse ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{i.reorder_threshold ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={i.is_active ? 'badge-green' : 'badge-slate'}>
                      {i.is_active ? 'نشط' : 'موقوف'}
                    </span>
                  </td>
                </tr>
              ))}
              {!(items ?? []).length && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">لا توجد أصناف مسجلة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Cost Centers */}
      {tab === 'cost_centers' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الكود','اسم المركز / المحصول'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(cc ?? []).map(c => (
                <tr key={c.code} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-400 font-mono w-24">{c.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                </tr>
              ))}
              {!(cc ?? []).length && (
                <tr><td colSpan={2} className="px-4 py-12 text-center text-slate-400">لا توجد مراكز تكلفة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Accounts */}
      {tab === 'accounts' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الكود','اسم الحساب'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(accounts ?? []).map(a => (
                <tr key={a.code} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-400 font-mono w-24">{a.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{a.name}</td>
                </tr>
              ))}
              {!(accounts ?? []).length && (
                <tr><td colSpan={2} className="px-4 py-12 text-center text-slate-400">لا توجد حسابات مسجلة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Expense Types */}
      {tab === 'expense_types' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الكود','نوع المصروف'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(expenseTypes ?? []).map(et => (
                <tr key={et.code} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-400 font-mono w-24">{et.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{et.name}</td>
                </tr>
              ))}
              {!(expenseTypes ?? []).length && (
                <tr><td colSpan={2} className="px-4 py-12 text-center text-slate-400">لا توجد أنواع مصروفات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <AddSeasonModal open={seasonModal} onClose={() => setSeasonModal(false)} />
      <AddItemModal   open={itemModal}   onClose={() => setItemModal(false)} />
      <AddMasterRecordModal
        open={ccModal} onClose={() => setCcModal(false)}
        title="إضافة مركز تكلفة" endpoint="/config/cost_centers" queryKey={['config', 'cc']}
      />
      <AddMasterRecordModal
        open={acctModal} onClose={() => setAcctModal(false)}
        title="إضافة حساب" endpoint="/config/accounts" queryKey={['config', 'accounts']}
      />
      <AddMasterRecordModal
        open={expModal} onClose={() => setExpModal(false)}
        title="إضافة نوع مصروف" endpoint="/config/expense_types" queryKey={['config', 'expense_types']}
      />
    </div>
  )
}
