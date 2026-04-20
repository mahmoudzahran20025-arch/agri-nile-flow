import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import { suppliersApi } from '../../api/client'

interface Props { open: boolean; onClose: () => void; supplierCode: number; supplierName: string }

const today = () => new Date().toISOString().slice(0, 10)

export default function AddSupplierTransactionModal({ open, onClose, supplierCode, supplierName }: Props) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form, setForm] = useState({
    transaction_date: today(),
    entry_type:       'م',
    amount:           '',
    document_type:    '',
    document_number:  '',
    expense_category: '',
    unit:             '',
    quantity:         '',
    unit_price:       '',
    notes:            '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.amount) { setError('المبلغ مطلوب'); return }

    setSaving(true)
    try {
      const res = await suppliersApi.addTransaction(supplierCode, {
        transaction_date: form.transaction_date,
        entry_type:       form.entry_type,
        amount:           Number(form.amount),
        document_type:    form.document_type.trim() || undefined,
        document_number:  form.document_number ? Number(form.document_number) : undefined,
        expense_category: form.expense_category.trim() || undefined,
        unit:             form.unit.trim() || undefined,
        quantity:         form.quantity ? Number(form.quantity) : undefined,
        unit_price:       form.unit_price ? Number(form.unit_price) : undefined,
        notes:            form.notes.trim() || undefined,
      })
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['supplier-statement', String(supplierCode)] })
      await qc.invalidateQueries({ queryKey: ['supplier', String(supplierCode)] })
      await qc.invalidateQueries({ queryKey: ['suppliers'] })
      setForm({ transaction_date: today(), entry_type: 'م', amount: '', document_type: '', document_number: '', expense_category: '', unit: '', quantity: '', unit_price: '', notes: '' })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title={`إضافة قيد — ${supplierName}`} onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">التاريخ</label>
            <input type="date" className="input" value={form.transaction_date}
              onChange={e => set('transaction_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">نوع القيد</label>
            <select className="input" value={form.entry_type} onChange={e => set('entry_type', e.target.value)}>
              <option value="م">مدين (م)</option>
              <option value="د">دائن (د)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">المبلغ <span className="text-red-500">*</span></label>
            <input type="number" className="input" placeholder="0.00" min="0.01" step="0.01"
              value={form.amount} onChange={e => set('amount', e.target.value)} required />
          </div>
          <div>
            <label className="label">نوع المستند</label>
            <input className="input" placeholder="فاتورة / شيك / تحويل..." value={form.document_type}
              onChange={e => set('document_type', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">رقم المستند</label>
            <input type="number" className="input" placeholder="—" value={form.document_number}
              onChange={e => set('document_number', e.target.value)} />
          </div>
          <div>
            <label className="label">البند / الخدمة</label>
            <input className="input" placeholder="وصف الخدمة..." value={form.expense_category}
              onChange={e => set('expense_category', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">الوحدة</label>
            <input className="input" placeholder="طن / كجم..." value={form.unit}
              onChange={e => set('unit', e.target.value)} />
          </div>
          <div>
            <label className="label">الكمية</label>
            <input type="number" className="input" placeholder="0" min="0" step="0.001"
              value={form.quantity} onChange={e => set('quantity', e.target.value)} />
          </div>
          <div>
            <label className="label">سعر الوحدة</label>
            <input type="number" className="input" placeholder="0.00" min="0" step="0.01"
              value={form.unit_price} onChange={e => set('unit_price', e.target.value)} />
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
            {saving ? 'جاري الحفظ...' : 'حفظ القيد'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
