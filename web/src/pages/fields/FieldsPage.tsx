import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, CheckCircle, XCircle } from 'lucide-react'
import { fieldsApi, configApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import { usePermission } from '../../hooks/usePermission'

interface Field {
  id: number; code: string; name: string; area_feddan: number
  season_name?: string; crop_type?: string; irrigation_type?: string
  landlord_name?: string; is_active: number
}

interface FieldForm {
  code: string; name: string; area_feddan: string; season_id: string
  location: string; crop_type: string; soil_type: string
  irrigation_type: string; landlord_name: string; rent_per_feddan: string; notes: string
}

const EMPTY: FieldForm = {
  code: '', name: '', area_feddan: '', season_id: '',
  location: '', crop_type: '', soil_type: '',
  irrigation_type: '', landlord_name: '', rent_per_feddan: '', notes: '',
}

const CROPS      = ['قمح','ذرة','أرز','قصب سكر','قطن','بنجر السكر','بصل','طماطم','أخرى']
const SOILS      = ['طيني','رملي','طيني رملي','طفلي']
const IRRIGATION = ['غمر','تنقيط','رش','ري بالأخاديد']

export default function FieldsPage() {
  const { canWrite } = usePermission()
  const qc = useQueryClient()
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm]     = useState<FieldForm>(EMPTY)
  const [err, setErr]       = useState('')

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ['fields'],
    queryFn:  () => fieldsApi.list(),
  })
  const { data: seasons = [] } = useQuery({
    queryKey: ['seasons'],
    queryFn:  configApi.seasons,
  })

  const create = useMutation({
    mutationFn: () => fieldsApi.create({
      code: form.code.trim(),
      name: form.name.trim(),
      area_feddan: Number(form.area_feddan) || 0,
      season_id:   form.season_id ? Number(form.season_id) : undefined,
      location:    form.location || undefined,
      crop_type:   form.crop_type || undefined,
      soil_type:   form.soil_type || undefined,
      irrigation_type: form.irrigation_type || undefined,
      landlord_name:   form.landlord_name || undefined,
      rent_per_feddan: form.rent_per_feddan ? Number(form.rent_per_feddan) : undefined,
      notes:       form.notes || undefined,
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setErr(res.error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['fields'] })
      setOpen(false); setForm(EMPTY); setErr('')
    },
  })

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
                <th className="th">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id} className="border-b hover:bg-gray-50 transition-colors">
                  <td className="td font-mono text-brand-700">{f.code}</td>
                  <td className="td font-medium">{f.name}</td>
                  <td className="td text-center">{f.area_feddan?.toLocaleString('ar-EG')}</td>
                  <td className="td text-gray-500">{f.season_name ?? '—'}</td>
                  <td className="td">{f.crop_type ?? '—'}</td>
                  <td className="td">{f.irrigation_type ?? '—'}</td>
                  <td className="td">{f.landlord_name ?? '—'}</td>
                  <td className="td">
                    {f.is_active
                      ? <span className="badge badge-green flex items-center gap-1 w-fit"><CheckCircle size={12}/> نشطة</span>
                      : <span className="badge badge-red flex items-center gap-1 w-fit"><XCircle size={12}/> متوقفة</span>}
                  </td>
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
          <div className="col-span-2">
            <label className="label">ملاحظات</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => sf({ notes: e.target.value })} />
          </div>
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
    </div>
  )
}
