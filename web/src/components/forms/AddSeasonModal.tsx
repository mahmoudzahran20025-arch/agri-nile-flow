import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import { configApi } from '../../api/client'

interface Props { open: boolean; onClose: () => void }

export default function AddSeasonModal({ open, onClose }: Props) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form, setForm] = useState({
    name:        '',
    season_type: 'winter',
    start_date:  '',
    end_date:    '',
    notes:       '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.name || !form.start_date || !form.end_date) {
      setError('الاسم وتاريخ البداية والنهاية مطلوبة')
      return
    }
    if (form.end_date < form.start_date) {
      setError('تاريخ النهاية يجب أن يكون بعد البداية')
      return
    }
    setSaving(true)
    try {
      const res = await configApi.createSeason(form)
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['seasons'] })
      setForm({ name: '', season_type: 'winter', start_date: '', end_date: '', notes: '' })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="إضافة موسم زراعي" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">اسم الموسم <span className="text-red-500">*</span></label>
          <input className="input" placeholder="مثال: موسم القمح 2025" value={form.name}
            onChange={e => set('name', e.target.value)} required />
        </div>

        <div>
          <label className="label">نوع الموسم</label>
          <select className="input" value={form.season_type} onChange={e => set('season_type', e.target.value)}>
            <option value="winter">شتوي</option>
            <option value="summer">صيفي</option>
            <option value="annual">سنوي</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">تاريخ البداية <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={form.start_date}
              onChange={e => set('start_date', e.target.value)} required />
          </div>
          <div>
            <label className="label">تاريخ النهاية <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={form.end_date}
              onChange={e => set('end_date', e.target.value)} required />
          </div>
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
            {saving ? 'جاري الحفظ...' : 'إضافة الموسم'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
