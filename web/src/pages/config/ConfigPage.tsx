import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Settings, Calendar, Package, MapPin, BookOpen, Tag } from 'lucide-react'
import { configApi } from '../../api/client'
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

export default function ConfigPage() {
  const { tab: tabParam } = useParams<{ tab?: Tab }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>((tabParam as Tab) ?? 'seasons')

  const switchTab = (t: Tab) => { setTab(t); navigate(`/config/${t}`, { replace: true }) }

  const { data: seasons } = useQuery<Season[]>({ queryKey: ['seasons'], queryFn: () => configApi.seasons() as Promise<Season[]>, enabled: tab === 'seasons' })
  const { data: items }   = useQuery<Item[]>({ queryKey: ['config', 'items'], queryFn: () => configApi.items() as Promise<Item[]>, enabled: tab === 'items' })
  const { data: cc }      = useQuery<CostCenter[]>({ queryKey: ['config', 'cc'], queryFn: () => configApi.costCenters() as Promise<CostCenter[]>, enabled: tab === 'cost_centers' })

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Settings size={22} className="text-slate-400" />
          الإعدادات
        </h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
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
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">المواسم الزراعية</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الاسم','النوع','من','إلى','الحالة'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(seasons ?? []).map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                  <td className="px-4 py-3 text-slate-500">{s.season_type === 'winter' ? 'شتوي' : s.season_type === 'summer' ? 'صيفي' : 'سنوي'}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(s.start_date).toLocaleDateString('ar-EG')}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(s.end_date).toLocaleDateString('ar-EG')}</td>
                  <td className="px-4 py-3">
                    <span className={STATUS_BADGE[s.status] ?? 'badge-slate'}>{STATUS_LABEL[s.status] ?? s.status}</span>
                  </td>
                </tr>
              ))}
              {!(seasons ?? []).length && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">لا توجد مواسم مسجلة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Items */}
      {tab === 'items' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="font-semibold text-slate-800">الأصناف المخزنية</h2>
          </div>
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
                  <td className="px-4 py-3 text-slate-500">{i.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{i.name}</td>
                  <td className="px-4 py-3 text-slate-500">{i.unit ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{i.warehouse ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{i.reorder_threshold}</td>
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
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="font-semibold text-slate-800">مراكز التكلفة (البيفوتات)</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الكود','الاسم'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(cc ?? []).map(c => (
                <tr key={c.code} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 w-24">{c.code}</td>
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

      {/* Other tabs placeholder */}
      {(tab === 'accounts' || tab === 'expense_types') && (
        <div className="card p-16 text-center text-slate-400">
          <Settings size={40} className="mx-auto mb-3 opacity-30" />
          سيتم إضافة هذا القسم قريباً
        </div>
      )}
    </div>
  )
}
