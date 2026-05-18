import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Package, Save, AlertTriangle } from 'lucide-react'
import { configApi } from '../../api/config'
import { inventoryApi } from '../../api/inventory'
import { glApi } from '../../api/gl'
import { CommandBar } from '../../components/ui/CommandBar'

interface CreateBody {
  code:                    string
  name:                    string
  unit:                    string
  base_unit:               string
  package_type:            string
  package_capacity:        string
  category_id:             string
  prod_posting_group_code: string
  inv_posting_group_code:  string
  reorder_threshold:       string
  track_lots:              boolean
  item_type:               'inventory' | 'service' | 'non_stock'
  is_sellable:             boolean
  is_purchasable:          boolean
}

const EMPTY: CreateBody = {
  code: '', name: '', unit: '', base_unit: '', package_type: '', package_capacity: '',
  category_id: '', prod_posting_group_code: '', inv_posting_group_code: '',
  reorder_threshold: '', track_lots: false,
  item_type: 'inventory', is_sellable: true, is_purchasable: true,
}

export default function ItemCreatePage() {
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const [form, setForm] = useState<CreateBody>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof CreateBody, string>>>({})

  const { data: categories = [] } = useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn:  inventoryApi.categories,
    staleTime: 120_000,
  })
  const { data: ppgList = [] } = useQuery({
    queryKey: ['posting-groups', 'product'],
    queryFn:  () => glApi.postingGroups('product'),
    staleTime: 120_000,
  })
  const { data: ipgList = [] } = useQuery({
    queryKey: ['posting-groups', 'inventory'],
    queryFn:  () => glApi.postingGroups('inventory'),
    staleTime: 120_000,
  })

  const cats    = categories as { id: number; name: string }[]
  const ppgOpts = ppgList as { code: string; name: string }[]
  const ipgOpts = ipgList as { code: string; name: string }[]

  const mut = useMutation({
    mutationFn: () => configApi.createItem({
      code:                    Number(form.code),
      name:                    form.name.trim(),
      unit:                    form.unit.trim() || undefined,
      base_unit:               form.base_unit.trim() || undefined,
      package_type:            form.package_type.trim() || undefined,
      package_capacity:        form.package_capacity ? Number(form.package_capacity) : undefined,
      category_id:             form.category_id ? Number(form.category_id) : undefined,
      prod_posting_group_code: form.prod_posting_group_code || undefined,
      inv_posting_group_code:  form.inv_posting_group_code  || undefined,
      reorder_threshold:       form.reorder_threshold ? Number(form.reorder_threshold) : undefined,
      track_lots:              form.track_lots ? 1 : 0,
      item_type:               form.item_type,
      is_sellable:             form.is_sellable ? 1 : 0,
      is_purchasable:          form.is_purchasable ? 1 : 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory', 'items-master'] })
      navigate('/inventory/items', { replace: true })
    },
  })

  function validate(): boolean {
    const e: typeof errors = {}
    if (!form.code || isNaN(Number(form.code)) || Number(form.code) <= 0)
      e.code = 'الكود مطلوب ويجب أن يكون رقماً موجباً'
    if (!form.name.trim())
      e.name = 'الاسم مطلوب'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    mut.mutate()
  }

  const set = <K extends keyof CreateBody>(k: K, v: CreateBody[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const apiError = mut.error
    ? (mut.error as Error).message
    : mut.data && !(mut.data as any).success
      ? (mut.data as any).error
      : null

  return (
    <div className="flex flex-col h-full">
      <CommandBar
        title="صنف جديد"
        subtitle="إضافة صنف إلى سجل الأصناف الموحد"
        actions={[
          {
            label: 'رجوع',
            icon: <ArrowLeft size={15} />,
            variant: 'secondary' as const,
            onClick: () => navigate('/inventory/items'),
          },
          {
            label: mut.isPending ? 'جارٍ الحفظ…' : 'حفظ الصنف',
            icon: <Save size={15} />,
            variant: 'primary' as const,
            onClick: handleSubmit,
            disabled: mut.isPending,
          },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {apiError && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {apiError}
            </div>
          )}

          {/* Identity */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Package size={16} className="text-brand-600" />
              <h3 className="font-semibold text-slate-700">بيانات الصنف الأساسية</h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">
                  كود الصنف <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  className={`input ${errors.code ? 'border-red-400' : ''}`}
                  placeholder="مثال: 1001"
                  value={form.code}
                  onChange={e => set('code', e.target.value)}
                />
                {errors.code && <p className="text-xs text-red-500 mt-1">{errors.code}</p>}
              </div>

              <div>
                <label className="label">وحدة القياس</label>
                <input
                  type="text"
                  className="input"
                  placeholder="مثال: طن، كيلو، لتر"
                  value={form.unit}
                  onChange={e => set('unit', e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label">
                اسم الصنف <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className={`input ${errors.name ? 'border-red-400' : ''}`}
                placeholder="الاسم الكامل للصنف"
                value={form.name}
                onChange={e => set('name', e.target.value)}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">الفئة</label>
                <select
                  className="input"
                  value={form.category_id}
                  onChange={e => set('category_id', e.target.value)}
                >
                  <option value="">-- بدون فئة --</option>
                  {cats.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">للتجميع والتصفية فقط — لا تؤثر على الترحيل المحاسبي</p>
              </div>

              <div>
                <label className="label">حد إعادة الطلب</label>
                <input
                  type="number"
                  className="input"
                  placeholder="مثال: 100"
                  value={form.reorder_threshold}
                  onChange={e => set('reorder_threshold', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">نوع الصنف</label>
                <select className="input" value={form.item_type}
                  onChange={e => set('item_type', e.target.value as CreateBody['item_type'])}>
                  <option value="inventory">مخزوني (Inventory)</option>
                  <option value="service">خدمة (Service)</option>
                  <option value="non_stock">غير مخزوني (Non-Stock)</option>
                </select>
                <p className="text-xs text-slate-400 mt-1">يحدد آلية تتبع الحركة والترحيل</p>
              </div>
              <div className="flex flex-col justify-center gap-3 pt-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="rounded" checked={form.is_sellable}
                    onChange={e => set('is_sellable', e.target.checked)} />
                  <span className="text-sm">قابل للبيع</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="rounded" checked={form.is_purchasable}
                    onChange={e => set('is_purchasable', e.target.checked)} />
                  <span className="text-sm">قابل للشراء</span>
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <input
                type="checkbox"
                id="track_lots"
                checked={form.track_lots}
                onChange={e => set('track_lots', e.target.checked)}
                className="w-4 h-4 rounded accent-brand-600"
              />
              <label htmlFor="track_lots" className="text-sm text-slate-700 cursor-pointer select-none">
                تتبع الدفعات (Lot Tracking)
              </label>
            </div>
          </section>

          {/* Packaging */}
          <section className="card p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-slate-700">الوحدة والتغليف</h3>
              <p className="text-xs text-slate-500 mt-0.5">اترك فارغاً إن لم يكن الصنف مُعبّأً</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">الوحدة الأساسية</label>
                <input type="text" className="input" placeholder="مثال: كجم، لتر"
                  value={form.base_unit} onChange={e => set('base_unit', e.target.value)} />
                <p className="text-xs text-slate-400 mt-1">وحدة الحركة الأساسية</p>
              </div>
              <div>
                <label className="label">نوع العبوة</label>
                <input type="text" className="input" placeholder="مثال: كيس، برميل"
                  value={form.package_type} onChange={e => set('package_type', e.target.value)} />
              </div>
              <div>
                <label className="label">سعة العبوة</label>
                <input type="number" className="input" min="0" step="0.001" placeholder="0"
                  value={form.package_capacity} onChange={e => set('package_capacity', e.target.value)} />
                <p className="text-xs text-slate-400 mt-1">وحدات أساسية / عبوة</p>
              </div>
            </div>
            {form.package_capacity && Number(form.package_capacity) > 0 && (
              <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                عند الإدخال: عدد العبوات × {form.package_capacity} {form.base_unit || 'وحدة'} = الكمية الإجمالية
              </p>
            )}
          </section>

          {/* Posting groups */}
          <section className="card p-5 space-y-4">
            <h3 className="font-semibold text-slate-700">الإعداد المحاسبي</h3>
            <p className="text-xs text-slate-500 -mt-2">
              يمكن تعديل هذه الحقول لاحقاً من صفحة الأصناف. تعيينها الآن يمنع تحذيرات الترحيل.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">مجموعة ترحيل المنتج (PPG)</label>
                {ppgOpts.length > 0 ? (
                  <select
                    className="input"
                    value={form.prod_posting_group_code}
                    onChange={e => set('prod_posting_group_code', e.target.value)}
                  >
                    <option value="">-- بدون PPG --</option>
                    {ppgOpts.map(g => (
                      <option key={g.code} value={g.code}>{g.code} — {g.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    placeholder="مثال: FERT"
                    value={form.prod_posting_group_code}
                    onChange={e => set('prod_posting_group_code', e.target.value)}
                  />
                )}
              </div>

              <div>
                <label className="label">مجموعة ترحيل المخزون (IPG)</label>
                {ipgOpts.length > 0 ? (
                  <select
                    className="input"
                    value={form.inv_posting_group_code}
                    onChange={e => set('inv_posting_group_code', e.target.value)}
                  >
                    <option value="">-- بدون IPG --</option>
                    {ipgOpts.map(g => (
                      <option key={g.code} value={g.code}>{g.code} — {g.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    placeholder="مثال: GENERAL"
                    value={form.inv_posting_group_code}
                    onChange={e => set('inv_posting_group_code', e.target.value)}
                  />
                )}
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
