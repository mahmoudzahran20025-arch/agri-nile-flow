import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sprout, Plus, ChevronRight, AlertTriangle, CheckCircle, XCircle, Clock, Leaf } from 'lucide-react'
import { cropCyclesApi, configApi, fieldsApi } from '../../api/client'
import type { CropCycle, CropType, CycleStatus, CreateCropCycleInput } from '../../api/client'
import Modal from '../../components/ui/Modal'
import { TableSkeleton } from '../../components/ui/Skeleton'
import { EmptyList } from '../../components/ui/EmptyState'
import { useToast } from '../../contexts/ToastContext'
import { usePermission } from '../../hooks/usePermission'
import { useNewShortcut } from '../../hooks/useNewShortcut'
import { useNavigate } from 'react-router-dom'

const CROP_TYPE_LABELS: Record<CropType, string> = {
  annual:     'سنوي',
  long_cycle: 'دورة طويلة',
  perennial:  'معمر',
}

const STATUS_CONFIG: Record<CycleStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  active:      { label: 'نشط',     icon: <Leaf        size={12} />, cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  harvested:   { label: 'محصود',   icon: <CheckCircle size={12} />, cls: 'bg-blue-100    text-blue-700    border-blue-200'    },
  abandoned:   { label: 'متروك',   icon: <XCircle     size={12} />, cls: 'bg-slate-100   text-slate-500   border-slate-200'   },
  written_off: { label: 'مشطوب',  icon: <AlertTriangle size={12} />, cls: 'bg-red-100   text-red-600     border-red-200'     },
}

const egp = (n: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)

const today = () => new Date().toISOString().slice(0, 10)

const EMPTY_FORM: CreateCropCycleInput & { crop_type: CropType } = {
  field_id:               0,
  season_id:              0,
  crop_name:              '',
  crop_type:              'annual',
  planting_date:          today(),
  expected_harvest_date:  '',
  area_feddan:            undefined,
  center_code:            undefined,
  notes:                  '',
}

export default function CropCyclesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { canWrite } = usePermission()

  const [open,      setOpen]      = useState(false)
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [err,       setErr]       = useState('')
  const [statusFilter, setStatusFilter] = useState<CycleStatus | 'all'>('active')

  useNewShortcut(() => setOpen(true))

  // ── Data ─────────────────────────────────────────────────────
  const { data: cycles = [], isLoading } = useQuery({
    queryKey: ['crop-cycles', statusFilter],
    queryFn:  () => cropCyclesApi.list(statusFilter !== 'all' ? { status: statusFilter } : undefined),
    staleTime: 30_000,
  })

  type SeasonOption = { id: number; name: string; status: string }
  const { data: seasons = [] } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  configApi.seasons as () => Promise<SeasonOption[]>,
    staleTime: 300_000,
    enabled:  open,
  })

  type FieldOption = { id: number; name: string; code: string; area_feddan?: number }
  const { data: fields = [] } = useQuery({
    queryKey: ['fields-dropdown-cycles', form.season_id],
    queryFn:  () => fieldsApi.list(form.season_id ? { season_id: form.season_id } : {}) as Promise<FieldOption[]>,
    staleTime: 60_000,
    enabled:  open,
  })

  // ── Create mutation ───────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (input: CreateCropCycleInput) => cropCyclesApi.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crop-cycles'] })
      toast('تم إنشاء دورة المحصول بنجاح', 'success')
      setOpen(false)
      setForm(EMPTY_FORM)
      setErr('')
    },
    onError: (e: Error) => setErr(e.message),
  })

  // ── Form handlers ─────────────────────────────────────────────
  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!form.field_id)       { setErr('يجب اختيار القطعة'); return }
    if (!form.season_id)      { setErr('يجب اختيار الموسم'); return }
    if (!form.crop_name.trim()) { setErr('اسم المحصول مطلوب'); return }
    if (!form.planting_date)  { setErr('تاريخ الزراعة مطلوب'); return }

    createMut.mutate({
      field_id:              form.field_id,
      season_id:             form.season_id,
      crop_name:             form.crop_name.trim(),
      crop_type:             form.crop_type,
      planting_date:         form.planting_date,
      expected_harvest_date: form.expected_harvest_date || undefined,
      area_feddan:           form.area_feddan,
      center_code:           form.center_code,
      notes:                 form.notes?.trim() || undefined,
    })
  }

  // ── Summary KPIs ─────────────────────────────────────────────
  const activeCycles  = (cycles as CropCycle[]).filter(c => c.status === 'active')
  const totalWIP      = activeCycles.reduce((s, c) => s + c.wip_balance, 0)
  const longCycles    = activeCycles.filter(c => c.crop_type !== 'annual').length

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Sprout size={18} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-[#0F2D5C]">دورات المحاصيل</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">
              تراكم تكاليف WIP — تتبع كل محصول من الزراعة حتى التسوية
            </p>
          </div>
        </div>
        {canWrite('crop_cycles') && (
          <button
            onClick={() => { setOpen(true); setForm(EMPTY_FORM); setErr('') }}
            className="btn-primary flex items-center gap-2 text-[13px]"
          >
            <Plus size={14} /> دورة جديدة
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div className="px-6 pt-4 pb-0 grid grid-cols-3 gap-3 shrink-0">
        {[
          { label: 'دورات نشطة',          value: activeCycles.length,                    cls: 'text-emerald-700' },
          { label: 'إجمالي WIP المتراكم',  value: egp(totalWIP),                         cls: 'text-[#0F2D5C]'  },
          { label: 'دورات طويلة / معمرة',  value: longCycles,                            cls: 'text-amber-600'  },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-[11px] text-slate-400 font-medium">{k.label}</p>
            <p className={`text-[20px] font-bold mt-0.5 ${k.cls}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Status filter */}
      <div className="px-6 pt-4 flex gap-1.5 shrink-0">
        {([['all', 'الكل'], ['active', 'نشطة'], ['harvested', 'محصودة'], ['abandoned', 'متروكة'], ['written_off', 'مشطوبة']] as [CycleStatus | 'all', string][]).map(([s, label]) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-lg text-[12px] font-medium transition-colors border ${
              statusFilter === s
                ? 'bg-[#0F2D5C] text-white border-[#0F2D5C]'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto p-6 pt-4">
        {isLoading ? (
          <TableSkeleton rows={8} cols={7} />
        ) : (cycles as CropCycle[]).length === 0 ? (
          <EmptyList
            noun="دورات محاصيل"
            onAdd={canWrite('crop_cycles') ? () => setOpen(true) : undefined}
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-right">
                  {['المحصول', 'القطعة', 'الموسم', 'النوع', 'تاريخ الزراعة', 'رصيد WIP', 'الحالة', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-[11px] font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(cycles as CropCycle[]).map(cycle => {
                  const st = STATUS_CONFIG[cycle.status]
                  return (
                    <tr
                      key={cycle.id}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/fields/crop-cycles/${cycle.id}`)}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-800">{cycle.crop_name}</td>
                      <td className="px-4 py-3 text-slate-600">{cycle.field_name}</td>
                      <td className="px-4 py-3 text-slate-500 text-[12px]">{cycle.season_name}</td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                          {CROP_TYPE_LABELS[cycle.crop_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-[12px] font-mono">{cycle.planting_date}</td>
                      <td className="px-4 py-3 font-semibold text-[#0F2D5C] tabular-nums">
                        {cycle.wip_balance > 0 ? egp(cycle.wip_balance) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${st.cls}`}>
                          {st.icon} {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        <ChevronRight size={14} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      <Modal open={open} title="دورة محصول جديدة" onClose={() => setOpen(false)} size="md">
        <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">

          {/* Season + Field */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">الموسم <span className="text-red-500">*</span></label>
              <select required className="input" value={form.season_id || ''}
                onChange={e => { set('season_id', Number(e.target.value)); set('field_id', 0) }}>
                <option value="">— اختر الموسم —</option>
                {(seasons as SeasonOption[]).filter(s => s.status !== 'closed').map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">القطعة <span className="text-red-500">*</span></label>
              <select required className="input" value={form.field_id || ''}
                onChange={e => {
                  const f = (fields as FieldOption[]).find(x => x.id === Number(e.target.value))
                  set('field_id', Number(e.target.value))
                  if (f?.area_feddan) set('area_feddan', f.area_feddan)
                }}>
                <option value="">— اختر القطعة —</option>
                {(fields as FieldOption[]).map(f => (
                  <option key={f.id} value={f.id}>{f.name}{f.area_feddan ? ` (${f.area_feddan} ف)` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Crop name + type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">اسم المحصول <span className="text-red-500">*</span></label>
              <input required className="input" placeholder="مثال: قمح، قصب سكر، بلح..."
                value={form.crop_name}
                onChange={e => set('crop_name', e.target.value)} />
            </div>
            <div>
              <label className="label">نوع الدورة</label>
              <select className="input" value={form.crop_type}
                onChange={e => set('crop_type', e.target.value as CropType)}>
                <option value="annual">سنوي — يُقفل مع الموسم</option>
                <option value="long_cycle">دورة طويلة — يمتد لأكثر من موسم</option>
                <option value="perennial">معمر — دائم (بساتين، نخيل)</option>
              </select>
            </div>
          </div>

          {/* Type warning for long/perennial */}
          {form.crop_type !== 'annual' && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800">
              <Clock size={12} className="mt-0.5 shrink-0" />
              <span>
                دورة {CROP_TYPE_LABELS[form.crop_type]}: لن يتم مسح رصيد WIP عند إقفال الموسم —
                يُرحَّل تلقائياً إلى الموسم التالي حتى التسوية.
              </span>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">تاريخ الزراعة <span className="text-red-500">*</span></label>
              <input required type="date" className="input"
                value={form.planting_date}
                onChange={e => set('planting_date', e.target.value)} />
            </div>
            <div>
              <label className="label">تاريخ الحصاد المتوقع</label>
              <input type="date" className="input"
                value={form.expected_harvest_date ?? ''}
                onChange={e => set('expected_harvest_date', e.target.value)} />
            </div>
          </div>

          {/* Area + Notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">المساحة (فدان)</label>
              <input type="number" step="0.01" min="0" className="input"
                placeholder="يتم ملؤها تلقائياً من القطعة"
                value={form.area_feddan ?? ''}
                onChange={e => set('area_feddan', e.target.value ? Number(e.target.value) : undefined)} />
            </div>
            <div>
              <label className="label">ملاحظات</label>
              <input className="input" placeholder="اختياري..."
                value={form.notes ?? ''}
                onChange={e => set('notes', e.target.value)} />
            </div>
          </div>

          {err && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)}>
              إلغاء
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={createMut.isPending}>
              {createMut.isPending ? 'جاري الإنشاء...' : 'إنشاء الدورة'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
