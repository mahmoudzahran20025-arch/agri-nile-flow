import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Pencil, PieChart, TrendingUp } from 'lucide-react'
import { treasuryApi, glApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import { TableSkeleton } from '../../components/ui/Skeleton'
import type { Partner } from '../../types'
import { usePermission } from '../../hooks/usePermission'

function startOfYear() { return `${new Date().getFullYear()}-01-01` }
function today()       { return new Date().toISOString().slice(0, 10) }

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

// ─── Profit Distribution Modal ───────────────────────────────
function DistributeModal({
  open, onClose, netIncome, partners,
}: {
  open: boolean; onClose: () => void
  netIncome: number; partners: Partner[]
}) {
  const totalCapital = partners.reduce((s, p) => s + (p.capital_paid ?? 0), 0)
  return (
    <Modal open={open} title="توزيع الأرباح" onClose={onClose} size="md">
      <div className="space-y-4">
        <div className="bg-brand-50 rounded-xl p-4 flex justify-between items-center">
          <span className="text-sm font-medium text-brand-800">صافي الربح للتوزيع</span>
          <span className="text-xl font-bold text-brand-700">{egp(netIncome)}</span>
        </div>
        {totalCapital === 0 ? (
          <p className="text-sm text-red-600">لا يمكن التوزيع — لم يُسجَّل رأس مال بعد</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-right py-2 font-semibold text-gray-600">الشريك</th>
                <th className="text-left  py-2 font-semibold text-gray-600">النسبة</th>
                <th className="text-left  py-2 font-semibold text-gray-600">الحصة</th>
              </tr>
            </thead>
            <tbody>
              {partners.map(p => {
                const pct   = totalCapital > 0 ? (p.capital_paid ?? 0) / totalCapital : 0
                const share = netIncome * pct
                return (
                  <tr key={p.id} className="border-b">
                    <td className="py-2.5 font-medium">{p.name}</td>
                    <td className="py-2.5 text-left text-gray-500">{(pct * 100).toFixed(1)}%</td>
                    <td className={`py-2.5 text-left font-bold ${share >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {egp(share)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="text-xs text-gray-400">
          * التوزيع مبني على نسبة رأس المال المدفوع. لتحديث الحساب الجاري يدوياً — عدّل بيانات الشريك.
        </p>
        <div className="flex justify-end mt-2">
          <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main Page ────────────────────────────────────────────────
export default function PartnersPage() {
  const { canWrite } = usePermission()
  const [addOpen,       setAddOpen]       = useState(false)
  const [editTarget,    setEditTarget]    = useState<Partner | undefined>()
  const [distributeOpen,setDistributeOpen]= useState(false)

  const { data: partners, isLoading } = useQuery({
    queryKey: ['partners'],
    queryFn:  () => treasuryApi.partners() as Promise<Partner[]>,
  })

  const { data: incomeData } = useQuery({
    queryKey: ['partners-income'],
    queryFn:  () => glApi.incomeStatement(startOfYear(), today()) as Promise<{ net_income: number }>,
  })

  const netIncome   = (incomeData as { net_income?: number } | undefined)?.net_income ?? 0
  const totalCapital = (partners ?? []).reduce((s, p) => s + (p.capital_paid ?? 0), 0)

  const totals = (partners ?? []).reduce(
    (acc, p) => ({
      capital: acc.capital + (p.capital_paid ?? 0),
      current: acc.current + (p.current_acct ?? 0),
    }),
    { capital: 0, current: 0 }
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Users size={22} className="text-slate-400" />
            حقوق الشركاء
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">{partners?.length ?? 0} شريك</p>
        </div>
        <div className="flex items-center gap-2">
          {(partners ?? []).length > 0 && (
            <button className="btn-secondary gap-2" onClick={() => setDistributeOpen(true)}>
              <PieChart size={16} />
              توزيع الأرباح
            </button>
          )}
          {canWrite('treasury') && (
            <button className="btn-primary gap-2" onClick={() => setAddOpen(true)}>
              <Plus size={16} />
              إضافة شريك
            </button>
          )}
        </div>
      </div>

      {/* KPI row — 4 cards now (+ Net Income from GL) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5 text-center">
          <p className="text-xs text-slate-500 mb-1">إجمالي رأس المال</p>
          <p className="text-xl font-semibold text-brand-700">{egp(totals.capital)}</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-xs text-slate-500 mb-1">إجمالي الحساب الجاري</p>
          <p className={`text-xl font-semibold ${totals.current >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {egp(totals.current)}
          </p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-xs text-slate-500 mb-1">إجمالي حقوق الشركاء</p>
          <p className="text-xl font-bold text-slate-900">{egp(totals.capital + totals.current)}</p>
        </div>
        <div className={`card p-5 text-center ${netIncome >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className="flex items-center justify-center gap-1 mb-1">
            <TrendingUp size={13} className={netIncome >= 0 ? 'text-green-600' : 'text-red-500'} />
            <p className="text-xs text-slate-500">صافي ربح العام</p>
          </div>
          <p className={`text-xl font-bold ${netIncome >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {egp(Math.abs(netIncome))}
          </p>
          {netIncome < 0 && <p className="text-xs text-red-400 mt-0.5">خسارة</p>}
        </div>
      </div>

      {/* Partners table */}
      {isLoading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : (
      <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['الشريك', 'رأس المال', 'نسبة المشاركة', 'الحساب الجاري', 'إجمالي الحصة', ''].map(h => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold text-slate-500 text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(partners ?? []).map(p => {
                const total = (p.capital_paid ?? 0) + (p.current_acct ?? 0)
                const pct   = totalCapital > 0 ? ((p.capital_paid ?? 0) / totalCapital) * 100 : 0
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-medium text-slate-800">{p.name}</td>
                    <td className="px-5 py-3.5 text-brand-700 font-medium">{egp(p.capital_paid ?? 0)}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-brand-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-slate-600 text-xs font-medium">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={p.current_acct >= 0 ? 'text-green-700' : 'text-red-600'}>
                        {egp(p.current_acct ?? 0)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{egp(total)}</td>
                    <td className="px-5 py-3.5 text-left">
                      {canWrite('treasury') && (
                        <button
                          onClick={() => setEditTarget(p)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!(partners ?? []).length && (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center text-slate-400">
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
                  <td className="px-5 py-2.5 text-xs text-slate-400">100%</td>
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
      </div>
      )}

      <PartnerModal open={addOpen} onClose={() => setAddOpen(false)} />
      <PartnerModal open={!!editTarget} onClose={() => setEditTarget(undefined)} partner={editTarget} />
      <DistributeModal
        open={distributeOpen}
        onClose={() => setDistributeOpen(false)}
        netIncome={netIncome}
        partners={partners ?? []}
      />
    </div>
  )
}
