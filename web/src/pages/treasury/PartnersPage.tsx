import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Pencil } from 'lucide-react'
import { treasuryApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import type { Partner } from '../../types'

function egp(n: number) {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}

// ─── Add / Edit Partner Modal ─────────────────────────────────
function PartnerModal({
  open, onClose, partner,
}: {
  open: boolean; onClose: () => void; partner?: Partner
}) {
  const qc = useQueryClient()
  const isEdit = !!partner
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [form, setForm] = useState({
    name:         partner?.name         ?? '',
    capital_paid: String(partner?.capital_paid ?? ''),
    current_acct: String(partner?.current_acct ?? ''),
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.name) { setError('الاسم مطلوب'); return }
    setSaving(true)
    try {
      const payload = {
        name:         form.name.trim(),
        capital_paid: Number(form.capital_paid) || 0,
        current_acct: Number(form.current_acct) || 0,
      }
      const res = isEdit
        ? await treasuryApi.updatePartner(partner!.id, payload)
        : await treasuryApi.createPartner(payload)

      if (!(res as { success: boolean }).success) {
        setError((res as { error: string }).error ?? 'حدث خطأ')
        return
      }
      await qc.invalidateQueries({ queryKey: ['partners'] })
      onClose()
    } catch {
      setError('حدث خطأ في الاتصال')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title={isEdit ? 'تعديل شريك' : 'إضافة شريك'} onClose={onClose} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">الاسم <span className="text-red-500">*</span></label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">رأس المال المدفوع</label>
            <input type="number" className="input" min="0" step="0.01" placeholder="0"
              value={form.capital_paid} onChange={e => set('capital_paid', e.target.value)} />
          </div>
          <div>
            <label className="label">الحساب الجاري</label>
            <input type="number" className="input" step="0.01" placeholder="0"
              value={form.current_acct} onChange={e => set('current_acct', e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={saving}>إلغاء</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'جاري الحفظ...' : isEdit ? 'حفظ التعديل' : 'إضافة الشريك'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Main Page ────────────────────────────────────────────────
export default function PartnersPage() {
  const [addOpen,    setAddOpen]    = useState(false)
  const [editTarget, setEditTarget] = useState<Partner | undefined>()

  const { data: partners, isLoading } = useQuery({
    queryKey: ['partners'],
    queryFn:  () => treasuryApi.partners() as Promise<Partner[]>,
  })

  const totals = (partners ?? []).reduce(
    (acc, p) => ({
      capital: acc.capital + (p.capital_paid ?? 0),
      current: acc.current + (p.current_acct ?? 0),
    }),
    { capital: 0, current: 0 }
  )

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Users size={22} className="text-slate-400" />
            حقوق الشركاء
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {partners?.length ?? 0} شريك
          </p>
        </div>
        <button className="btn-primary gap-2" onClick={() => setAddOpen(true)}>
          <Plus size={16} />
          إضافة شريك
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'إجمالي رأس المال', val: totals.capital, color: 'text-brand-700' },
          { label: 'إجمالي الحساب الجاري', val: totals.current, color: totals.current >= 0 ? 'text-green-700' : 'text-red-600' },
          { label: 'إجمالي حقوق الشركاء', val: totals.capital + totals.current, color: 'text-slate-900 font-bold' },
        ].map(k => (
          <div key={k.label} className="card p-5 text-center">
            <p className="text-xs text-slate-500 mb-1">{k.label}</p>
            <p className={`text-xl font-semibold ${k.color}`}>{egp(k.val)}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center text-slate-400">جاري التحميل...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الشريك', 'رأس المال المدفوع', 'الحساب الجاري', 'إجمالي الحصة', ''].map(h => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(partners ?? []).map(p => {
                const total = (p.capital_paid ?? 0) + (p.current_acct ?? 0)
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-medium text-slate-800">{p.name}</td>
                    <td className="px-5 py-3.5 text-brand-700 font-medium">{egp(p.capital_paid ?? 0)}</td>
                    <td className="px-5 py-3.5">
                      <span className={p.current_acct >= 0 ? 'text-green-700' : 'text-red-600'}>
                        {egp(p.current_acct ?? 0)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{egp(total)}</td>
                    <td className="px-5 py-3.5 text-left">
                      <button
                        onClick={() => setEditTarget(p)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                      >
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!(partners ?? []).length && (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center text-slate-400">
                    لا يوجد شركاء مسجلون — أضف أول شريك
                  </td>
                </tr>
              )}
            </tbody>
            {(partners ?? []).length > 0 && (
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td className="px-5 py-2.5 font-semibold text-slate-600">الإجمالي</td>
                  <td className="px-5 py-2.5 font-bold text-brand-700">{egp(totals.capital)}</td>
                  <td className="px-5 py-2.5 font-bold">
                    <span className={totals.current >= 0 ? 'text-green-700' : 'text-red-600'}>
                      {egp(totals.current)}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 font-bold text-slate-900">{egp(totals.capital + totals.current)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      <PartnerModal open={addOpen} onClose={() => setAddOpen(false)} />
      <PartnerModal open={!!editTarget} onClose={() => setEditTarget(undefined)} partner={editTarget} />
    </div>
  )
}
