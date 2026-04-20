import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import { api } from '../../api/client'

interface Props {
  open:       boolean
  onClose:    () => void
  title:      string
  endpoint:   string          // e.g. '/config/cost_centers'
  queryKey:   string[]        // cache key to invalidate
  extraLabel?: string         // optional extra text field label
}

export default function AddMasterRecordModal({ open, onClose, title, endpoint, queryKey }: Props) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [code,   setCode]   = useState('')
  const [name,   setName]   = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!code || !name) { setError('الكود والاسم مطلوبان'); return }
    setSaving(true)
    try {
      const res = await api.post(endpoint, { code: Number(code), name: name.trim() })
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey })
      setCode(''); setName('')
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title={title} onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">الكود <span className="text-red-500">*</span></label>
          <input type="number" className="input" placeholder="رقم فريد" value={code}
            onChange={e => setCode(e.target.value)} required />
        </div>
        <div>
          <label className="label">الاسم <span className="text-red-500">*</span></label>
          <input className="input" placeholder="الاسم..." value={name}
            onChange={e => setName(e.target.value)} required />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'إضافة'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
