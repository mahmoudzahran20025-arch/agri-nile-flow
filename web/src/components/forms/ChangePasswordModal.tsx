import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import Modal from '../ui/Modal'
import { authApi } from '../../api/client'

interface Props { open: boolean; onClose: () => void }

export default function ChangePasswordModal({ open, onClose }: Props) {
  const [saving,  setSaving]  = useState(false)
  const [success, setSuccess] = useState(false)
  const [error,   setError]   = useState('')
  const [showCur, setShowCur] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.next !== form.confirm) { setError('كلمة المرور الجديدة وتأكيدها غير متطابقتين'); return }
    if (form.next.length < 6)       { setError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل'); return }

    setSaving(true)
    try {
      const res = await authApi.changePassword(form.current, form.next)
      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      setSuccess(true)
      setForm({ current: '', next: '', confirm: '' })
      setTimeout(() => { setSuccess(false); onClose() }, 1800)
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title="تغيير كلمة المرور" onClose={onClose} size="sm">
      {success ? (
        <div className="py-8 text-center space-y-3">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <KeyRound size={24} className="text-green-600" />
          </div>
          <p className="font-semibold text-slate-800">تم تغيير كلمة المرور بنجاح</p>
          <p className="text-sm text-slate-400">سيتم إغلاق هذه النافذة تلقائياً</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">كلمة المرور الحالية</label>
            <div className="relative">
              <input
                type={showCur ? 'text' : 'password'}
                className="input pl-10"
                value={form.current}
                onChange={e => set('current', e.target.value)}
                required
              />
              <button type="button" tabIndex={-1}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                onClick={() => setShowCur(v => !v)}>
                {showCur ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="label">كلمة المرور الجديدة</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                className="input pl-10"
                placeholder="6 أحرف على الأقل"
                value={form.next}
                onChange={e => set('next', e.target.value)}
                required minLength={6}
              />
              <button type="button" tabIndex={-1}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                onClick={() => setShowNew(v => !v)}>
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="label">تأكيد كلمة المرور الجديدة</label>
            <input
              type="password"
              className="input"
              value={form.confirm}
              onChange={e => set('confirm', e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>إلغاء</button>
            <button type="submit" className="btn-primary flex-1" disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'تغيير كلمة المرور'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
