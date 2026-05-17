import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, ToggleLeft, ToggleRight, Link2, Trash2, X, Save, ChevronDown } from 'lucide-react'
import { glApi, suppliersApi } from '../../api/client'

const GROUP_LABELS: Record<string, string> = {
  MECHANIZATION: 'ميكنة',
  LABOR:         'عمالة',
  SUPPLY:        'توريد / مشتريات',
  SUPERVISION:   'إشراف',
  LOGISTICS:     'لوجستيات',
  SPARE_PARTS:   'قطع غيار',
  OTHER:         'أخرى',
}

const GROUPS = Object.keys(GROUP_LABELS)

interface ServiceType {
  id: number; code: string; name_ar: string; name_en: string | null
  service_group: string; default_expense_account_code: string | null
  default_ap_account_code: string | null; requires_supplier: number
  requires_document: number; requires_center: number; is_active: number
}

interface MapRow {
  id: number; supplier_code: number; supplier_name: string | null
  service_type_code: string; default_ap_account_code: string | null
  default_expense_account_code: string | null; is_primary: number; is_active: number
}

const EMPTY_FORM = {
  code: '', name_ar: '', name_en: '', service_group: 'SUPPLY',
  default_expense_account_code: '', default_ap_account_code: '',
  requires_supplier: 0, requires_document: 0, requires_center: 0,
}

export default function ServiceTypesPage() {
  const qc = useQueryClient()

  // Service types state
  const [showForm, setShowForm]   = useState(false)
  const [editId, setEditId]       = useState<number | null>(null)
  const [form, setForm]           = useState({ ...EMPTY_FORM })
  const [formError, setFormError] = useState('')

  // Supplier mapping state
  const [mapForm, setMapForm]     = useState({ supplier_code: '', service_type_code: '', default_ap_account_code: '', is_primary: 0 })
  const [showMapForm, setShowMapForm] = useState(false)
  const [mapError, setMapError]   = useState('')

  const { data: types = [], isLoading: typesLoading } = useQuery({
    queryKey: ['gl-service-types'],
    queryFn:  () => glApi.serviceTypes() as Promise<ServiceType[]>,
  })

  const { data: mapRows = [], isLoading: mapLoading } = useQuery({
    queryKey: ['gl-supplier-service-map'],
    queryFn:  () => glApi.supplierServiceMap() as Promise<MapRow[]>,
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list-dropdown'],
    queryFn:  () => suppliersApi.list({ size: 200 }) as Promise<{ data: Array<{ code: number; name: string }> }>,
    select:   res => (res as unknown as { data: Array<{ code: number; name: string }> }).data ?? [],
  })

  const createType = useMutation({
    mutationFn: () => glApi.createServiceType({
      code: form.code.toUpperCase(), name_ar: form.name_ar, name_en: form.name_en || undefined,
      service_group: form.service_group,
      default_expense_account_code: form.default_expense_account_code || undefined,
      default_ap_account_code: form.default_ap_account_code || undefined,
      requires_supplier: form.requires_supplier, requires_document: form.requires_document, requires_center: form.requires_center,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gl-service-types'] }); resetForm() },
    onError: (e: Error) => setFormError(e.message ?? 'حدث خطأ'),
  })

  const updateType = useMutation({
    mutationFn: () => glApi.updateServiceType(editId!, {
      name_ar: form.name_ar, name_en: form.name_en || null, service_group: form.service_group,
      default_expense_account_code: form.default_expense_account_code || null,
      default_ap_account_code: form.default_ap_account_code || null,
      requires_supplier: form.requires_supplier, requires_document: form.requires_document, requires_center: form.requires_center,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gl-service-types'] }); resetForm() },
    onError: (e: Error) => setFormError(e.message ?? 'حدث خطأ'),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, val }: { id: number; val: number }) => glApi.updateServiceType(id, { is_active: val }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['gl-service-types'] }),
  })

  const addMap = useMutation({
    mutationFn: () => glApi.addSupplierServiceMap({
      supplier_code: Number(mapForm.supplier_code),
      service_type_code: mapForm.service_type_code,
      default_ap_account_code: mapForm.default_ap_account_code || undefined,
      is_primary: mapForm.is_primary,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gl-supplier-service-map'] }); setShowMapForm(false); setMapForm({ supplier_code: '', service_type_code: '', default_ap_account_code: '', is_primary: 0 }) },
    onError: (e: Error) => setMapError(e.message ?? 'حدث خطأ'),
  })

  const removeMap = useMutation({
    mutationFn: (id: number) => glApi.removeSupplierServiceMap(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['gl-supplier-service-map'] }),
  })

  const resetForm = () => { setShowForm(false); setEditId(null); setForm({ ...EMPTY_FORM }); setFormError('') }

  const startEdit = (t: ServiceType) => {
    setEditId(t.id)
    setForm({ code: t.code, name_ar: t.name_ar, name_en: t.name_en ?? '', service_group: t.service_group, default_expense_account_code: t.default_expense_account_code ?? '', default_ap_account_code: t.default_ap_account_code ?? '', requires_supplier: t.requires_supplier, requires_document: t.requires_document, requires_center: t.requires_center })
    setShowForm(true); setFormError('')
  }

  const submitForm = () => {
    if (!form.name_ar.trim()) { setFormError('الاسم العربي مطلوب'); return }
    if (!editId && !form.code.trim()) { setFormError('الكود مطلوب'); return }
    setFormError('')
    editId ? updateType.mutate() : createType.mutate()
  }

  // Group types by service_group for display
  const byGroup: Record<string, ServiceType[]> = {}
  for (const t of types as ServiceType[]) {
    if (!byGroup[t.service_group]) byGroup[t.service_group] = []
    byGroup[t.service_group].push(t)
  }

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-bold text-[#0F2D5C]">أنواع الخدمات</h1>
            <p className="text-[12px] text-slate-500 mt-0.5">إدارة taxonomy الخدمات وربط الموردين بأنواع الخدمات</p>
          </div>
          <button
            onClick={() => { setEditId(null); setForm({ ...EMPTY_FORM }); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-[#0F2D5C] hover:bg-[#1a3d7c] rounded"
          >
            <Plus size={14} /> نوع جديد
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* Service type form */}
        {showForm && (
          <div className="bg-white rounded-lg border border-indigo-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-bold text-slate-700">{editId ? 'تعديل نوع الخدمة' : 'إضافة نوع خدمة جديد'}</h2>
              <button onClick={resetForm}><X size={16} className="text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {!editId && (
                <div>
                  <label className="text-[11px] font-bold text-slate-500 mb-1 block">الكود <span className="text-red-500">*</span></label>
                  <input className="input h-8 text-[12px] font-mono uppercase" placeholder="SRV_XXXX" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
                </div>
              )}
              <div>
                <label className="text-[11px] font-bold text-slate-500 mb-1 block">الاسم العربي <span className="text-red-500">*</span></label>
                <input className="input h-8 text-[12px]" value={form.name_ar} onChange={e => setForm(f => ({ ...f, name_ar: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 mb-1 block">المجموعة</label>
                <select className="input h-8 text-[12px]" value={form.service_group} onChange={e => setForm(f => ({ ...f, service_group: e.target.value }))}>
                  {GROUPS.map(g => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 mb-1 block">حساب المصروف الافتراضي</label>
                <input className="input h-8 text-[12px] font-mono" placeholder="كود الحساب" value={form.default_expense_account_code} onChange={e => setForm(f => ({ ...f, default_expense_account_code: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 mb-1 block">حساب AP الافتراضي</label>
                <input className="input h-8 text-[12px] font-mono" placeholder="كود الحساب" value={form.default_ap_account_code} onChange={e => setForm(f => ({ ...f, default_ap_account_code: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-6 text-[12px]">
              {([['requires_supplier', 'يتطلب مورد'], ['requires_document', 'يتطلب مستند'], ['requires_center', 'يتطلب مركز تكلفة']] as [keyof typeof form, string][]).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.checked ? 1 : 0 }))} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {formError && <p className="text-[11px] text-red-600">{formError}</p>}
            <div className="flex gap-2">
              <button onClick={submitForm} disabled={createType.isPending || updateType.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-[12px] font-semibold text-white bg-[#0F2D5C] hover:bg-[#1a3d7c] disabled:opacity-50">
                <Save size={13} /> {editId ? 'حفظ التعديلات' : 'إضافة'}
              </button>
              <button onClick={resetForm} className="px-3 py-1.5 rounded text-[12px] text-slate-500 hover:bg-slate-100">إلغاء</button>
            </div>
          </div>
        )}

        {/* Service types by group */}
        {typesLoading ? (
          <div className="text-center py-8 text-slate-400 text-[12px]">جاري التحميل…</div>
        ) : (
          GROUPS.filter(g => byGroup[g]?.length).map(g => (
            <div key={g} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{GROUP_LABELS[g]}</span>
                <span className="text-[11px] text-slate-400">({byGroup[g].length})</span>
              </div>
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    {['الكود', 'الاسم', 'حساب المصروف', 'حساب AP', 'متطلبات', 'الحالة', ''].map(h => (
                      <th key={h} className="px-4 py-2 text-right text-[11px] font-bold text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {byGroup[g].map((t: ServiceType) => (
                    <tr key={t.id} className={`hover:bg-slate-50 ${!t.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">{t.code}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{t.name_ar}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{t.default_expense_account_code ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{t.default_ap_account_code ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          {t.requires_supplier  ? <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px]">مورد</span>   : null}
                          {t.requires_document  ? <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px]">مستند</span> : null}
                          {t.requires_center    ? <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px]">مركز</span>   : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => toggleActive.mutate({ id: t.id, val: t.is_active ? 0 : 1 })}
                          className={`text-[11px] font-medium flex items-center gap-1 ${t.is_active ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {t.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                          {t.is_active ? 'نشط' : 'معطل'}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => startEdit(t)} className="text-slate-400 hover:text-slate-700 p-1">
                          <Pencil size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}

        {/* Supplier-service map */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link2 size={15} className="text-slate-500" />
              <h2 className="text-[13px] font-bold text-slate-700">ربط الموردين بأنواع الخدمات</h2>
            </div>
            <button
              onClick={() => setShowMapForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-[#0F2D5C] border border-[#0F2D5C] hover:bg-slate-50 rounded font-medium"
            >
              <Plus size={13} /> إضافة ربط
              <ChevronDown size={12} className={showMapForm ? 'rotate-180' : ''} />
            </button>
          </div>

          {showMapForm && (
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-[11px] font-bold text-slate-500 mb-1 block">المورد</label>
                <select className="input h-8 text-[12px]" value={mapForm.supplier_code} onChange={e => setMapForm(f => ({ ...f, supplier_code: e.target.value }))}>
                  <option value="">— اختر مورد —</option>
                  {(suppliers as Array<{ code: number; name: string }>).map(s => (
                    <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 mb-1 block">نوع الخدمة</label>
                <select className="input h-8 text-[12px]" value={mapForm.service_type_code} onChange={e => setMapForm(f => ({ ...f, service_type_code: e.target.value }))}>
                  <option value="">— اختر نوع —</option>
                  {(types as ServiceType[]).filter(t => t.is_active).map(t => (
                    <option key={t.code} value={t.code}>{t.name_ar} ({t.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 mb-1 block">حساب AP المخصص</label>
                <input className="input h-8 text-[12px] font-mono" placeholder="اختياري" value={mapForm.default_ap_account_code} onChange={e => setMapForm(f => ({ ...f, default_ap_account_code: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                  <input type="checkbox" checked={!!mapForm.is_primary} onChange={e => setMapForm(f => ({ ...f, is_primary: e.target.checked ? 1 : 0 }))} />
                  خدمة أساسية
                </label>
                <button onClick={() => { if (!mapForm.supplier_code || !mapForm.service_type_code) { setMapError('المورد ونوع الخدمة مطلوبان'); return } setMapError(''); addMap.mutate() }}
                  disabled={addMap.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 rounded text-[12px] font-semibold text-white bg-[#0F2D5C] hover:bg-[#1a3d7c] disabled:opacity-50">
                  <Save size={12} /> إضافة
                </button>
                {mapError && <p className="text-[10px] text-red-600">{mapError}</p>}
              </div>
            </div>
          )}

          {mapLoading ? (
            <div className="px-4 py-6 text-center text-slate-400 text-[12px]">جاري التحميل…</div>
          ) : (mapRows as MapRow[]).length === 0 ? (
            <div className="px-4 py-6 text-center text-slate-400 text-[12px]">لا توجد روابط بعد</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['المورد', 'نوع الخدمة', 'حساب AP', 'أساسي', ''].map(h => (
                    <th key={h} className="px-4 py-2 text-right text-[11px] font-bold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(mapRows as MapRow[]).map(r => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{r.supplier_name ?? `#${r.supplier_code}`}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{r.supplier_code}</p>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-600">{r.service_type_code}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{r.default_ap_account_code ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {r.is_primary ? <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold">أساسي</span> : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => removeMap.mutate(r.id)} className="text-slate-300 hover:text-red-500 p-1">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  )
}
