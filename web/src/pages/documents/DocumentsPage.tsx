import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileText, Plus, AlertTriangle, Search, RefreshCw,
  Clock, Trash2, Edit3,
} from 'lucide-react'
import {
  documentsApi, DOC_TYPE_LABELS, DOC_STATUS_LABELS,
} from '../../api/documents'
import type { Document } from '../../api/documents'
import Modal from '../../components/ui/Modal'

const DOC_TYPES = Object.entries(DOC_TYPE_LABELS)
const STATUS_OPTS = ['', 'active', 'expired', 'renewed', 'cancelled']

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null
  const diff = (new Date(dateStr).getTime() - Date.now()) / 86_400_000
  return Math.round(diff)
}

function ExpiryBadge({ expiry_date }: { expiry_date?: string }) {
  const days = daysUntil(expiry_date)
  if (days === null) return <span className="text-xs text-gray-400">—</span>
  if (days < 0)  return <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">منتهية منذ {Math.abs(days)}ي</span>
  if (days <= 7) return <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠ {days} أيام</span>
  if (days <= 30) return <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">⏰ {days} يوم</span>
  return <span className="text-xs text-gray-500">{expiry_date}</span>
}

// ── Add / Edit Form ───────────────────────────────────────────
interface DocFormProps {
  initial?: Partial<Document>
  onSubmit: (data: Partial<Document>) => void
  loading: boolean
  onClose: () => void
}
function DocForm({ initial, onSubmit, loading, onClose }: DocFormProps) {
  const [form, setForm] = useState({
    title:               initial?.title               ?? '',
    doc_type:            initial?.doc_type            ?? 'commercial_reg',
    ref_table:           initial?.ref_table           ?? '',
    ref_id:              initial?.ref_id ? String(initial.ref_id) : '',
    issue_date:          initial?.issue_date          ?? '',
    expiry_date:         initial?.expiry_date         ?? '',
    responsible_user_id: initial?.responsible_user_id ? String(initial.responsible_user_id) : '',
    file_name:           initial?.file_name           ?? '',
    notes:               initial?.notes               ?? '',
  })

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      title:               form.title,
      doc_type:            form.doc_type,
      ref_table:           form.ref_table || undefined,
      ref_id:              form.ref_id ? Number(form.ref_id) : undefined,
      issue_date:          form.issue_date || undefined,
      expiry_date:         form.expiry_date || undefined,
      responsible_user_id: form.responsible_user_id ? Number(form.responsible_user_id) : undefined,
      file_name:           form.file_name || undefined,
      notes:               form.notes || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">العنوان *</label>
        <input required value={form.title} onChange={f('title')}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="مثال: سجل تجاري الشركة الرئيسية" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">النوع *</label>
          <select value={form.doc_type} onChange={f('doc_type')}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">مرتبط بـ</label>
          <select value={form.ref_table} onChange={f('ref_table')}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— لا يوجد —</option>
            <option value="employees">موظف</option>
            <option value="suppliers">مورد / عميل</option>
            <option value="branches">فرع</option>
            <option value="fields">قطعة أرض</option>
            <option value="companies">الشركة</option>
          </select>
        </div>
      </div>

      {form.ref_table && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">رقم السجل المرتبط (ID)</label>
          <input type="number" value={form.ref_id} onChange={f('ref_id')}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="ID" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">تاريخ الإصدار</label>
          <input type="date" value={form.issue_date} onChange={f('issue_date')}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">تاريخ الانتهاء</label>
          <input type="date" value={form.expiry_date} onChange={f('expiry_date')}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">اسم الملف (اختياري)</label>
        <input value={form.file_name} onChange={f('file_name')}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="مثال: commercial_reg_2026.pdf" />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">ملاحظات</label>
        <textarea value={form.notes} onChange={f('notes')} rows={2}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50">إلغاء</button>
        <button type="submit" disabled={loading}
          className="px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'جاري الحفظ...' : 'حفظ'}
        </button>
      </div>
    </form>
  )
}

// ── Renew Modal ───────────────────────────────────────────────
function RenewModal({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const qc = useQueryClient()
  const [issue, setIssue]   = useState('')
  const [expiry, setExpiry] = useState('')
  const renewMut = useMutation({
    mutationFn: () => documentsApi.renew(doc.id, issue || undefined, expiry || undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); onClose() },
  })
  return (
    <Modal open onClose={onClose} title={`تجديد: ${doc.title}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">تاريخ الإصدار الجديد</label>
            <input type="date" value={issue} onChange={e => setIssue(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">تاريخ الانتهاء الجديد</label>
            <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border text-gray-600">إلغاء</button>
          <button onClick={() => renewMut.mutate()} disabled={renewMut.isPending}
            className="px-5 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {renewMut.isPending ? '...' : 'تجديد'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function DocumentsPage() {
  const qc = useQueryClient()
  const [q,           setQ]           = useState('')
  const [typeFilter,  setTypeFilter]  = useState('')
  const [statusFilter,setStatusFilter]= useState('active')
  const [showAdd,     setShowAdd]     = useState(false)
  const [editing,     setEditing]     = useState<Document | null>(null)
  const [renewing,    setRenewing]    = useState<Document | null>(null)

  const { data: docs  = [], isLoading } = useQuery({
    queryKey: ['documents', typeFilter, statusFilter],
    queryFn:  () => documentsApi.list({
      doc_type: typeFilter || undefined,
      status:   statusFilter || undefined,
    }),
  })

  const { data: alerts = [] } = useQuery({
    queryKey: ['documents', 'alerts'],
    queryFn:  documentsApi.alerts,
    staleTime: 300_000,
  })

  const createMut = useMutation({
    mutationFn: (b: Partial<Document>) => documentsApi.create(b as Parameters<typeof documentsApi.create>[0]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); setShowAdd(false) },
  })

  const updateMut = useMutation({
    mutationFn: (b: Partial<Document>) => documentsApi.update(editing!.id, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); setEditing(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => documentsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  })

  const filtered = docs.filter(d =>
    !q || d.title.includes(q) || DOC_TYPE_LABELS[d.doc_type]?.includes(q) || d.notes?.includes(q)
  )

  // KPIs
  const total    = docs.length
  const expiring = alerts.length
  const expired  = docs.filter(d => d.status === 'expired').length

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <FileText size={22} className="text-blue-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">إدارة المستندات</h1>
            <p className="text-sm text-gray-500">{total} مستند مسجل</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
        >
          <Plus size={16} /> إضافة مستند
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{total}</div>
          <div className="text-xs text-gray-500 mt-1">إجمالي المستندات</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-emerald-700">
            {docs.filter(d => d.status === 'active').length}
          </div>
          <div className="text-xs text-emerald-600 mt-1">سارية</div>
        </div>
        <div className={`${expiring > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'} border rounded-xl p-4 text-center`}>
          <div className={`text-2xl font-bold ${expiring > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>{expiring}</div>
          <div className={`text-xs mt-1 ${expiring > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>تنتهي خلال 60 يوم</div>
        </div>
        <div className={`${expired > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'} border rounded-xl p-4 text-center`}>
          <div className={`text-2xl font-bold ${expired > 0 ? 'text-red-700' : 'text-gray-400'}`}>{expired}</div>
          <div className={`text-xs mt-1 ${expired > 0 ? 'text-red-600' : 'text-gray-400'}`}>منتهية الصلاحية</div>
        </div>
      </div>

      {/* Alerts banner */}
      {alerts.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} className="text-yellow-600" />
            <span className="font-semibold text-yellow-800">تنبيهات الانتهاء — {alerts.length} مستند</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {alerts.map(a => (
              <div key={a.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                a.days_remaining <= 7 ? 'bg-red-50 border-red-200 text-red-700' :
                a.days_remaining <= 30 ? 'bg-orange-50 border-orange-200 text-orange-700' :
                'bg-yellow-50 border-yellow-200 text-yellow-700'
              }`}>
                <Clock size={12} />
                <span className="font-medium">{a.title}</span>
                <span>— {a.days_remaining <= 0 ? 'منتهي' : `${a.days_remaining} يوم`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute right-3 top-2.5 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="بحث في العنوان..."
            className="w-full border rounded-lg pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">كل الأنواع</option>
          {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {STATUS_OPTS.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === s ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {s === '' ? 'الكل' : DOC_STATUS_LABELS[s]?.label ?? s}
            </button>
          ))}
        </div>
      </div>

      {/* Documents table */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>لا توجد مستندات</p>
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="border-b bg-gray-50">
                <tr>
                  {['العنوان', 'النوع', 'الإصدار', 'الانتهاء', 'الحالة', 'المسؤول', ''].map(h => (
                    <th key={h} className="text-right py-3 px-4 text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(doc => {
                  const st = DOC_STATUS_LABELS[doc.status] ?? DOC_STATUS_LABELS.active
                  return (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="font-medium text-gray-900">{doc.title}</div>
                        {doc.file_name && (
                          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                            <FileText size={11} /> {doc.file_name}
                          </div>
                        )}
                        {doc.notes && <div className="text-xs text-gray-400 truncate max-w-[200px]">{doc.notes}</div>}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
                        {doc.ref_table && (
                          <div className="text-xs text-gray-400">{doc.ref_table} #{doc.ref_id}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{doc.issue_date ?? '—'}</td>
                      <td className="py-3 px-4">
                        <ExpiryBadge expiry_date={doc.expiry_date} />
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{doc.responsible_name ?? '—'}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => setRenewing(doc)} title="تجديد"
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg">
                            <RefreshCw size={14} />
                          </button>
                          <button onClick={() => setEditing(doc)} title="تعديل"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg">
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => { if (confirm('حذف المستند؟')) deleteMut.mutate(doc.id) }}
                            title="حذف"
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Status counts footer */}
      {docs.length > 0 && (
        <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-1">
          {Object.entries(DOC_STATUS_LABELS).map(([s, { label, color }]) => {
            const count = docs.filter(d => d.status === s).length
            return count > 0 ? (
              <span key={s} className={`px-2 py-0.5 rounded-full ${color}`}>
                {label}: {count}
              </span>
            ) : null
          })}
        </div>
      )}

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="إضافة مستند جديد">
        <DocForm
          onSubmit={d => createMut.mutate(d)}
          loading={createMut.isPending}
          onClose={() => setShowAdd(false)}
        />
      </Modal>

      {/* Edit Modal */}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`تعديل: ${editing.title}`}>
          <DocForm
            initial={editing}
            onSubmit={d => updateMut.mutate(d)}
            loading={updateMut.isPending}
            onClose={() => setEditing(null)}
          />
        </Modal>
      )}

      {/* Renew Modal */}
      {renewing && <RenewModal doc={renewing} onClose={() => setRenewing(null)} />}
    </div>
  )
}
