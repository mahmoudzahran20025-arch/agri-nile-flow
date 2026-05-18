import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { assetsApi, type FixedAsset } from '../../api/assets'
import { configApi, fieldsApi, glApi } from '../../api/client'
import { cropCyclesApi } from '../../api/crop-cycles'
import {
  ChevronRight, Play, PlusCircle, Settings2, TrendingDown,
  CheckCircle, AlertTriangle, RefreshCw, Loader2,
} from 'lucide-react'
import { CommandBar } from '../../components/ui/CommandBar'
import Modal from '../../components/ui/Modal'
import DataTableV2, { type ColumnV2 } from '../../components/ui/DataTableV2'

const CATEGORY_LABELS: Record<string, string> = {
  equipment:        'معدات',
  vehicle:          'مركبات',
  irrigation:       'ري',
  building:         'مباني',
  land_improvement: 'تحسينات أراضي',
  other:            'أخرى',
}

const ALLOC_METHOD_LABELS: Record<string, string> = {
  machine_hours: 'ساعات تشغيل',
  area_ratio:    'نسبة مساحة',
  manual:        'يدوي',
}

function formatEGP(v: number) {
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2 }).format(v)
}

// ── Add Asset Modal ───────────────────────────────────────────
function AddAssetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    asset_code: '', name: '', category: 'equipment',
    acquisition_date: new Date().toISOString().slice(0, 10),
    cost: '', salvage_value: '0', useful_life_months: '60',
    depreciation_method: 'straight_line', notes: '',
    season_id: '', field_id: '',
  })

  const { data: seasons = [] } = useQuery({ queryKey: ['seasons'], queryFn: configApi.seasons })
  const { data: fields  = [] } = useQuery({
    queryKey: ['fields-dropdown', form.season_id],
    queryFn:  () => fieldsApi.list(form.season_id ? { season_id: Number(form.season_id) } : {}),
  })

  const mut = useMutation({
    mutationFn: () => assetsApi.create({
      ...form,
      cost:               parseFloat(form.cost) || 0,
      salvage_value:      parseFloat(form.salvage_value) || 0,
      useful_life_months: parseInt(form.useful_life_months) || 60,
      season_id:          form.season_id ? Number(form.season_id) : undefined,
      field_id:           form.field_id  ? Number(form.field_id)  : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); onClose() },
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal open={open} onClose={onClose} title="إضافة أصل ثابت جديد" size="md">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <label className="label">كود الأصل</label>
          <input className="input" value={form.asset_code} onChange={e => set('asset_code', e.target.value)} />
        </div>
        <div>
          <label className="label">اسم الأصل</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">الفئة</label>
          <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label">تاريخ الاقتناء</label>
          <input className="input" type="date" value={form.acquisition_date}
            onChange={e => set('acquisition_date', e.target.value)} />
        </div>
        <div>
          <label className="label">التكلفة (ج.م)</label>
          <input className="input" type="number" value={form.cost} onChange={e => set('cost', e.target.value)} />
        </div>
        <div>
          <label className="label">القيمة التخريدية</label>
          <input className="input" type="number" value={form.salvage_value}
            onChange={e => set('salvage_value', e.target.value)} />
        </div>
        <div>
          <label className="label">العمر الإنتاجي (شهر)</label>
          <input className="input" type="number" value={form.useful_life_months}
            onChange={e => set('useful_life_months', e.target.value)} />
        </div>
        <div>
          <label className="label">طريقة الإهلاك</label>
          <select className="input" value={form.depreciation_method}
            onChange={e => set('depreciation_method', e.target.value)}>
            <option value="straight_line">القسط الثابت</option>
            <option value="declining_balance" disabled>القسط المتناقص (غير متاح حالياً)</option>
          </select>
          <p className="mt-1 text-[11px] text-amber-700">القسط المتناقص غير متاح حالياً.</p>
        </div>
        <div>
          <label className="label">الموسم (اختياري)</label>
          <select className="input" value={form.season_id}
            onChange={e => { set('season_id', e.target.value); set('field_id', '') }}>
            <option value="">— بدون موسم —</option>
            {(seasons as Array<{ id: number; name: string }>).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">الحقل (اختياري)</label>
          <select className="input" value={form.field_id} onChange={e => set('field_id', e.target.value)}>
            <option value="">— بدون حقل —</option>
            {(fields as Array<{ id: number; name: string; code: string }>).map(f => (
              <option key={f.id} value={f.id}>{f.code} — {f.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">ملاحظات</label>
          <input className="input" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>
      {mut.isError && <p className="text-red-600 text-xs mt-2">{String(mut.error)}</p>}
      <div className="flex justify-end gap-3 mt-5">
        <button className="btn-secondary" onClick={onClose}>إلغاء</button>
        <button className="btn-primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'جاري الحفظ...' : 'حفظ'}
        </button>
      </div>
    </Modal>
  )
}

// ── WIP Allocation Modal ──────────────────────────────────────
function WipAllocationModal({ asset, onClose }: { asset: FixedAsset | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [cropCycleId, setCropCycleId] = useState<string>(asset?.crop_cycle_id?.toString() ?? '')
  const [method, setMethod]           = useState<string>(asset?.depreciation_allocation_method ?? '')

  const { data: activeCycles = [] } = useQuery({
    queryKey: ['crop-cycles-active'],
    queryFn: () => cropCyclesApi.list({ status: 'active' }),
    enabled: !!asset,
  })

  const mut = useMutation({
    mutationFn: () => assetsApi.update(asset!.id, {
      crop_cycle_id:                  cropCycleId ? Number(cropCycleId) : null,
      depreciation_allocation_method: method || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); onClose() },
  })

  return (
    <Modal open={!!asset} onClose={onClose} title="توزيع الإهلاك على WIP" size="sm">
      <p className="text-xs text-slate-500 mb-4">
        حدد دورة المحصول المستفيدة وطريقة توزيع الإهلاك. يُطبَّق هذا الإعداد في دورة الإهلاك الشهرية التالية.
      </p>
      <div className="space-y-4">
        <div>
          <label className="label">دورة المحصول (مباشر)</label>
          <p className="text-xs text-slate-400 mb-1">يخصص الإهلاك بالكامل لهذه الدورة</p>
          <select className="input" value={cropCycleId} onChange={e => setCropCycleId(e.target.value)}>
            <option value="">— بدون تخصيص مباشر —</option>
            {(activeCycles as Array<{ id: number; crop_name: string; field_name: string; season_name: string }>).map(cc => (
              <option key={cc.id} value={cc.id}>
                {cc.crop_name} · {cc.field_name} · {cc.season_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">طريقة التوزيع (متعدد الدورات)</label>
          <p className="text-xs text-slate-400 mb-1">عند عدم تحديد دورة مباشرة</p>
          <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
            <option value="">— ورَّث من الدورة أو يُوزَّع بالمساحة —</option>
            <option value="machine_hours">ساعات التشغيل</option>
            <option value="area_ratio">نسبة المساحة</option>
            <option value="manual">يدوي (لا توزيع على WIP)</option>
          </select>
        </div>
      </div>
      {mut.isError && <p className="mt-3 text-xs text-red-600">{String(mut.error)}</p>}
      <div className="flex justify-end gap-3 mt-5">
        <button className="btn-secondary" onClick={onClose}>إلغاء</button>
        <button className="btn-primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'جاري الحفظ...' : 'حفظ الإعداد'}
        </button>
      </div>
    </Modal>
  )
}

// ── Schedule Modal ────────────────────────────────────────────
function ScheduleModal({ asset, onClose }: { asset: FixedAsset | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['asset-schedule', asset?.id],
    queryFn: () => assetsApi.schedule(asset!.id),
    enabled: !!asset,
  })

  const scheduleCols: ColumnV2<{ id: number; period_year: number; period_month: number; amount: number; accumulated: number; status: string }>[] = [
    { key: 'period', header: 'الفترة', render: r => `${r.period_year}/${String(r.period_month).padStart(2, '0')}`, csvValue: r => `${r.period_year}/${String(r.period_month).padStart(2, '0')}` },
    { key: 'amount', header: 'قسط الإهلاك', sortable: true, render: r => formatEGP(r.amount), csvValue: r => String(r.amount) },
    { key: 'accumulated', header: 'مجمع الإهلاك', sortable: true, render: r => formatEGP(r.accumulated), csvValue: r => String(r.accumulated) },
    { key: 'status', header: 'الحالة', render: r => (
      <span className={`px-2 py-0.5 rounded text-xs ${
        r.status === 'posted'  ? 'bg-emerald-100 text-emerald-700' :
        r.status === 'skipped' ? 'bg-slate-100 text-slate-500' :
                                  'bg-amber-100 text-amber-700'
      }`}>
        {r.status === 'posted' ? 'مرحّل' : r.status === 'skipped' ? 'متخطى' : 'معلق'}
      </span>
    ), csvValue: r => r.status },
  ]

  return (
    <Modal open={!!asset} onClose={onClose} title={`جدول إهلاك: ${asset?.name ?? ''}`} size="lg">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-brand-400" />
        </div>
      ) : (
        <DataTableV2
          columns={scheduleCols}
          data={data?.schedule ?? []}
          rowKey={r => r.id}
          emptyText="لا توجد سجلات إهلاك"
          exportFilename={`depreciation_schedule_${asset?.id}`}
        />
      )}
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function FixedAssetsPage() {
  const qc = useQueryClient()
  const [showAdd,       setShowAdd]       = useState(false)
  const [scheduleAsset, setScheduleAsset] = useState<FixedAsset | null>(null)
  const [wipAsset,      setWipAsset]      = useState<FixedAsset | null>(null)
  const [showDepPanel,  setShowDepPanel]  = useState(false)

  const currentYear  = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1
  const [depYear,   setDepYear]   = useState(currentYear)
  const [depMonth,  setDepMonth]  = useState(currentMonth)
  const [depResult, setDepResult] = useState<{ posted: number; skipped: number; total_charge: number } | null>(null)
  const [depError,  setDepError]  = useState<string | null>(null)

  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

  const { data, isLoading } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list })
  const assets = data ?? []
  const totalCost = assets.reduce((s, a) => s + a.cost, 0)

  const runMut = useMutation({
    mutationFn: () => glApi.runDepreciation(depYear, depMonth),
    onSuccess: (res) => {
      setDepResult({ posted: res.posted, skipped: res.skipped, total_charge: res.total_charge })
      setDepError(null)
      qc.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (e: Error) => { setDepError(e.message); setDepResult(null) },
  })

  const columns: ColumnV2<FixedAsset>[] = [
    { key: 'asset_code', header: 'الكود',         render: a => <span className="font-mono text-xs">{a.asset_code}</span>, csvValue: a => a.asset_code },
    { key: 'name',       header: 'الاسم',          render: a => <span className="font-medium">{a.name}</span>, csvValue: a => a.name },
    { key: 'category',   header: 'الفئة',          render: a => CATEGORY_LABELS[a.category] ?? a.category, csvValue: a => a.category },
    { key: 'acquisition_date', header: 'تاريخ الاقتناء', sortable: true, render: a => a.acquisition_date, csvValue: a => a.acquisition_date },
    { key: 'cost',       header: 'التكلفة',        sortable: true, render: a => <span className="font-medium tabular-nums">{formatEGP(a.cost)}</span>, csvValue: a => String(a.cost) },
    { key: 'useful_life_months', header: 'العمر (شهر)', sortable: true, render: a => String(a.useful_life_months), csvValue: a => String(a.useful_life_months) },
    { key: 'wip', header: 'توزيع WIP', render: a => (
      a.crop_cycle_id ? (
        <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">دورة #{a.crop_cycle_id}</span>
      ) : a.depreciation_allocation_method ? (
        <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
          {ALLOC_METHOD_LABELS[a.depreciation_allocation_method] ?? a.depreciation_allocation_method}
        </span>
      ) : (
        <span className="text-xs text-slate-400">غير محدد</span>
      )
    ), csvValue: a => a.crop_cycle_id ? `دورة #${a.crop_cycle_id}` : a.depreciation_allocation_method ?? '' },
    { key: 'actions', header: '', render: a => (
      <div className="flex items-center gap-2">
        <button onClick={e => { e.stopPropagation(); setWipAsset(a) }}
          className="flex items-center gap-1 text-xs text-amber-600 hover:underline">
          <Settings2 size={12} /> WIP
        </button>
        <button onClick={e => { e.stopPropagation(); setScheduleAsset(a) }}
          className="flex items-center gap-1 text-xs text-brand-600 hover:underline">
          <ChevronRight size={12} /> الجدول
        </button>
      </div>
    ), csvValue: () => '' },
  ]

  return (
    <div className="flex flex-col h-full" dir="rtl">
      <CommandBar
        title="الأصول الثابتة"
        subtitle={`${assets.length} أصل · إجمالي التكلفة: ${formatEGP(totalCost)} ج.م`}
        actions={[
          {
            label: 'تشغيل الإهلاك',
            icon: <TrendingDown size={14} />,
            variant: 'secondary',
            onClick: () => setShowDepPanel(v => !v),
          },
          {
            label: 'أصل جديد',
            icon: <PlusCircle size={14} />,
            variant: 'primary',
            onClick: () => setShowAdd(true),
          },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Depreciation run panel */}
        {showDepPanel && (
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown size={15} className="text-brand-600" />
                <h2 className="text-sm font-semibold text-slate-800">تشغيل دورة الإهلاك</h2>
              </div>
              <Link to="/gl/depreciation" className="text-xs text-brand-600 hover:underline">جدول مفصّل ←</Link>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs text-slate-500 font-medium">السنة</label>
                <select className="input w-auto" value={depYear} onChange={e => setDepYear(Number(e.target.value))}>
                  {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500 font-medium">الشهر</label>
                <select className="input w-auto" value={depMonth} onChange={e => setDepMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <button onClick={() => runMut.mutate()} disabled={runMut.isPending}
                className="btn-primary gap-2">
                {runMut.isPending
                  ? <><RefreshCw size={13} className="animate-spin" /> جارٍ الترحيل…</>
                  : <><Play size={13} /> تشغيل</>}
              </button>
            </div>
            {depResult && (
              <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                <CheckCircle size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-800">
                  {depResult.posted} أصل مُرحَّل · {depResult.skipped} محذوف مسبقاً · إجمالي {formatEGP(depResult.total_charge)} ج.م
                </p>
              </div>
            )}
            {depError && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{depError}</p>
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={28} className="animate-spin text-brand-400" />
          </div>
        ) : (
          <DataTableV2<FixedAsset>
            columns={columns}
            data={assets}
            rowKey={a => a.id}
            emptyText="لا توجد أصول ثابتة مسجلة"
            exportFilename="fixed_assets"
          />
        )}
      </div>

      <AddAssetModal open={showAdd} onClose={() => setShowAdd(false)} />
      <WipAllocationModal asset={wipAsset} onClose={() => setWipAsset(null)} />
      <ScheduleModal asset={scheduleAsset} onClose={() => setScheduleAsset(null)} />
    </div>
  )
}
