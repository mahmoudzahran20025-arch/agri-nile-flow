import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Building2, MapPin, CheckCircle2, ShieldCheck } from 'lucide-react'
import { inventoryApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import Modal from '../../components/ui/Modal'

export default function WarehousesPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'internal', location: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['warehouses-setup'],
    queryFn: () => inventoryApi.warehousesSetup(),
  })

  const createMutation = useMutation({
    mutationFn: () => inventoryApi.createWarehouse(form),
    onSuccess: (res: any) => {
      if (res.success === false) { toast(res.error || 'خطأ', 'error'); return }
      toast('تم إضافة المخزن بنجاح', 'success')
      setOpen(false)
      setForm({ name: '', type: 'internal', location: '' })
      qc.invalidateQueries({ queryKey: ['warehouses-setup'] })
      qc.invalidateQueries({ queryKey: ['inventory-warehouses'] })
    },
    onError: () => toast('فشل في الاتصال', 'error')
  })

  const warehouses = (data as any)?.entities || []

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Building2 size={24} className="text-indigo-600" />
            إعدادات المخازن والمواقع
          </h1>
          <p className="text-xs text-slate-400 mt-1">إدارة الكيانات التخزينية المادية والافتراضية</p>
        </div>
        <button className="btn-primary gap-2" onClick={() => setOpen(true)}>
          <Plus size={16} /> إضافة مخزن
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading && <div className="card animate-pulse h-32 bg-slate-100" />}
        {warehouses.map((w: any) => (
          <div key={w.id} className="card p-5 hover:shadow-lg transition-all border-l-4 border-l-indigo-500">
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-bold text-lg text-slate-800">{w.name}</h3>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700">
                <ShieldCheck size={12} />
                {w.type === 'internal' ? 'مخزن داخلي' : w.type}
              </span>
            </div>
            {w.location && (
              <div className="flex items-center gap-2 text-sm text-slate-500 mt-2">
                <MapPin size={14} /> {w.location}
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
              <span>كود المخزن: #{w.id}</span>
              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                <CheckCircle2 size={12} /> نشط
              </span>
            </div>
          </div>
        ))}
        {!isLoading && warehouses.length === 0 && (
          <div className="col-span-full card text-center py-10 text-slate-400">
            لا توجد مخازن مضافة
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="إضافة كيان تخزيني جديد">
        <div className="space-y-4">
          <div>
            <label className="label">اسم المخزن *</label>
            <input className="input" placeholder="مثال: المستودع الرئيسي"
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">نوع المستودع</label>
            <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="internal">مخزن داخلي (Physical)</option>
              <option value="virtual">مخزن افتراضي (Virtual)</option>
              <option value="transit">ترانزيت (Transit)</option>
            </select>
          </div>
          <div>
            <label className="label">الموقع الجغرافي / العنوان</label>
            <input className="input" placeholder="اختياري..."
              value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-4">
            <button className="btn-secondary flex-1" onClick={() => setOpen(false)}>إلغاء</button>
            <button className="btn-primary flex-1" disabled={createMutation.isPending || !form.name.trim()}
              onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? 'جاري الحفظ...' : 'حفظ المخزن'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
