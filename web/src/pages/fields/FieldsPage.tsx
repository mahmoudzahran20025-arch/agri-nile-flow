import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, CheckCircle, XCircle, Navigation, Pencil, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { fieldsApi, configApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import { usePermission } from '../../hooks/usePermission'
import GeoJSONFieldDrawer from '../../components/forms/GeoJSONFieldDrawer'
import type { GeoFieldResult } from '../../lib/geoUtils'
import { formatFeddan } from '../../lib/geoUtils'

interface Field {
  id: number; code: string; name: string; area_feddan: number
  season_name?: string; season_id?: number; crop_type?: string; soil_type?: string
  irrigation_type?: string; landlord_name?: string; rent_per_feddan?: number
  location?: string; notes?: string; is_active: number
  center_lat?: number; center_lng?: number; geofence_radius_m?: number
  boundary_geojson?: string; center_code?: number
}

interface FieldForm {
  code: string; name: string; area_feddan: string; season_id: string
  location: string; crop_type: string; soil_type: string
  irrigation_type: string; landlord_name: string; rent_per_feddan: string; notes: string
  center_code: string
  // Geo — auto-filled from GeoJSONFieldDrawer
  center_lat: string; center_lng: string; geofence_radius_m: string
  boundary_geojson: string
  // Manual fallback dimensions
  length_m: string; width_m: string
}

const EMPTY: FieldForm = {
  code: '', name: '', area_feddan: '', season_id: '',
  location: '', crop_type: '', soil_type: '',
  irrigation_type: '', landlord_name: '', rent_per_feddan: '', notes: '',
  center_code: '',
  center_lat: '', center_lng: '', geofence_radius_m: '150',
  boundary_geojson: '',
  length_m: '', width_m: '',
}

const CROPS      = ['قمح','ذرة','أرز','قصب سكر','قطن','بنجر السكر','بصل','طماطم','أخرى']
const SOILS      = ['طيني','رملي','طيني رملي','طفلي']
const IRRIGATION = ['غمر','تنقيط','رش','ري بالأخاديد']

export default function FieldsPage() {
  const { canWrite } = usePermission()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen]               = useState(false)
  const [editField, setEditField]     = useState<Field | null>(null)
  const [search, setSearch]           = useState('')
  const [form, setForm]               = useState<FieldForm>(EMPTY)
  const [err, setErr]                 = useState('')
  const [geoResult, setGeoResult]     = useState<GeoFieldResult | null>(null)

  // When GeoJSONFieldDrawer gives us a result → auto-fill form
  const handleGeoResult = (res: GeoFieldResult) => {
    setGeoResult(res)
    setForm(f => ({
      ...f,
      area_feddan:      res.area_feddan.toFixed(4),
      center_lat:       res.center_lat.toString(),
      center_lng:       res.center_lng.toString(),
      boundary_geojson: res.boundary_geojson,
    }))
  }

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ['fields'],
    queryFn:  () => fieldsApi.list(),
  })
  const { data: seasons = [] } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
  })
  const { data: costCenters = [] } = useQuery({
    queryKey: ['cost-centers'],
    queryFn:  configApi.costCenters,
  })

  // Determine final area: polygon takes priority, then manual dimensions, then direct entry
  const calcAreaFeddan = () => {
    if (geoResult) return geoResult.area_feddan.toFixed(4)  // from polygon
    const l = parseFloat(form.length_m), w = parseFloat(form.width_m)
    if (!isNaN(l) && !isNaN(w)) return (l * w / 4200.833).toFixed(4)  // from dimensions
    return form.area_feddan  // manual entry
  }

  const create = useMutation({
    mutationFn: () => fieldsApi.create({
      code: form.code.trim(),
      name: form.name.trim(),
      area_feddan: Number(calcAreaFeddan()) || 0,
      season_id:   form.season_id ? Number(form.season_id) : undefined,
      location:    form.location || undefined,
      crop_type:   form.crop_type || undefined,
      soil_type:   form.soil_type || undefined,
      irrigation_type: form.irrigation_type || undefined,
      landlord_name:   form.landlord_name || undefined,
      rent_per_feddan: form.rent_per_feddan ? Number(form.rent_per_feddan) : undefined,
      notes:       form.notes || undefined,
      center_code: form.center_code ? Number(form.center_code) : undefined,
      // Geo — from polygon or manual
      center_lat:        form.center_lat  ? Number(form.center_lat)  : undefined,
      center_lng:        form.center_lng  ? Number(form.center_lng)  : undefined,
      geofence_radius_m: form.geofence_radius_m ? Number(form.geofence_radius_m) : 150,
      boundary_geojson:  form.boundary_geojson  || undefined,
      length_m:    form.length_m ? Number(form.length_m) : undefined,
      width_m:     form.width_m  ? Number(form.width_m)  : undefined,
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setErr(res.error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['fields'] })
      setOpen(false); setForm(EMPTY); setErr(''); setGeoResult(null)
    },
  })

  const update = useMutation({
    mutationFn: () => fieldsApi.update(editField!.id, {
      name: form.name.trim(),
      area_feddan: Number(calcAreaFeddan()) || undefined,
      season_id:   form.season_id ? Number(form.season_id) : null,
      location:    form.location || null,
      crop_type:   form.crop_type || null,
      soil_type:   form.soil_type || null,
      irrigation_type: form.irrigation_type || null,
      landlord_name:   form.landlord_name || null,
      rent_per_feddan: form.rent_per_feddan ? Number(form.rent_per_feddan) : null,
      notes:       form.notes || null,
      center_code: form.center_code ? Number(form.center_code) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fields'] })
      setEditField(null); setForm(EMPTY); setErr(''); setGeoResult(null)
    },
  })

  const toggleActive = useMutation({
    mutationFn: (f: Field) => fieldsApi.update(f.id, { is_active: f.is_active ? 0 : 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fields'] }),
  })

  function openEdit(f: Field) {
    setEditField(f)
    setGeoResult(null)
    setForm({
      code:              f.code,
      name:              f.name,
      area_feddan:       String(f.area_feddan ?? ''),
      season_id:         f.season_id ? String(f.season_id) : '',
      location:          f.location ?? '',
      crop_type:         f.crop_type ?? '',
      soil_type:         f.soil_type ?? '',
      irrigation_type:   f.irrigation_type ?? '',
      landlord_name:     f.landlord_name ?? '',
      rent_per_feddan:   f.rent_per_feddan ? String(f.rent_per_feddan) : '',
      notes:             f.notes ?? '',
      center_code:       f.center_code ? String(f.center_code) : '',
      center_lat:        f.center_lat  ? String(f.center_lat)  : '',
      center_lng:        f.center_lng  ? String(f.center_lng)  : '',
      geofence_radius_m: f.geofence_radius_m ? String(f.geofence_radius_m) : '150',
      boundary_geojson:  f.boundary_geojson ?? '',
      length_m:          '',
      width_m:           '',
    })
    setErr('')
  }

  const sf = (f: Partial<FieldForm>) => setForm(p => ({ ...p, ...f }))

  const filtered = (fields as Field[]).filter(f =>
    !search || f.name.includes(search) || f.code.includes(search)
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPin size={24} className="text-brand-600" />
          <h1 className="text-xl font-bold text-gray-900">قطع الأراضي</h1>
          <span className="badge badge-blue">{(fields as Field[]).length} قطعة</span>
        </div>
        {canWrite('fields') && (
          <button className="btn btn-primary" onClick={() => { setOpen(true); setForm(EMPTY); setErr('') }}>
            <Plus size={16} /> إضافة قطعة
          </button>
        )}
      </div>

      {/* Search */}
      <input
        className="input max-w-sm"
        placeholder="بحث بالاسم أو الكود..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* Table */}
      {isLoading ? (
        <p className="text-center text-gray-500 py-10">جاري التحميل...</p>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <MapPin size={40} className="mx-auto mb-3 opacity-30" />
          <p>لا توجد قطع أراضي مسجلة</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="th">الكود</th>
                <th className="th">الاسم</th>
                <th className="th">المساحة (فدان)</th>
                <th className="th">الموسم</th>
                <th className="th">نوع المحصول</th>
                <th className="th">نوع الري</th>
                <th className="th">المالك</th>
                <th className="th">GPS</th>
                <th className="th">الحالة</th>
                {canWrite('fields') && <th className="th">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id} className="border-b hover:bg-gray-50 transition-colors">
                  <td className="td font-mono text-brand-700">{f.code}</td>
                  <td className="td font-medium">{f.name}</td>
                  <td className="td text-center">{f.area_feddan?.toLocaleString('en-US')}</td>
                  <td className="td text-gray-500">{f.season_name ?? '—'}</td>
                  <td className="td">{f.crop_type ?? '—'}</td>
                  <td className="td">{f.irrigation_type ?? '—'}</td>
                  <td className="td">{f.landlord_name ?? '—'}</td>
                  <td className="td text-center">
                    {f.center_lat != null
                      ? <span title={`${f.center_lat}, ${f.center_lng} — نطاق ${f.geofence_radius_m}م`} className="text-emerald-600"><Navigation size={14} /></span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="td">
                    {f.is_active
                      ? <span className="badge badge-green flex items-center gap-1 w-fit"><CheckCircle size={12}/> نشطة</span>
                      : <span className="badge badge-red flex items-center gap-1 w-fit"><XCircle size={12}/> متوقفة</span>}
                  </td>
                  {canWrite('fields') && (
                    <td className="td">
                      <div className="flex items-center gap-1">
                        <button
                          title="تعديل"
                          onClick={() => openEdit(f)}
                          className="p-1.5 rounded hover:bg-indigo-50 text-indigo-600 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          title={f.is_active ? 'إيقاف' : 'تفعيل'}
                          onClick={() => toggleActive.mutate(f)}
                          className={`p-1.5 rounded transition-colors ${f.is_active ? 'hover:bg-red-50 text-red-500' : 'hover:bg-green-50 text-green-600'}`}
                        >
                          {f.is_active ? <XCircle size={14} /> : <CheckCircle size={14} />}
                        </button>
                        <button
                          title="تحليل التكاليف"
                          onClick={() => navigate(`/inventory/cost-by-field?field_id=${f.id}`)}
                          className="p-1.5 rounded hover:bg-amber-50 text-amber-600 transition-colors"
                        >
                          <TrendingUp size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="إضافة قطعة أرض جديدة" size="lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">كود القطعة *</label>
            <input className="input" value={form.code} onChange={e => sf({ code: e.target.value })} placeholder="A01" />
          </div>
          <div>
            <label className="label">اسم القطعة *</label>
            <input className="input" value={form.name} onChange={e => sf({ name: e.target.value })} placeholder="حقل النيل الشمالي" />
          </div>
          <div>
            <label className="label">المساحة (فدان)</label>
            <input className="input" type="number" value={form.area_feddan} onChange={e => sf({ area_feddan: e.target.value })} placeholder="10" />
          </div>
          <div>
            <label className="label">الموسم</label>
            <select className="input" value={form.season_id} onChange={e => sf({ season_id: e.target.value })}>
              <option value="">— اختر الموسم —</option>
              {(seasons as { id: number; name: string }[]).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">نوع المحصول</label>
            <select className="input" value={form.crop_type} onChange={e => sf({ crop_type: e.target.value })}>
              <option value="">— اختر —</option>
              {CROPS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">نوع التربة</label>
            <select className="input" value={form.soil_type} onChange={e => sf({ soil_type: e.target.value })}>
              <option value="">— اختر —</option>
              {SOILS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">نوع الري</label>
            <select className="input" value={form.irrigation_type} onChange={e => sf({ irrigation_type: e.target.value })}>
              <option value="">— اختر —</option>
              {IRRIGATION.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="label">اسم المالك</label>
            <input className="input" value={form.landlord_name} onChange={e => sf({ landlord_name: e.target.value })} />
          </div>
          <div>
            <label className="label">الإيجار (جنيه/فدان)</label>
            <input className="input" type="number" value={form.rent_per_feddan} onChange={e => sf({ rent_per_feddan: e.target.value })} />
          </div>
          <div>
            <label className="label">الموقع</label>
            <input className="input" value={form.location} onChange={e => sf({ location: e.target.value })} />
          </div>
          <div>
            <label className="label">مركز التكلفة</label>
            <select className="input" value={form.center_code} onChange={e => sf({ center_code: e.target.value })}>
              <option value="">— بدون مركز تكلفة —</option>
              {(costCenters as { code: number; name: string }[]).map(cc => (
                <option key={cc.code} value={cc.code}>{cc.code} — {cc.name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">ملاحظات</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => sf({ notes: e.target.value })} />
          </div>

          {/* ── GeoJSON Drawer — الطريقة الصحيحة لرسم حدود القطعة ── */}
          <div className="col-span-2 border-t pt-4 mt-1">
            <GeoJSONFieldDrawer
              onResult={handleGeoResult}
              currentResult={geoResult}
            />
            {/* Show auto-filled values after drawing */}
            {geoResult && (
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500 mb-1">المساحة (محسوبة تلقائياً)</p>
                  <p className="font-semibold text-emerald-700">{formatFeddan(geoResult.area_feddan)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">نطاق القبول عند الوصول</p>
                  <input className="input" type="number" min="50" max="2000"
                    value={form.geofence_radius_m}
                    onChange={e => sf({ geofence_radius_m: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Manual fallback: dimensions OR direct area ── */}
          {!geoResult && (
            <div className="col-span-2 border-t pt-4 mt-1">
              <p className="text-xs text-gray-400 mb-3">
                ▸ بدون رسم الحدود: أدخل المساحة مباشرةً (أو الأبعاد بالمتر)
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">المساحة (فدان) — مباشر</label>
                  <input className="input" type="number" step="0.01"
                    value={form.area_feddan} onChange={e => sf({ area_feddan: e.target.value })} placeholder="5.5" />
                </div>
                <div>
                  <label className="label">الطول (متر)</label>
                  <input className="input" type="number" min="0" step="0.1"
                    value={form.length_m} onChange={e => sf({ length_m: e.target.value })} placeholder="500" />
                </div>
                <div>
                  <label className="label">العرض (متر)</label>
                  <input className="input" type="number" min="0" step="0.1"
                    value={form.width_m} onChange={e => sf({ width_m: e.target.value })} placeholder="200" />
                </div>
              </div>
              {form.length_m && form.width_m && (
                <p className="text-xs text-emerald-600 mt-1.5">
                  ≈ {(parseFloat(form.length_m) * parseFloat(form.width_m) / 4200.833).toFixed(3)} فدان
                </p>
              )}
              <div className="mt-3">
                <label className="label">نطاق القبول (متر)</label>
                <input className="input w-32" type="number" min="50" max="2000"
                  value={form.geofence_radius_m} onChange={e => sf({ geofence_radius_m: e.target.value })} />
              </div>
            </div>
          )}
        </div>

        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.code || !form.name}
          >
            {create.isPending ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={editField !== null} onClose={() => { setEditField(null); setForm(EMPTY); setErr('') }} title={`تعديل: ${editField?.name ?? ''}`} size="lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">اسم القطعة *</label>
            <input className="input" value={form.name} onChange={e => sf({ name: e.target.value })} />
          </div>
          <div>
            <label className="label">المساحة (فدان)</label>
            <input className="input" type="number" step="0.01" value={form.area_feddan} onChange={e => sf({ area_feddan: e.target.value })} />
          </div>
          <div>
            <label className="label">الموسم</label>
            <select className="input" value={form.season_id} onChange={e => sf({ season_id: e.target.value })}>
              <option value="">— اختر الموسم —</option>
              {(seasons as { id: number; name: string }[]).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">نوع المحصول</label>
            <select className="input" value={form.crop_type} onChange={e => sf({ crop_type: e.target.value })}>
              <option value="">— اختر —</option>
              {CROPS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">نوع التربة</label>
            <select className="input" value={form.soil_type} onChange={e => sf({ soil_type: e.target.value })}>
              <option value="">— اختر —</option>
              {SOILS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">نوع الري</label>
            <select className="input" value={form.irrigation_type} onChange={e => sf({ irrigation_type: e.target.value })}>
              <option value="">— اختر —</option>
              {IRRIGATION.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="label">اسم المالك</label>
            <input className="input" value={form.landlord_name} onChange={e => sf({ landlord_name: e.target.value })} />
          </div>
          <div>
            <label className="label">الإيجار (جنيه/فدان)</label>
            <input className="input" type="number" value={form.rent_per_feddan} onChange={e => sf({ rent_per_feddan: e.target.value })} />
          </div>
          <div>
            <label className="label">الموقع</label>
            <input className="input" value={form.location} onChange={e => sf({ location: e.target.value })} />
          </div>
          <div>
            <label className="label">مركز التكلفة</label>
            <select className="input" value={form.center_code} onChange={e => sf({ center_code: e.target.value })}>
              <option value="">— بدون مركز تكلفة —</option>
              {(costCenters as { code: number; name: string }[]).map(cc => (
                <option key={cc.code} value={cc.code}>{cc.code} — {cc.name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">ملاحظات</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => sf({ notes: e.target.value })} />
          </div>
        </div>

        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}

        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => { setEditField(null); setForm(EMPTY); setErr('') }}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => update.mutate()}
            disabled={update.isPending || !form.name}
          >
            {update.isPending ? 'جاري الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
