import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import { treasuryApi } from '../../api/client'

interface Props { open: boolean; onClose: () => void }

const today = () => new Date().toISOString().slice(0, 10)

export default function AddCashTransactionModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const [saving, setSaving]   = useState(false)
  const [error,  setError]    = useState('')
  const [form, setForm] = useState({
    transaction_date: today(),
    direction:        'د',
    narration:        '',
    amount:           '',
    document_number:  '',
    recipient_name:   '',
    notes:            '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.narration.trim() || !form.amount) { setError('البيان والمبلغ مطلوبان'); return }

    setSaving(true)
    try {
      const res = await treasuryApi.create({
        transaction_date: form.transaction_date,
        direction:        form.direction,
        narration:        form.narration.trim(),
        amount:           Number(form.amount),
        document_number:  form.document_number ? Number(form.document_number) : undefined,
        recipient_name:   form.recipient_name.trim() || undefined,
        notes:            form.notes.trim() || undefined,
      })
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['treasury'] })
      setForm({ transaction_date: today(), direction: 'د', narration: '', amount: '', document_number: '', recipient_name: '', notes: '' })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="إضافة حركة خزينة" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">التاريخ</label>
            <input type="date" className="input" value={form.transaction_date}
              onChange={e => set('transaction_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">الاتجاه</label>
            <select className="input" value={form.direction} onChange={e => set('direction', e.target.value)}>
              <option value="د">وارد (د)</option>
              <option value="م">منصرف (م)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">البيان <span className="text-red-500">*</span></label>
          <input className="input" placeholder="وصف الحركة..." value={form.narration}
            onChange={e => set('narration', e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">المبلغ <span className="text-red-500">*</span></label>
            <input type="number" className="input" placeholder="0.00" min="0.01" step="0.01"
              value={form.amount} onChange={e => set('amount', e.target.value)} required />
          </div>
          <div>
            <label className="label">رقم المستند</label>
            <input type="number" className="input" placeholder="—" value={form.document_number}
              onChange={e => set('document_number', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">المستلم / المسلم</label>
          <input className="input" placeholder="الاسم..." value={form.recipient_name}
            onChange={e => set('recipient_name', e.target.value)} />
        </div>

        <div>
          <label className="label">ملاحظات</label>
          <textarea className="input" rows={2} placeholder="ملاحظات إضافية..." value={form.notes}
            onChange={e => set('notes', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>
            إلغاء
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ الحركة'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
