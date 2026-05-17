import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { assetsApi, type FixedAsset } from '../../api/assets'
import { configApi, fieldsApi } from '../../api/client'
import { cropCyclesApi } from '../../api/crop-cycles'
import { ChevronRight, Play, PlusCircle, Settings2 } from 'lucide-react'

const CATEGORY_LABELS: Record<string, string> = {
  equipment:        'معدات',
  vehicle:          'مركبات',
  irrigation:       'ري',
  building:         'مباني',
  land_improvement: 'تحسينات أراضي',
  other:            'أخرى',
}

function formatEGP(v: number) {
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2 }).format(v)
}

function AddAssetForm({ onClose }: { onClose: () => void }) {
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
      cost:                parseFloat(form.cost) || 0,
      salvage_value:       parseFloat(form.salvage_value) || 0,
      useful_life_months:  parseInt(form.useful_life_months) || 60,
      season_id:           form.season_id ? Number(form.season_id) : undefined,
      field_id:            form.field_id  ? Number(form.field_id)  : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); onClose() },
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg">
        <h2 className="text-lg font-bold mb-4">إضافة أصل ثابت جديد</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            ['asset_code', 'كود الأصل'],
            ['name', 'اسم الأصل'],
          ].map(([k, label]) => (
            <div key={k}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input value={(form as Record<string, string>)[k]} onChange={e => set(k, e.target.value)}
                className="w-full border rounded px-2 py-1.5" />
            </div>
          ))}
          <div>
            <label className="block text-xs text-gray-500 mb-1">الفئة</label>
            <select value={form.category} onChange={e => set('category', e.target.value)} className="w-full border rounded px-2 py-1.5">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">تاريخ الاقتناء</label>
            <input type="date" value={form.acquisition_date} onChange={e => set('acquisition_date', e.target.value)}
              className="w-full border rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">التكلفة (ج.م)</label>
            <input type="number" value={form.cost} onChange={e => set('cost', e.target.value)}
              className="w-full border rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">القيمة التخريدية</label>
            <input type="number" value={form.salvage_value} onChange={e => set('salvage_value', e.target.value)}
              className="w-full border rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">العمر الإنتاجي (شهر)</label>
            <input type="number" value={form.useful_life_months} onChange={e => set('useful_life_months', e.target.value)}
              className="w-full border rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">طريقة الإهلاك</label>
            <select value={form.depreciation_method} onChange={e => set('depreciation_method', e.target.value)} className="w-full border rounded px-2 py-1.5">
              <option value="straight_line">القسط الثابت</option>
              <option value="declining_balance" disabled title="غير متاح حالياً">
                القسط المتناقص (غير متاح حالياً)
              </option>
            </select>
            <p className="mt-1 text-[11px] text-amber-700" title="سيتم تفعيله بعد اكتمال منطق الحساب في الباك إند">
              القسط المتناقص غير متاح حالياً.
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">الموسم (اختياري)</label>
            <select value={form.season_id} onChange={e => { set('season_id', e.target.value); set('field_id', '') }} className="w-full border rounded px-2 py-1.5">
              <option value="">— بدون موسم —</option>
              {(seasons as Array<{ id: number; name: string }>).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">الحقل (اختياري)</label>
            <select value={form.field_id} onChange={e => set('field_id', e.target.value)} className="w-full border rounded px-2 py-1.5">
              <option value="">— بدون حقل —</option>
              {(fields as Array<{ id: number; name: string; code: string }>).map(f => (
                <option key={f.id} value={f.id}>{f.code} — {f.name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">ملاحظات</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} className="w-full border rounded px-2 py-1.5" />
          </div>
        </div>
        {mut.isError && <p className="text-red-600 text-xs mt-2">{String(mut.error)}</p>}
        <div className="flex gap-2 mt-4 justify-end">
          <button onClick={onClose} className="px-4 py-2 border rounded text-sm">إلغاء</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="px-4 py-2 bg-[#0F2D5C] text-white rounded text-sm disabled:opacity-50">
            {mut.isPending ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  )
}

function WipAllocationDrawer({ asset, onClose }: { asset: FixedAsset; onClose: () => void }) {
  const qc = useQueryClient()
  const [cropCycleId, setCropCycleId] = useState<string>(asset.crop_cycle_id?.toString() ?? '')
  const [method, setMethod]           = useState<string>(asset.depreciation_allocation_method ?? '')

  const { data: activeCycles = [] } = useQuery({
    queryKey: ['crop-cycles-active'],
    queryFn: () => cropCyclesApi.list({ status: 'active' }),
  })

  const mut = useMutation({
    mutationFn: () => assetsApi.update(asset.id, {
      crop_cycle_id:                  cropCycleId ? Number(cropCycleId) : null,
      depreciation_allocation_method: method || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); onClose() },
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
        <h2 className="text-base font-bold text-slate-800 mb-1">توزيع الإهلاك على WIP</h2>
        <p className="text-xs text-slate-500 mb-4">
          حدد دورة المحصول المستفيدة وطريقة توزيع الإهلاك. يُطبَّق هذا الإعداد في دورة الإهلاك الشهرية التالية.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              دورة المحصول (مباشر)
              <span className="text-slate-400 font-normal mr-1">— يخصص الإهلاك بالكامل لهذه الدورة</span>
            </label>
            <select
              value={cropCycleId}
              onChange={e => setCropCycleId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]"
            >
              <option value="">— بدون تخصيص مباشر —</option>
              {(activeCycles as Array<{ id: number; crop_name: string; field_name: string; season_name: string }>).map(cc => (
                <option key={cc.id} value={cc.id}>
                  {cc.crop_name} · {cc.field_name} · {cc.season_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              طريقة التوزيع (متعدد الدورات)
              <span className="text-slate-400 font-normal mr-1">— عند عدم تحديد دورة مباشرة</span>
            </label>
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]"
            >
              <option value="">— ورَّث من الدورة أو يُوزَّع بالمساحة —</option>
              <option value="machine_hours">ساعات التشغيل</option>
              <option value="area_ratio">نسبة المساحة</option>
              <option value="manual">يدوي (لا توزيع على WIP)</option>
            </select>
          </div>
        </div>

        {mut.isError && (
          <p className="mt-3 text-xs text-red-600">{String(mut.error)}</p>
        )}

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            إلغاء
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="px-4 py-2 text-sm bg-[#0F2D5C] text-white rounded-lg font-medium disabled:opacity-50 hover:bg-[#1a3d6b] transition-colors"
          >
            {mut.isPending ? 'جاري الحفظ...' : 'حفظ الإعداد'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ScheduleDrawer({ asset, onClose }: { asset: FixedAsset; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['asset-schedule', asset.id],
    queryFn: () => assetsApi.schedule(asset.id),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">جدول إهلاك: {asset.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[#0F2D5C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-right p-2">الفترة</th>
                  <th className="text-right p-2">قسط الإهلاك</th>
                  <th className="text-right p-2">مجمع الإهلاك</th>
                  <th className="text-right p-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {(data?.schedule ?? []).map(row => (
                  <tr key={row.id} className="border-t hover:bg-gray-50">
                    <td className="p-2">{row.period_year}/{String(row.period_month).padStart(2, '0')}</td>
                    <td className="p-2">{formatEGP(row.amount)}</td>
                    <td className="p-2">{formatEGP(row.accumulated)}</td>
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        row.status === 'posted'  ? 'bg-green-100 text-green-700' :
                        row.status === 'skipped' ? 'bg-gray-100 text-gray-500' :
                                                    'bg-yellow-100 text-yellow-700'
                      }`}>
                        {row.status === 'posted' ? 'مرحّل' : row.status === 'skipped' ? 'متخطى' : 'معلق'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const ALLOC_METHOD_LABELS: Record<string, string> = {
  machine_hours: 'ساعات تشغيل',
  area_ratio:    'نسبة مساحة',
  manual:        'يدوي',
}

export default function FixedAssetsPage() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [scheduleAsset, setScheduleAsset]   = useState<FixedAsset | null>(null)
  const [wipAsset, setWipAsset]             = useState<FixedAsset | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: assetsApi.list,
  })

  const runMut = useMutation({
    mutationFn: assetsApi.runDepreciation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  })

  const assets = data ?? []
  const totalCost = assets.reduce((s, a) => s + a.cost, 0)

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0F2D5C]">الأصول الثابتة</h1>
          <p className="text-sm text-gray-500 mt-1">
            {assets.length} أصل · إجمالي التكلفة: {formatEGP(totalCost)} ج.م
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => runMut.mutate()} disabled={runMut.isPending}
            className="flex items-center gap-2 px-4 py-2 border border-[#0F2D5C] text-[#0F2D5C] rounded-lg text-sm hover:bg-[#0F2D5C]/5 disabled:opacity-50">
            <Play className="w-4 h-4" />
            {runMut.isPending ? 'جاري الترحيل...' : 'ترحيل إهلاك الشهر'}
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#0F2D5C] text-white rounded-lg text-sm">
            <PlusCircle className="w-4 h-4" />
            أصل جديد
          </button>
        </div>
      </div>

      {runMut.data && (
        <div className={`p-3 rounded-lg text-sm ${runMut.data.errors?.length ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
          تم ترحيل {runMut.data.posted} أصل · تخطي {runMut.data.skipped}
          {runMut.data.errors?.length > 0 && <span className="text-red-600"> · {runMut.data.errors.length} خطأ</span>}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-[#0F2D5C] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : assets.length === 0 ? (
        <div className="text-center py-16 text-gray-400">لا توجد أصول ثابتة مسجلة</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-right p-3">الكود</th>
                <th className="text-right p-3">الاسم</th>
                <th className="text-right p-3">الفئة</th>
                <th className="text-right p-3">تاريخ الاقتناء</th>
                <th className="text-right p-3">التكلفة</th>
                <th className="text-right p-3">العمر (شهر)</th>
                <th className="text-right p-3">توزيع WIP</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {assets.map(asset => (
                <tr key={asset.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-mono text-xs">{asset.asset_code}</td>
                  <td className="p-3 font-medium">{asset.name}</td>
                  <td className="p-3">{CATEGORY_LABELS[asset.category] ?? asset.category}</td>
                  <td className="p-3">{asset.acquisition_date}</td>
                  <td className="p-3">{formatEGP(asset.cost)}</td>
                  <td className="p-3">{asset.useful_life_months}</td>
                  <td className="p-3">
                    {asset.crop_cycle_id ? (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">دورة #{asset.crop_cycle_id}</span>
                    ) : asset.depreciation_allocation_method ? (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                        {ALLOC_METHOD_LABELS[asset.depreciation_allocation_method] ?? asset.depreciation_allocation_method}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">غير محدد</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setWipAsset(asset)}
                        title="إعدادات توزيع الإهلاك على WIP"
                        className="flex items-center gap-1 text-xs text-amber-600 hover:underline">
                        <Settings2 className="w-3 h-3" />
                        WIP
                      </button>
                      <button onClick={() => setScheduleAsset(asset)}
                        className="flex items-center gap-1 text-xs text-[#0F2D5C] hover:underline">
                        <ChevronRight className="w-3 h-3" />
                        الجدول
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddAssetForm onClose={() => setShowAdd(false)} />}
      {scheduleAsset && <ScheduleDrawer asset={scheduleAsset} onClose={() => setScheduleAsset(null)} />}
      {wipAsset && <WipAllocationDrawer asset={wipAsset} onClose={() => setWipAsset(null)} />}
    </div>
  )
}
