import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import { configApi, inventoryApi } from '../../api/client'
import { glApi } from '../../api/gl'

interface Props { open: boolean; onClose: () => void }

export default function AddItemModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form, setForm] = useState({
    code: '', name: '', unit: '', warehouse: '', reorder_threshold: '0', category_id: '', prod_posting_group_code: '',
  })

  const { data: ppgList = [] } = useQuery({
    queryKey: ['posting-groups', 'product'],
    queryFn:  () => glApi.postingGroups('product'),
  })

  const { data: categories } = useQuery({
    queryKey: ['item-categories'],
    queryFn: () => inventoryApi.categories(),
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.code || !form.name) { setError('الكود والاسم مطلوبان'); return }
    setSaving(true)
    try {
      const res = await configApi.createItem({
        code:                   Number(form.code),
        name:                   form.name.trim(),
        unit:                   form.unit.trim() || undefined,
        warehouse:              form.warehouse.trim() || undefined,
        reorder_threshold:      Number(form.reorder_threshold) || 0,
        category_id:            form.category_id ? Number(form.category_id) : undefined,
        prod_posting_group_code: form.prod_posting_group_code || undefined,
      })
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['config', 'items'] })
      setForm({ code: '', name: '', unit: '', warehouse: '', reorder_threshold: '0', category_id: '', prod_posting_group_code: '' })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="إضافة صنف مخزني" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">الكود <span className="text-red-500">*</span></label>
            <input type="number" className="input" placeholder="رقم فريد" value={form.code}
              onChange={e => set('code', e.target.value)} required />
          </div>
          <div>
            <label className="label">اسم الصنف <span className="text-red-500">*</span></label>
            <input className="input" placeholder="مثال: سماد نيتروجيني" value={form.name}
              onChange={e => set('name', e.target.value)} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">وحدة القياس</label>
            <input className="input" placeholder="طن / كجم / لتر..." value={form.unit}
              onChange={e => set('unit', e.target.value)} />
          </div>
          <div>
            <label className="label">المخزن الافتراضي</label>
            <input className="input" placeholder="اسم المخزن..." value={form.warehouse}
              onChange={e => set('warehouse', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">مجموعة الترحيل (PPG)</label>
            <select className="input" value={form.prod_posting_group_code} onChange={e => set('prod_posting_group_code', e.target.value)}>
              <option value="">— بدون مجموعة (الافتراضي) —</option>
              {ppgList.filter(g => g.is_active === 1).map(g => (
                <option key={g.code} value={g.code}>{g.code} — {g.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">تصنيف الصنف</label>
            <select 
              className="input" 
              value={form.category_id}
              onChange={e => set('category_id', e.target.value)}
            >
              <option value="">-- بدون تصنيف --</option>
              {categories?.map((cat: any) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">حد التنبيه (كمية إعادة الطلب)</label>
            <input type="number" className="input" min="0" value={form.reorder_threshold}
              onChange={e => set('reorder_threshold', e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'إضافة الصنف'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
