import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Wheat, Plus, Loader2, TrendingUp, TrendingDown,
  DollarSign, Scale, BarChart3, Trash2, Edit3, Calculator,
} from 'lucide-react'
import { fieldsApi, QUALITY_LABELS } from '../../api/fields'
import type { HarvestRecord } from '../../api/fields'
import { configApi } from '../../api/client'
import type { Season } from '../../types'
import Modal from '../../components/ui/Modal'

function fmt(n: number | null | undefined, dec = 1) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}
function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

// ── KPI Card ──────────────────────────────────────────────────
function KPI({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string
  icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
      <div className={`${color} rounded-xl p-3 shrink-0`}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className="text-xl font-bold text-gray-800 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Harvest Form ──────────────────────────────────────────────
interface HarvestFormProps {
  initial?: Partial<HarvestRecord>
  fields: Array<{ id: number; name: string; code: string; area_feddan: number }>
  seasons: Season[]
  onSubmit: (data: Omit<HarvestRecord, 'id' | 'company_id' | 'created_at'>) => void
  loading: boolean
  onClose: () => void
}

function HarvestForm({ initial, fields, seasons, onSubmit, loading, onClose }: HarvestFormProps) {
  const [form, setForm] = useState({
    field_id:      String(initial?.field_id ?? (fields[0]?.id ?? '')),
    season_id:     String(initial?.season_id ?? ''),
    harvest_date:  initial?.harvest_date  ?? new Date().toISOString().slice(0, 10),
    crop_name:     initial?.crop_name     ?? '',
    variety:       initial?.variety       ?? '',
    qty_tons:      String(initial?.qty_tons     ?? ''),
    quality_grade: initial?.quality_grade ?? 'standard',
    moisture_pct:  String(initial?.moisture_pct ?? ''),
    impurity_pct:  String(initial?.impurity_pct ?? ''),
    actual_cost:   String(initial?.actual_cost  ?? ''),
    sell_price_ton:String(initial?.sell_price_ton ?? ''),
    notes:         initial?.notes ?? '',
  })

  type CostEstimate = { materials_cost: number; labor_cost: number; land_rent: number; total_cost: number; note: string }
  const [costEst, setCostEst]       = useState<CostEstimate | null>(null)
  const [costLoading, setCostLoading] = useState(false)

  async function handleCostEstimate() {
    if (!form.field_id || !form.season_id) return
    setCostLoading(true)
    try {
      const est = await fieldsApi.costEstimate(Number(form.field_id), Number(form.season_id))
      setCostEst(est)
      setForm(p => ({ ...p, actual_cost: String(Math.round(est.total_cost)) }))
    } catch { /* ignore */ }
    finally { setCostLoading(false) }
  }

  const selectedField = fields.find(f => f.id === Number(form.field_id))
  const qtyTons = Number(form.qty_tons) || 0
  const area    = selectedField?.area_feddan ?? 0
  const previewYield = area > 0 && qtyTons > 0 ? (qtyTons / area).toFixed(2) : '—'
  const revenue = qtyTons > 0 && Number(form.sell_price_ton) > 0
    ? qtyTons * Number(form.sell_price_ton) : 0
  const cost    = Number(form.actual_cost) || 0
  const profit  = revenue - cost

  const f = (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      field_id:      Number(form.field_id),
      season_id:     form.season_id ? Number(form.season_id) : undefined,
      harvest_date:  form.harvest_date,
      crop_name:     form.crop_name.trim(),
      variety:       form.variety || undefined,
      qty_tons:      qtyTons,
      quality_grade: form.quality_grade as HarvestRecord['quality_grade'],
      moisture_pct:  form.moisture_pct ? Number(form.moisture_pct) : undefined,
      impurity_pct:  form.impurity_pct ? Number(form.impurity_pct) : undefined,
      actual_cost:   cost,
      sell_price_ton:Number(form.sell_price_ton) || undefined,
      notes:         form.notes || undefined,
    } as Omit<HarvestRecord, 'id' | 'company_id' | 'created_at'>)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-1">
      {/* القطعة + التاريخ */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">القطعة *</label>
          <select required value={form.field_id} onChange={f('field_id')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500">
            {fields.map(fd => (
              <option key={fd.id} value={fd.id}>
                {fd.code} — {fd.name} ({fd.area_feddan} فدان)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">تاريخ الحصاد *</label>
          <input required type="date" value={form.harvest_date} onChange={f('harvest_date')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
        </div>
      </div>

      {/* الموسم */}
      {seasons.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">الموسم الزراعي</label>
          <select value={form.season_id} onChange={f('season_id')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500">
            <option value="">— اختر الموسم (لحساب التكلفة) —</option>
            {seasons.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.season_type})</option>
            ))}
          </select>
        </div>
      )}

      {/* المحصول + الصنف */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">المحصول *</label>
          <input required value={form.crop_name} onChange={f('crop_name')} placeholder="مثال: قطن / أرز / ذرة"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">الصنف / التقاوي</label>
          <input value={form.variety} onChange={f('variety')} placeholder="اختياري"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
        </div>
      </div>

      {/* الكمية + الجودة */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">الكمية (طن) *</label>
          <input required type="number" step="0.01" min="0" value={form.qty_tons} onChange={f('qty_tons')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
          {previewYield !== '—' && (
            <p className="text-xs text-brand-600 mt-1">≈ {previewYield} طن/فدان</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">الجودة</label>
          <select value={form.quality_grade} onChange={f('quality_grade')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500">
            {Object.entries(QUALITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* رطوبة + شوائب */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">نسبة الرطوبة %</label>
          <input type="number" step="0.1" min="0" max="100" value={form.moisture_pct} onChange={f('moisture_pct')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">نسبة الشوائب %</label>
          <input type="number" step="0.1" min="0" max="100" value={form.impurity_pct} onChange={f('impurity_pct')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
        </div>
      </div>

      {/* التكاليف والإيراد */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-500">تكلفة الموسم (ج.م)</label>
            {form.field_id && form.season_id && (
              <button
                type="button"
                onClick={handleCostEstimate}
                disabled={costLoading}
                className="flex items-center gap-1 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-2 py-0.5 hover:bg-teal-100 disabled:opacity-50"
              >
                {costLoading ? <Loader2 size={10} className="animate-spin" /> : <Calculator size={10} />}
                احسب من النظام
              </button>
            )}
          </div>
          <input type="number" step="0.01" min="0" value={form.actual_cost} onChange={f('actual_cost')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">سعر البيع / طن</label>
          <input type="number" step="0.01" min="0" value={form.sell_price_ton} onChange={f('sell_price_ton')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
        </div>
      </div>

      {/* Cost estimate breakdown */}
      {costEst && (
        <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-xs space-y-1.5">
          <p className="font-semibold text-teal-800 flex items-center gap-1.5">
            <Calculator size={12} /> تفصيلة التكلفة المحسوبة من النظام
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white rounded-lg p-2 border border-teal-100">
              <p className="text-gray-400">مستلزمات</p>
              <p className="font-bold text-gray-800">{fmtMoney(costEst.materials_cost)} ج.م</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-teal-100">
              <p className="text-gray-400">عمالة</p>
              <p className="font-bold text-gray-800">{fmtMoney(costEst.labor_cost)} ج.م</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-teal-100">
              <p className="text-gray-400">إيجار أرض</p>
              <p className="font-bold text-gray-800">{fmtMoney(costEst.land_rent)} ج.م</p>
            </div>
          </div>
          <div className="flex justify-between items-center pt-0.5">
            <span className="text-teal-700 font-bold">الإجمالي: {fmtMoney(costEst.total_cost)} ج.م</span>
            {costEst.note && <span className="text-gray-400 italic">{costEst.note}</span>}
          </div>
        </div>
      )}

      {/* Live P&L preview */}
      {(cost > 0 || revenue > 0) && (
        <div className={`rounded-xl border p-3 text-sm ${profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex justify-between text-xs text-gray-600 gap-4 flex-wrap">
            <span>إيراد: <strong>{fmtMoney(revenue)} ج.م</strong></span>
            <span>تكلفة: <strong>{fmtMoney(cost)} ج.م</strong></span>
            <span className={profit >= 0 ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>
              {profit >= 0 ? '✓ ربح' : '✗ خسارة'}: {fmtMoney(Math.abs(profit))} ج.م
            </span>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">ملاحظات</label>
        <textarea rows={2} value={form.notes} onChange={f('notes')}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500" />
      </div>

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={!form.field_id || !form.crop_name || !form.qty_tons || loading}
          className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Wheat size={14} />}
          حفظ السجل
        </button>
        <button type="button" onClick={onClose}
          className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          إلغاء
        </button>
      </div>
    </form>
  )
}

// ════════════════════════════════════════════════════════════
// Main Page
// ════════════════════════════════════════════════════════════
export default function HarvestPage() {
  const qc = useQueryClient()
  const [filterField,  setFilterField]  = useState('')
  const [filterYear,   setFilterYear]   = useState(String(new Date().getFullYear()))
  const [showAdd,      setShowAdd]      = useState(false)
  const [editRecord,   setEditRecord]   = useState<HarvestRecord | null>(null)
  const [activeTab,    setActiveTab]    = useState<'records' | 'summary'>('records')

  const { data: allFields = [] } = useQuery({
    queryKey: ['fields-simple'],
    queryFn:  () => fieldsApi.list(),
    staleTime: 60_000,
  })

  const { data: seasons = [] } = useQuery({
    queryKey: ['config-seasons'],
    queryFn:  () => configApi.seasons() as Promise<Season[]>,
    staleTime: 300_000,
  })

  const { data: harvests = [], isLoading } = useQuery({
    queryKey: ['harvests', filterField, filterYear],
    queryFn:  () => fieldsApi.listHarvests({
      field_id: filterField ? Number(filterField) : undefined,
      year:     filterYear || undefined,
    }),
    staleTime: 30_000,
  })

  const { data: summary = [] } = useQuery({
    queryKey: ['harvest-summary'],
    queryFn:  () => fieldsApi.harvestSummary(),
    staleTime: 60_000,
  })

  const createMut = useMutation({
    mutationFn: (b: Parameters<typeof fieldsApi.createHarvest>[0]) => fieldsApi.createHarvest(b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['harvests'] })
      qc.invalidateQueries({ queryKey: ['harvest-summary'] })
      setShowAdd(false)
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, b }: { id: number; b: Partial<HarvestRecord> }) => fieldsApi.updateHarvest(id, b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['harvests'] })
      qc.invalidateQueries({ queryKey: ['harvest-summary'] })
      setEditRecord(null)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => fieldsApi.deleteHarvest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['harvests'] })
      qc.invalidateQueries({ queryKey: ['harvest-summary'] })
    },
  })

  // KPIs
  const totalTons    = harvests.reduce((s, h) => s + (h.qty_tons ?? 0), 0)
  const totalRevenue = harvests.reduce((s, h) => s + (h.revenue ?? 0), 0)
  const totalCost    = harvests.reduce((s, h) => s + (h.actual_cost ?? 0), 0)
  const totalProfit  = totalRevenue - totalCost

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Wheat size={24} className="text-amber-500" />
            سجلات الحصاد
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">تتبع ناتج الحصاد والتكاليف والربحية لكل قطعة</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} /> سجل حصاد جديد
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="إجمالي الناتج" value={`${fmt(totalTons)} طن`}
          sub={`${harvests.length} سجل`}
          icon={Scale} color="bg-amber-100 text-amber-600" />
        <KPI label="إجمالي الإيراد" value={`${fmtMoney(totalRevenue)} ج.م`}
          icon={TrendingUp} color="bg-emerald-100 text-emerald-600" />
        <KPI label="إجمالي التكلفة" value={`${fmtMoney(totalCost)} ج.م`}
          icon={DollarSign} color="bg-blue-100 text-blue-600" />
        <KPI label="صافي الربح" value={`${fmtMoney(totalProfit)} ج.م`}
          sub={totalProfit >= 0 ? '✓ ربح' : '✗ خسارة'}
          icon={totalProfit >= 0 ? TrendingUp : TrendingDown}
          color={totalProfit >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'} />
      </div>

      {/* Filters + Tabs */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-wrap gap-3">
          <div className="flex gap-2">
            {(['records', 'summary'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
                  ${activeTab === tab ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                {tab === 'records' ? 'سجلات الحصاد' : <span className="flex items-center gap-1"><BarChart3 size={13} /> ملخص القطع</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <select
              value={filterField}
              onChange={e => setFilterField(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-500"
            >
              <option value="">كل القطع</option>
              {allFields.map(f => (
                <option key={f.id} value={f.id}>{f.code} — {f.name}</option>
              ))}
            </select>
            <select
              value={filterYear}
              onChange={e => setFilterYear(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-500"
            >
              <option value="">كل السنوات</option>
              {[2026, 2025, 2024, 2023].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Records Table */}
        {activeTab === 'records' && (
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="flex justify-center py-12 text-gray-400">
                <Loader2 className="animate-spin" size={28} />
              </div>
            ) : harvests.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Wheat size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">لا توجد سجلات حصاد</p>
                <p className="text-sm mt-1">أضف سجل حصاد جديد للبدء</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="px-4 py-2.5 text-right font-medium">القطعة</th>
                    <th className="px-4 py-2.5 text-right font-medium">التاريخ</th>
                    <th className="px-4 py-2.5 text-right font-medium">المحصول</th>
                    <th className="px-4 py-2.5 text-left font-medium">الكمية (طن)</th>
                    <th className="px-4 py-2.5 text-left font-medium">طن/فدان</th>
                    <th className="px-4 py-2.5 text-center font-medium">الجودة</th>
                    <th className="px-4 py-2.5 text-left font-medium">الإيراد</th>
                    <th className="px-4 py-2.5 text-left font-medium">التكلفة</th>
                    <th className="px-4 py-2.5 text-left font-medium">الربح</th>
                    <th className="px-4 py-2.5 text-center font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {harvests.map(h => {
                    const qLabel = QUALITY_LABELS[h.quality_grade] ?? QUALITY_LABELS.standard
                    const profitPositive = (h.profit ?? 0) >= 0
                    return (
                      <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{h.field_code}</p>
                          <p className="text-xs text-gray-400">{h.field_name}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{h.harvest_date}</td>
                        <td className="px-4 py-3">
                          <p className="text-gray-800">{h.crop_name}</p>
                          {h.variety && <p className="text-xs text-gray-400">{h.variety}</p>}
                        </td>
                        <td className="px-4 py-3 text-left font-bold text-amber-600">{fmt(h.qty_tons, 2)}</td>
                        <td className="px-4 py-3 text-left text-gray-600">{fmt(h.qty_feddan, 2)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs rounded-full px-2 py-0.5 ${qLabel.color}`}>
                            {qLabel.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-left text-emerald-600">{h.revenue ? fmtMoney(h.revenue) : '—'}</td>
                        <td className="px-4 py-3 text-left text-gray-600">{fmtMoney(h.actual_cost)}</td>
                        <td className={`px-4 py-3 text-left font-medium ${profitPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                          {h.profit !== undefined && h.profit !== null ? fmtMoney(h.profit) : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setEditRecord(h)}
                              className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors">
                              <Edit3 size={14} />
                            </button>
                            <button
                              onClick={() => { if (confirm('حذف هذا السجل؟')) deleteMut.mutate(h.id) }}
                              disabled={deleteMut.isPending}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Summary Tab */}
        {activeTab === 'summary' && (
          <div className="overflow-x-auto">
            {summary.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">لا توجد بيانات ملخص بعد</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="px-4 py-2.5 text-right font-medium">القطعة</th>
                    <th className="px-4 py-2.5 text-left font-medium">المساحة (فدان)</th>
                    <th className="px-4 py-2.5 text-left font-medium">عدد الحصادات</th>
                    <th className="px-4 py-2.5 text-left font-medium">إجمالي الأطنان</th>
                    <th className="px-4 py-2.5 text-left font-medium">متوسط طن/فدان</th>
                    <th className="px-4 py-2.5 text-left font-medium">إجمالي الإيراد</th>
                    <th className="px-4 py-2.5 text-left font-medium">إجمالي التكلفة</th>
                    <th className="px-4 py-2.5 text-left font-medium">صافي الربح</th>
                    <th className="px-4 py-2.5 text-left font-medium">تكلفة/فدان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {summary.map(s => {
                    const profitPos = (s.total_profit ?? 0) >= 0
                    return (
                      <tr key={s.field_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{s.field_code}</p>
                          <p className="text-xs text-gray-400">{s.field_name}</p>
                        </td>
                        <td className="px-4 py-3 text-left text-gray-600">{fmt(s.area_feddan)}</td>
                        <td className="px-4 py-3 text-left text-gray-600">{s.harvest_count ?? 0}</td>
                        <td className="px-4 py-3 text-left font-bold text-amber-600">{fmt(s.total_tons, 2)}</td>
                        <td className="px-4 py-3 text-left text-gray-600">{fmt(s.avg_yield_per_feddan, 2)}</td>
                        <td className="px-4 py-3 text-left text-emerald-600">{fmtMoney(s.total_revenue)}</td>
                        <td className="px-4 py-3 text-left text-gray-600">{fmtMoney(s.total_cost)}</td>
                        <td className={`px-4 py-3 text-left font-medium ${profitPos ? 'text-emerald-600' : 'text-red-500'}`}>
                          {fmtMoney(s.total_profit)}
                        </td>
                        <td className="px-4 py-3 text-left text-gray-600">{fmtMoney(s.avg_cost_per_feddan)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="سجل حصاد جديد">
        <HarvestForm
          fields={allFields}
          seasons={seasons}
          onSubmit={(b) => createMut.mutate(b as Parameters<typeof fieldsApi.createHarvest>[0])}
          loading={createMut.isPending}
          onClose={() => setShowAdd(false)}
        />
      </Modal>

      {/* Edit Modal */}
      {editRecord && (
        <Modal open onClose={() => setEditRecord(null)} title="تعديل سجل الحصاد">
          <HarvestForm
            initial={editRecord}
            fields={allFields}
            seasons={seasons}
            onSubmit={(b) => updateMut.mutate({ id: editRecord.id, b })}
            loading={updateMut.isPending}
            onClose={() => setEditRecord(null)}
          />
        </Modal>
      )}
    </div>
  )
}
