import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, MapPin, CheckCircle2, ShieldCheck } from 'lucide-react'
import { inventoryApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import Modal from '../../components/ui/Modal'
import { glApi } from '../../api/gl'
import { CommandBar } from '../../components/ui/CommandBar'

export default function WarehousesPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'internal', location: '', inv_posting_group_code: '' })

  const { data: ipgList = [] } = useQuery({
    queryKey: ['posting-groups', 'inventory'],
    queryFn:  () => glApi.postingGroups('inventory'),
  })

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
      setForm({ name: '', type: 'internal', location: '', inv_posting_group_code: '' })
      qc.invalidateQueries({ queryKey: ['warehouses-setup'] })
      qc.invalidateQueries({ queryKey: ['inventory-warehouses'] })
    },
    onError: () => toast('فشل في الاتصال', 'error')
  })

  const warehouses = (data as any)?.entities || []

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <CommandBar
        title="إعدادات المخازن والمواقع"
        subtitle="إدارة الكيانات التخزينية المادية والافتراضية"
        actions={[{
          label: 'إضافة مخزن',
          icon: <Plus size={15} />,
          variant: 'primary',
          onClick: () => setOpen(true),
        }]}
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
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
          <div>
            <label className="label">مجموعة ترحيل المخزون (IPG)</label>
            <select className="input" value={form.inv_posting_group_code} onChange={e => setForm({ ...form, inv_posting_group_code: e.target.value })}>
              <option value="">— بدون مجموعة (سيستخدم الافتراضي) —</option>
              {ipgList.filter((g: any) => g.is_active === 1).map((g: any) => (
                <option key={g.code} value={g.code}>{g.code} — {g.name}</option>
              ))}
            </select>
            {!form.inv_posting_group_code && (
              <p className="text-xs text-amber-600 mt-1">⚠️ بدون مجموعة، سيتم استخدام قاعدة حساب المخزون الافتراضية عند الترحيل.</p>
            )}
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
      </div>{/* end scroll container */}
    </div>
  )
}
