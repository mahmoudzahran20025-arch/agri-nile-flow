import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Settings, Calendar, Package, MapPin, BookOpen,
  Tag, Plus, ChevronDown, Lock, LockOpen, AlertTriangle, Info, CheckCircle
} from 'lucide-react'
import { configApi, glApi } from '../../api/client'
import { usePermission } from '../../hooks/usePermission'
import Modal from '../../components/ui/Modal'
import AddSeasonModal       from '../../components/forms/AddSeasonModal'
import AddItemModal         from '../../components/forms/AddItemModal'
import AddMasterRecordModal from '../../components/forms/AddMasterRecordModal'
import type { Season, Item, CostCenter, FinancialPeriod } from '../../types'

type Tab = 'seasons' | 'items' | 'cost_centers' | 'accounts' | 'expense_types' | 'periods' | 'mappings'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'seasons',       label: 'المواسم',         icon: <Calendar size={16} /> },
  { id: 'items',         label: 'الأصناف',          icon: <Package  size={16} /> },
  { id: 'cost_centers',  label: 'مراكز التكلفة',    icon: <MapPin   size={16} /> },
  { id: 'accounts',      label: 'الحسابات',         icon: <BookOpen size={16} /> },
  { id: 'expense_types', label: 'أنواع المصروفات',  icon: <Tag      size={16} /> },
  { id: 'periods',       label: 'الفترات المالية',  icon: <Lock     size={16} /> },
  { id: 'mappings',      label: 'ربط الحسابات',     icon: <Settings size={16} /> },
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

interface Account    { code: number; company_id: number; name: string }
interface ExpenseType { code: number; company_id: number; name: string }

// ─── Season Close Check Modal ────────────────────────────────
function SeasonCloseModal({ season, open, onClose }: { season: Season; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [closing, setClosing] = useState(false)
  const [closeNotes, setCloseNotes] = useState('')

  type CheckItem = { key: string; label: string; count: number; amount: number | null; ok: boolean; blocker: boolean }
  type CloseCheckData = { season: { id: number; name: string; status: string }; checks: CheckItem[]; can_close: boolean }

  const { data, isLoading } = useQuery<CloseCheckData>({
    queryKey: ['season-close-check', season.id],
    queryFn:  () => configApi.seasonCloseCheck(season.id) as Promise<CloseCheckData>,
    enabled:  open,
    staleTime: 10_000,
  })

  // Also check for draft transactions
  const draftCashQ = useQuery<{ total: number; count: number }>({
    queryKey: ['season-draft-cash', season.id],
    queryFn: async () => {
      // This is a lightweight check — we can't query directly without an API, so we use the checks from close-check
      return { total: 0, count: 0 }
    },
    enabled: open,
  })
  void draftCashQ

  const allChecks = data?.checks ?? []
  const hasWarnings = allChecks.some(ch => !ch.ok)

  const handleClose = async () => {
    setClosing(true)
    try {
      await configApi.closeSeason(season.id, closeNotes || undefined)
      await qc.invalidateQueries({ queryKey: ['seasons'] })
      onClose()
    } finally {
      setClosing(false)
    }
  }

  return (
    <Modal open={open} title={`إغلاق الموسم: ${season.name}`} onClose={onClose} size="md">
      <div className="space-y-4">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">جاري فحص البيانات...</div>
        ) : (
          <>
            {/* Checklist */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">قائمة التحقق قبل الإغلاق</p>
              {allChecks.map(ch => (
                <div key={ch.key}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 border
                    ${ch.ok
                      ? 'bg-green-50 border-green-200'
                      : ch.blocker
                        ? 'bg-red-50 border-red-200'
                        : 'bg-amber-50 border-amber-200'}`}
                >
                  <span className={`text-lg ${ch.ok ? 'text-green-600' : ch.blocker ? 'text-red-500' : 'text-amber-500'}`}>
                    {ch.ok ? '✓' : ch.blocker ? '✗' : '⚠'}
                  </span>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${ch.ok ? 'text-green-800' : ch.blocker ? 'text-red-800' : 'text-amber-800'}`}>
                      {ch.label}
                    </p>
                    {!ch.ok && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {ch.count} عنصر{ch.amount ? ` — ${new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(ch.amount)}` : ''}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {hasWarnings && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-sm text-amber-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
                <span>هناك عناصر مفتوحة. يمكنك الإغلاق ولكن يُنصح بمعالجتها أولاً.</span>
              </div>
            )}

            {/* Close notes */}
            <div>
              <label className="label">ملاحظات الإغلاق (اختياري)</label>
              <textarea className="input" rows={2} placeholder="أسباب الإغلاق أو ملاحظات..."
                value={closeNotes} onChange={e => setCloseNotes(e.target.value)} />
            </div>

            <div className="flex gap-3 pt-1">
              <button className="btn-secondary flex-1" onClick={onClose} disabled={closing}>إلغاء</button>
              <button
                className={`flex-1 btn ${hasWarnings ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'} text-white`}
                onClick={handleClose} disabled={closing || !data?.can_close}
              >
                {closing ? 'جاري الإغلاق...' : hasWarnings ? 'إغلاق رغم التحذيرات' : 'تأكيد الإغلاق'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ─── Season Status Dropdown ──────────────────────────────────
function SeasonStatusMenu({ season }: { season: Season }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [closeModalOpen, setCloseModalOpen] = useState(false)
  const actions = STATUS_NEXT[season.status] ?? []
  if (!actions.length) return null

  const change = async (status: string) => {
    setOpen(false)
    if (status === 'closed') {
      // Open close-check modal instead of direct close
      setCloseModalOpen(true)
      return
    }
    await configApi.updateSeasonStatus(season.id, status)
    await qc.invalidateQueries({ queryKey: ['seasons'] })
  }

  return (
    <>
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
                className={`block w-full text-right px-3 py-2 text-sm hover:bg-slate-50
                  ${a.value === 'closed' ? 'text-red-600 font-medium' : 'text-slate-700'}`}
              >
                {a.value === 'closed' ? '🔒 ' : ''}{a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <SeasonCloseModal season={season} open={closeModalOpen} onClose={() => setCloseModalOpen(false)} />
    </>
  )
}

// ─── Create Period Modal ─────────────────────────────────────
function CreatePeriodModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form, setForm] = useState({
    name:        '',
    period_type: 'monthly',
    start_date:  '',
    end_date:    '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.name)       { setError('الاسم مطلوب'); return }
    if (!form.start_date) { setError('تاريخ البداية مطلوب'); return }
    if (!form.end_date)   { setError('تاريخ النهاية مطلوب'); return }
    if (form.start_date >= form.end_date) { setError('تاريخ البداية يجب أن يسبق تاريخ النهاية'); return }

    setSaving(true)
    try {
      const res = await glApi.createPeriod(form)
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['gl-periods'] })
      setForm({ name: '', period_type: 'monthly', start_date: '', end_date: '' })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="إضافة فترة مالية جديدة" onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">اسم الفترة <span className="text-red-500">*</span></label>
          <input className="input" placeholder="مثال: يناير 2025 أو السنة المالية 2025"
            value={form.name} onChange={e => set('name', e.target.value)} required />
        </div>
        <div>
          <label className="label">نوع الفترة</label>
          <select className="input" value={form.period_type} onChange={e => set('period_type', e.target.value)}>
            <option value="monthly">شهرية</option>
            <option value="quarterly">ربع سنوية</option>
            <option value="annual">سنوية</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">تاريخ البداية <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={form.start_date}
              onChange={e => set('start_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">تاريخ النهاية <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={form.end_date}
              onChange={e => set('end_date', e.target.value)} required />
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-sm text-amber-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <span>تأكد من عدم تداخل التواريخ مع فترات مالية أخرى. الفترة الجديدة ستكون مفتوحة تلقائياً.</span>
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'إنشاء الفترة'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Period Close/Reopen Confirm Modal ───────────────────────
function PeriodActionModal({
  period, action, open, onClose,
}: {
  period: FinancialPeriod | null
  action: 'close' | 'reopen'
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [loading, setLoading] = useState(false)

  const confirm = async () => {
    if (!period) return
    setLoading(true)
    try {
      if (action === 'close') {
        await glApi.closePeriod(period.id)
      } else {
        await glApi.reopenPeriod(period.id)
      }
      await qc.invalidateQueries({ queryKey: ['gl-periods'] })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const isClose = action === 'close'

  return (
    <Modal open={open} title={isClose ? 'إغلاق الفترة المالية' : 'إعادة فتح الفترة المالية'} onClose={onClose} size="sm">
      <div className="space-y-4">
        <div className={`rounded-xl p-4 flex items-start gap-3 ${isClose ? 'bg-red-50' : 'bg-green-50'}`}>
          {isClose
            ? <Lock size={20} className="text-red-500 mt-0.5 shrink-0" />
            : <LockOpen size={20} className="text-green-600 mt-0.5 shrink-0" />
          }
          <div>
            <p className={`font-semibold text-sm ${isClose ? 'text-red-800' : 'text-green-800'}`}>
              {period?.name}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {isClose
                ? 'بعد الإغلاق لن يمكن تسجيل قيود جديدة في هذه الفترة. يمكن إعادة الفتح لاحقاً إذا لزم الأمر.'
                : 'إعادة الفتح ستسمح بتسجيل قيود جديدة في هذه الفترة مجدداً.'
              }
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={onClose} disabled={loading}>إلغاء</button>
          <button
            className={`flex-1 btn ${isClose ? 'bg-red-600 hover:bg-red-700 text-white' : 'btn-primary'}`}
            onClick={confirm}
            disabled={loading}
          >
            {loading ? 'جاري التنفيذ...' : isClose ? 'تأكيد الإغلاق' : 'تأكيد إعادة الفتح'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Periods Tab Content ─────────────────────────────────────
function PeriodsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [actionTarget, setActionTarget] = useState<FinancialPeriod | null>(null)
  const [actionType,   setActionType]   = useState<'close' | 'reopen'>('close')

  const { data: periods, isLoading } = useQuery<FinancialPeriod[]>({
    queryKey: ['gl-periods'],
    queryFn:  () => glApi.periods() as Promise<FinancialPeriod[]>,
  })

  void qc  // avoid unused warning

  const openAction = (p: FinancialPeriod, act: 'close' | 'reopen') => {
    setActionTarget(p)
    setActionType(act)
  }

  const PERIOD_TYPE: Record<string, string> = {
    monthly:   'شهرية',
    quarterly: 'ربع سنوية',
    annual:    'سنوية',
  }

  const openCount   = (periods ?? []).filter(p => !p.is_closed).length
  const closedCount = (periods ?? []).filter(p => p.is_closed).length

  return (
    <>
      {/* Summary chips */}
      {(periods ?? []).length > 0 && (
        <div className="flex gap-3 flex-wrap">
          <div className="card px-4 py-2.5 flex items-center gap-2 text-sm">
            <LockOpen size={14} className="text-green-500" />
            <span className="text-slate-500">مفتوحة:</span>
            <span className="font-semibold text-green-700">{openCount}</span>
          </div>
          <div className="card px-4 py-2.5 flex items-center gap-2 text-sm">
            <Lock size={14} className="text-slate-400" />
            <span className="text-slate-500">مغلقة:</span>
            <span className="font-semibold text-slate-600">{closedCount}</span>
          </div>
          {openCount === 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">
              <AlertTriangle size={14} className="text-red-500" />
              تحذير: لا توجد فترة مالية مفتوحة — لن تتمكن من تسجيل أي معاملات!
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-700">الفترات المالية</span>
          {canManage && (
            <button className="btn-primary gap-2 text-xs py-1.5 px-3" onClick={() => setCreateOpen(true)}>
              <Plus size={13} />فترة جديدة
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="p-16 text-center text-slate-400">جاري التحميل...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الاسم', 'النوع', 'من', 'إلى', 'الحالة', 'أُغلقت في', ''].map(h => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(periods ?? []).map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5 font-medium text-slate-800">{p.name}</td>
                  <td className="px-5 py-3.5 text-slate-500">{PERIOD_TYPE[p.period_type] ?? p.period_type}</td>
                  <td className="px-5 py-3.5 text-slate-500 tabular-nums">{p.start_date}</td>
                  <td className="px-5 py-3.5 text-slate-500 tabular-nums">{p.end_date}</td>
                  <td className="px-5 py-3.5">
                    {p.is_closed ? (
                      <span className="inline-flex items-center gap-1 badge-slate">
                        <Lock size={11} />مغلقة
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 badge-green">
                        <LockOpen size={11} />مفتوحة
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 text-xs tabular-nums">
                    {p.closed_at ? new Date(p.closed_at).toLocaleDateString('ar-EG') : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-left">
                    {canManage && (
                      p.is_closed ? (
                        <button
                          onClick={() => openAction(p, 'reopen')}
                          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 hover:bg-green-50 px-2 py-1 rounded-lg font-medium"
                        >
                          <LockOpen size={12} />إعادة فتح
                        </button>
                      ) : (
                        <button
                          onClick={() => openAction(p, 'close')}
                          className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg font-medium"
                        >
                          <Lock size={12} />إغلاق
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {!(periods ?? []).length && (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Lock size={32} className="text-slate-300" />
                      <p className="text-slate-400">لا توجد فترات مالية مسجلة</p>
                      {canManage && (
                        <button className="btn-primary gap-2 text-sm" onClick={() => setCreateOpen(true)}>
                          <Plus size={14} />إنشاء أول فترة مالية
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <CreatePeriodModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <PeriodActionModal
        period={actionTarget}
        action={actionType}
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
      />
    </>
  )
}

// ─── Mappings Tab Content ────────────────────────────────────
function MappingsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [success, setSuccess] = useState(false)

  // Fetch current mappings
  const { data: mappings = [], isLoading: loadingMap } = useQuery<Array<{ mapping_key: string; account_code: number }>>({
    queryKey: ['gl-mappings'],
    queryFn:  () => glApi.mappings() as Promise<Array<{ mapping_key: string; account_code: number }>>,
  })

  // Fetch available GL accounts to choose from
  const { data: accounts = [], isLoading: loadingAcc } = useQuery<Account[]>({
    queryKey: ['config', 'accounts-dropdown'],
    queryFn:  () => configApi.accounts() as Promise<Account[]>,
  })

  const [localMap, setLocalMap] = useState<Record<string, string>>({})

  // Sync local state when data arrives
  useEffect(() => {
    if (mappings.length) {
      const m: Record<string, string> = {}
      mappings.forEach(x => { m[x.mapping_key] = String(x.account_code) })
      setLocalMap(m)
    }
  }, [mappings])

  const KEYS = [
    { key: 'inventory',        label: 'حساب المخزون الرئيسي',    desc: 'يُستخدم في حركات الإضافة والصرف للمخازن' },
    { key: 'cash',             label: 'حساب النقدية (الصندوق)', desc: 'يُستخدم في المشتريات النقدية للمخزون' },
    { key: 'accounts_payable', label: 'حساب الموردين (الدائنون)',  desc: 'يُستخدم في المشتريات الآجلة للمخزون' },
    { key: 'cogs',             label: 'حساب تكلفة الإنتاج (COGS)', desc: 'يُستخدم عند صرف مخزن مرتبط بأمر شغل' },
    { key: 'expense_default',  label: 'حساب المصاريف العمومية', desc: 'يُستخدم عند صرف مخزن إداري أو غير مرنبط بإنتاج' },
  ]

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      const payload = Object.entries(localMap).map(([k, v]) => ({
        mapping_key: k,
        account_code: Number(v)
      })).filter(x => x.account_code > 0)

      await glApi.saveMappings(payload)
      await qc.invalidateQueries({ queryKey: ['gl-mappings'] })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError('فشل في حفظ الإعدادات')
    } finally {
      setSaving(false)
    }
  }

  const isLoading = loadingMap || loadingAcc

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 text-sm text-blue-800">
        <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">لماذا نربط الحسابات؟</p>
          <p className="opacity-80">
            هذا الربط يسمح للنظام بتوليد قيود محاسبية آمنة وتلقائية. بدون تحديد هذه الحسابات، لن يتمكن النظام من تسجيل حركات المخازن أو الخزينة في دفتر الأستاذ العام.
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">توجيه الحسابات التلقائي</span>
          {canManage && (
            <button
              className={`btn-primary px-5 py-1.5 text-xs gap-2 ${success ? 'bg-green-600' : ''}`}
              onClick={handleSave}
              disabled={saving || isLoading}
            >
              {saving ? 'جاري الحفظ...' : success ? <><CheckCircle size={14}/> تم الحفظ</> : 'حفظ الإعدادات'}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="p-16 text-center text-slate-400">جاري التحميل...</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {KEYS.map(k => (
              <div key={k.key} className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4 hover:bg-slate-50 transition-colors">
                <div className="max-w-md">
                  <p className="font-medium text-slate-800 text-sm">{k.label}</p>
                  <p className="text-xs text-slate-400 mt-1">{k.desc}</p>
                </div>
                <div className="w-full md:w-80">
                  <select
                    className="input text-sm py-1.5"
                    disabled={!canManage}
                    value={localMap[k.key] || ''}
                    onChange={e => setLocalMap(prev => ({ ...prev, [k.key]: e.target.value }))}
                  >
                    <option value="">-- اختر حساب من الشجرة --</option>
                    {accounts.map(acc => (
                      <option key={acc.code} value={acc.code}>
                        {acc.code} — {acc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">{error}</p>}
    </div>
  )
}

// ─── Main Config Page ────────────────────────────────────────
export default function ConfigPage() {
  const { canWrite } = usePermission()
  const { tab: tabParam } = useParams<{ tab?: Tab }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>((tabParam as Tab) ?? 'seasons')

  const [seasonModal, setSeasonModal] = useState(false)
  const [itemModal,   setItemModal]   = useState(false)
  const [ccModal,     setCcModal]     = useState(false)
  const [acctModal,   setAcctModal]   = useState(false)
  const [expModal,    setExpModal]    = useState(false)

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
        {canWrite('config') && tab === 'seasons'       && <button className="btn-primary gap-2" onClick={() => setSeasonModal(true)}><Plus size={15}/>موسم جديد</button>}
        {canWrite('config') && tab === 'items'         && <button className="btn-primary gap-2" onClick={() => setItemModal(true)}><Plus size={15}/>صنف جديد</button>}
        {canWrite('config') && tab === 'cost_centers'  && <button className="btn-primary gap-2" onClick={() => setCcModal(true)}><Plus size={15}/>مركز تكلفة</button>}
        {canWrite('config') && tab === 'accounts'      && <button className="btn-primary gap-2" onClick={() => setAcctModal(true)}><Plus size={15}/>حساب جديد</button>}
        {canWrite('config') && tab === 'expense_types' && <button className="btn-primary gap-2" onClick={() => setExpModal(true)}><Plus size={15}/>نوع مصروف</button>}
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

      {/* Financial Periods */}
      {tab === 'periods' && (
        <PeriodsTab canManage={canWrite('gl')} />
      )}

      {/* GL Mappings */}
      {tab === 'mappings' && (
        <MappingsTab canManage={canWrite('config')} />
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
