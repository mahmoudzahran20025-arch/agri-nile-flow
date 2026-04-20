import { useState } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import { inventoryApi, configApi } from '../../api/client'
import type { Item } from '../../types'

interface Props { open: boolean; onClose: () => void; defaultWarehouse?: string }

const today = () => new Date().toISOString().slice(0, 10)

export default function AddInventoryMovementModal({ open, onClose, defaultWarehouse }: Props) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form, setForm] = useState({
    movement_date:  today(),
    movement_type:  'اضافة',
    warehouse:      defaultWarehouse ?? '',
    item_code:      '',
    quantity:       '',
    unit_price:     '',
    document_number:'',
    notes:          '',
  })

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.warehouses,
    enabled:  open,
  })

  const { data: items } = useQuery({
    queryKey: ['config', 'items'],
    queryFn:  configApi.items as () => Promise<Item[]>,
    enabled:  open,
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.warehouse || !form.item_code || !form.quantity) {
      setError('المخزن والصنف والكمية مطلوبة')
      return
    }

    setSaving(true)
    try {
      const res = await inventoryApi.create({
        movement_date:   form.movement_date,
        movement_type:   form.movement_type,
        warehouse:       form.warehouse,
        item_code:       Number(form.item_code),
        quantity:        Number(form.quantity),
        unit_price:      form.unit_price ? Number(form.unit_price) : undefined,
        document_number: form.document_number ? Number(form.document_number) : undefined,
        notes:           form.notes.trim() || undefined,
      })
      if (!(res as { success: boolean }).success) {
        const code = (res as { code?: string }).code
        if (code === 'INSUFFICIENT_STOCK') {
          setError((res as { error: string }).error)
        } else {
          setError((res as { error: string }).error ?? 'حدث خطأ')
        }
        return
      }
      await qc.invalidateQueries({ queryKey: ['inventory'] })
      setForm({ movement_date: today(), movement_type: 'اضافة', warehouse: defaultWarehouse ?? '', item_code: '', quantity: '', unit_price: '', document_number: '', notes: '' })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="إضافة حركة مخزنية" onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">التاريخ</label>
            <input type="date" className="input" value={form.movement_date}
              onChange={e => set('movement_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">نوع الحركة</label>
            <select className="input" value={form.movement_type} onChange={e => set('movement_type', e.target.value)}>
              <option value="اضافة">إضافة (وارد)</option>
              <option value="صرف">صرف (منصرف)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">المخزن <span className="text-red-500">*</span></label>
          {warehouses && warehouses.length > 0 ? (
            <select className="input" value={form.warehouse} onChange={e => set('warehouse', e.target.value)} required>
              <option value="">-- اختر المخزن --</option>
              {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          ) : (
            <input className="input" placeholder="اسم المخزن" value={form.warehouse}
              onChange={e => set('warehouse', e.target.value)} required />
          )}
        </div>

        <div>
          <label className="label">الصنف <span className="text-red-500">*</span></label>
          {items && items.length > 0 ? (
            <select className="input" value={form.item_code} onChange={e => set('item_code', e.target.value)} required>
              <option value="">-- اختر الصنف --</option>
              {items.map(i => <option key={i.code} value={i.code}>{i.name} {i.unit ? `(${i.unit})` : ''}</option>)}
            </select>
          ) : (
            <input type="number" className="input" placeholder="كود الصنف" value={form.item_code}
              onChange={e => set('item_code', e.target.value)} required />
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">الكمية <span className="text-red-500">*</span></label>
            <input type="number" className="input" placeholder="0" min="0.001" step="0.001"
              value={form.quantity} onChange={e => set('quantity', e.target.value)} required />
          </div>
          {form.movement_type === 'اضافة' && (
            <div>
              <label className="label">سعر الوحدة</label>
              <input type="number" className="input" placeholder="0.00" min="0" step="0.01"
                value={form.unit_price} onChange={e => set('unit_price', e.target.value)} />
            </div>
          )}
          <div>
            <label className="label">رقم المستند</label>
            <input type="number" className="input" placeholder="—" value={form.document_number}
              onChange={e => set('document_number', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">ملاحظات</label>
          <textarea className="input" rows={2} placeholder="ملاحظات..." value={form.notes}
            onChange={e => set('notes', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ الحركة'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
