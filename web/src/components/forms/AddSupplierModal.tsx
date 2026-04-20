import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import { suppliersApi } from '../../api/client'

interface Props { open: boolean; onClose: () => void }

export default function AddSupplierModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form, setForm] = useState({ code: '', name: '', activity: '', notes: '' })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.code || !form.name) { setError('الكود والاسم مطلوبان'); return }

    setSaving(true)
    try {
      const res = await suppliersApi.create({
        code:     Number(form.code),
        name:     form.name.trim(),
        activity: form.activity.trim() || undefined,
        notes:    form.notes.trim() || undefined,
      })
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['suppliers'] })
      setForm({ code: '', name: '', activity: '', notes: '' })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="إضافة مورد / عميل جديد" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">الكود <span className="text-red-500">*</span></label>
            <input type="number" className="input" placeholder="رقم فريد" value={form.code}
              onChange={e => set('code', e.target.value)} required />
          </div>
          <div>
            <label className="label">الاسم <span className="text-red-500">*</span></label>
            <input className="input" placeholder="اسم المورد أو العميل" value={form.name}
              onChange={e => set('name', e.target.value)} required />
          </div>
        </div>

        <div>
          <label className="label">النشاط / التصنيف</label>
          <input className="input" placeholder="مثال: أسمدة / مبيدات / خدمات..." value={form.activity}
            onChange={e => set('activity', e.target.value)} />
        </div>

        <div>
          <label className="label">ملاحظات</label>
          <textarea className="input" rows={2} value={form.notes}
            onChange={e => set('notes', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'إضافة المورد'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
