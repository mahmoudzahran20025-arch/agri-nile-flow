import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Plus, Users, ArrowLeftRight, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, LayoutDashboard, Loader2,
  TrendingUp, AlertTriangle, Briefcase, Activity, Wand2, BarChart2,
} from 'lucide-react'
import { adminApi, type CompanyOverview } from '../../api/client'
import { useAppStore } from '../../store/appStore'
import Modal from '../../components/ui/Modal'
import { useToast } from '../../contexts/ToastContext'

interface CompanyRow {
  id:             number
  code:           string
  name:           string
  is_active:      number
  user_count:     number
  supplier_count: number
  txn_count:      number
  cash_balance:   number | null
}

function egp(n: number | null) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

const EMPTY_FORM = { code: '', name: '', address: '', phone: '' }

export default function SuperAdminPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { setAuth } = useAppStore()
  const navigate = useNavigate()

  const [openAdd,     setOpenAdd]   = useState(false)
  const [expanded,    setExpanded]  = useState<number | null>(null)
  const [switching,   setSwitching] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [err,  setErr]  = useState('')

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['admin-companies'],
    queryFn:  () => adminApi.companies() as Promise<CompanyRow[]>,
  })

  const { data: companyUsers } = useQuery({
    queryKey: ['admin-company-users', expanded],
    queryFn:  () => adminApi.companyUsers(expanded!) as Promise<{ id: number; email: string; full_name: string; role: string; is_active: number; last_login: string | null }[]>,
    enabled:  expanded !== null,
  })

  const createMutation = useMutation({
    mutationFn: () => adminApi.createCompanyRaw(form),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setErr((res as { error: string }).error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['admin-companies'] })
      toast('تم إنشاء الشركة بنجاح', 'success')
      setOpenAdd(false)
      setForm(EMPTY_FORM)
      setErr('')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: number }) =>
      adminApi.updateCompany(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-companies'] }),
  })

  const handleSwitch = async (company: CompanyRow) => {
    setSwitching(company.id)
    try {
      const res = await adminApi.switchCompany(company.id, setAuth)
      if (!(res as { success: boolean }).success) {
        toast((res as { error: string }).error || 'فشل التبديل', 'error')
        return
      }
      toast(`تم التبديل إلى ${company.name}`, 'success')
      window.location.href = '/dashboard'
    } catch {
      toast('فشل التبديل', 'error')
    } finally {
      setSwitching(null)
    }
  }

  const ROLE_AR: Record<string, string> = {
    super_admin: 'مدير النظام', company_admin: 'مدير الشركة',
    accountant: 'محاسب', warehouse_mgr: 'مدير مخازن',
    field_supervisor: 'مشرف حقلي', viewer: 'مشاهدة فقط',
  }

  const [activeTab, setActiveTab] = useState<'overview' | 'companies'>('overview')

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 size={24} className="text-brand-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">لوحة تحكم مدير النظام</h1>
            <p className="text-sm text-gray-500">إدارة جميع الشركات المرتبطة بنواة المستقبل</p>
          </div>
          <span className="badge badge-blue">{(companies as CompanyRow[]).length} شركة</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            onClick={() => setOpenAdd(true)}
            title="إضافة سريعة"
          >
            <Plus size={14} />
          </button>
          <button
            className="btn btn-secondary gap-2"
            onClick={() => navigate('/admin/consolidated-pnl')}
          >
            <BarChart2 size={16} /> P&L مجمع
          </button>
          <button
            className="btn btn-primary gap-2"
            onClick={() => navigate('/admin/onboarding')}
          >
            <Wand2 size={16} /> معالج إعداد شركة
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {[
          { key: 'overview',   label: 'نظرة عامة',     icon: <LayoutDashboard size={14} /> },
          { key: 'companies',  label: 'قائمة الشركات', icon: <Building2       size={14} /> },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && <CompanyOverviewGrid />}

      {/* Companies list tab */}
      {activeTab === 'companies' && <>
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{(companies as CompanyRow[]).length}</p>
          <p className="text-sm text-gray-500 mt-1">إجمالي الشركات</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-700">
            {(companies as CompanyRow[]).filter(c => c.is_active).length}
          </p>
          <p className="text-sm text-gray-500 mt-1">شركة نشطة</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-brand-700">
            {(companies as CompanyRow[]).reduce((s, c) => s + (c.user_count ?? 0), 0)}
          </p>
          <p className="text-sm text-gray-500 mt-1">إجمالي المستخدمين</p>
        </div>
      </div>

      {/* Companies list */}
      {isLoading ? (
        <p className="text-center text-gray-500 py-10">جاري التحميل...</p>
      ) : (
        <div className="space-y-3">
          {(companies as CompanyRow[]).map(co => (
            <div key={co.id} className="card overflow-hidden">
              {/* Company row */}
              <div className="flex items-center gap-4 p-4">
                <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                  <Building2 size={20} className="text-brand-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-gray-900">{co.name}</p>
                    <span className="font-mono text-xs text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">{co.code}</span>
                    <span className={co.is_active ? 'badge-green' : 'badge-slate'}>
                      {co.is_active ? 'نشطة' : 'موقوفة'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                    <span>{co.user_count ?? 0} مستخدم</span>
                    <span>{co.supplier_count ?? 0} مورد</span>
                    <span>{co.txn_count ?? 0} حركة</span>
                    <span className="font-medium text-gray-700">
                      الخزينة: {egp(co.cash_balance)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-ghost gap-1 text-sm"
                    onClick={() => setExpanded(expanded === co.id ? null : co.id)}
                  >
                    <Users size={15} />
                    {expanded === co.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    className="btn btn-secondary gap-1 text-sm"
                    onClick={() => handleSwitch(co)}
                    disabled={switching === co.id || !co.is_active}
                    title="إدارة هذه الشركة"
                  >
                    <ArrowLeftRight size={14} />
                    {switching === co.id ? 'جاري...' : 'إدارة'}
                  </button>
                  <button
                    onClick={() => toggleMutation.mutate({ id: co.id, is_active: co.is_active ? 0 : 1 })}
                    className={`p-2 rounded-lg transition-colors ${
                      co.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'
                    }`}
                    title={co.is_active ? 'إيقاف الشركة' : 'تفعيل الشركة'}
                  >
                    {co.is_active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                  </button>
                </div>
              </div>

              {/* Users sub-panel */}
              {expanded === co.id && (
                <div className="border-t bg-gray-50 p-4">
                  <p className="text-xs font-semibold text-gray-500 mb-2">المستخدمون</p>
                  {!companyUsers ? (
                    <p className="text-xs text-gray-400">جاري التحميل...</p>
                  ) : companyUsers.length === 0 ? (
                    <p className="text-xs text-gray-400">لا يوجد مستخدمون مسجلون</p>
                  ) : (
                    <div className="space-y-1.5">
                      {companyUsers.map(u => (
                        <div key={u.id} className="flex items-center gap-3 text-sm">
                          <span className="font-medium text-gray-800 w-36 truncate">{u.full_name}</span>
                          <span className="text-gray-400 font-mono text-xs flex-1 truncate">{u.email}</span>
                          <span className="badge badge-blue text-xs">{ROLE_AR[u.role] ?? u.role}</span>
                          <span className={`badge text-xs ${u.is_active ? 'badge-green' : 'badge-slate'}`}>
                            {u.is_active ? 'نشط' : 'موقوف'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Company Modal */}
      <Modal open={openAdd} onClose={() => setOpenAdd(false)} title="إضافة شركة جديدة" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">كود الشركة * (مثال: NAWA02)</label>
              <input
                className="input font-mono uppercase"
                value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="NAWA02"
              />
            </div>
            <div>
              <label className="label">اسم الشركة *</label>
              <input
                className="input"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="شركة النهر للزراعة"
              />
            </div>
          </div>
          <div>
            <label className="label">العنوان</label>
            <input
              className="input"
              value={form.address}
              onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
              placeholder="القاهرة، مصر"
            />
          </div>
          <div>
            <label className="label">رقم الهاتف</label>
            <input
              className="input"
              value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              placeholder="010xxxxxxxx"
            />
          </div>
          <p className="text-xs text-gray-500 bg-brand-50 rounded-lg p-3">
            سيتم تهيئة شجرة الحسابات والفترة المالية تلقائياً عند إنشاء الشركة.
          </p>
        </div>
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setOpenAdd(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.code || !form.name}
          >
            {createMutation.isPending ? 'جاري الإنشاء...' : 'إنشاء الشركة'}
          </button>
        </div>
      </Modal>
      </>}
    </div>
  )
}

// ── Company Overview Grid (E-4) ───────────────────────────────
function HealthDot({ score }: { score: number }) {
  const color = score >= 85 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500'
  return <span className={`w-2.5 h-2.5 rounded-full inline-block ${color}`} title={`${score}/100`} />
}

function CompanyOverviewGrid() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['admin-overview'],
    queryFn:  adminApi.overview,
    staleTime: 60_000,
  })

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-400" size={32} /></div>
  }

  const active    = rows.filter(r => r.is_active)
  const totalCash = active.reduce((s, r) => s + (r.cash_balance ?? 0), 0)
  const totalWO   = active.reduce((s, r) => s + r.open_wo, 0)
  const totalPO   = active.reduce((s, r) => s + r.open_po_value, 0)
  const alerts    = active.filter(r => r.low_stock_count > 0 || r.open_wo > 5).length

  return (
    <div className="space-y-5">
      {/* Fleet stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي السيولة', value: `${egp(totalCash)} ج.م`, icon: <TrendingUp size={18} />, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
          { label: 'أوامر عمل مفتوحة', value: String(totalWO), icon: <Activity size={18} />,    color: 'text-blue-600 bg-blue-50 border-blue-200' },
          { label: 'قيمة مشتريات مفتوحة', value: `${egp(totalPO)} ج.م`, icon: <Briefcase size={18} />, color: 'text-amber-600 bg-amber-50 border-amber-200' },
          { label: 'شركات تحتاج متابعة', value: String(alerts), icon: <AlertTriangle size={18} />, color: 'text-red-600 bg-red-50 border-red-200' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-4 flex items-center gap-3 ${s.color}`}>
            {s.icon}
            <div>
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-xs opacity-70 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Company cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(rows as CompanyOverview[]).sort((a, b) => b.health_score - a.health_score).map(co => {
          const healthColor = co.health_score >= 85 ? 'border-emerald-200' : co.health_score >= 60 ? 'border-amber-200' : 'border-red-200'
          return (
            <div key={co.id} className={`bg-white rounded-2xl border-2 ${healthColor} shadow-sm p-4 space-y-3`}>
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <HealthDot score={co.health_score} />
                    <span className="text-xs font-mono text-gray-400">{co.code}</span>
                    {!co.is_active && (
                      <span className="text-[10px] bg-gray-100 text-gray-400 rounded-full px-1.5 py-0.5">غير نشط</span>
                    )}
                  </div>
                  <p className="font-bold text-gray-800 text-sm mt-1 truncate">{co.name}</p>
                  {co.active_season && (
                    <p className="text-xs text-emerald-600 mt-0.5">{co.active_season}</p>
                  )}
                </div>
                <div className="text-left shrink-0">
                  <p className="text-lg font-bold text-gray-900">{egp(co.cash_balance)}</p>
                  <p className="text-[10px] text-gray-400">ج.م خزينة</p>
                </div>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100 text-center">
                <div>
                  <p className={`text-lg font-bold ${co.open_wo > 5 ? 'text-amber-600' : 'text-gray-800'}`}>{co.open_wo}</p>
                  <p className="text-[10px] text-gray-400">أوامر مفتوحة</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-800">{co.employee_count}</p>
                  <p className="text-[10px] text-gray-400">موظف</p>
                </div>
                <div>
                  <p className={`text-lg font-bold ${co.low_stock_count > 0 ? 'text-red-600' : 'text-gray-800'}`}>{co.low_stock_count}</p>
                  <p className="text-[10px] text-gray-400">تنبيه مخزون</p>
                </div>
              </div>

              {/* PO info */}
              {co.open_po_count > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                  {co.open_po_count} طلب شراء مفتوح · {egp(co.open_po_value)} ج.م
                </p>
              )}

              {/* Last activity */}
              {co.last_activity && (
                <p className="text-[10px] text-gray-300 text-left">
                  آخر نشاط: {co.last_activity.slice(0, 10)}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
