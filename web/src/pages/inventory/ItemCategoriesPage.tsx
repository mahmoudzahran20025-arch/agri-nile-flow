import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FolderTree, Tag, Info } from 'lucide-react'
import { inventoryApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import Modal from '../../components/ui/Modal'

export default function ItemCategoriesPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', expense_account_code: '', inventory_account_code: '' })

  const { data: categories, isLoading } = useQuery({
    queryKey: ['item-categories'],
    queryFn: () => inventoryApi.categories(),
  })

  const createMutation = useMutation({
    mutationFn: (body: any) => inventoryApi.createCategory(body),
    onSuccess: (res: any) => {
      if (res.success === false) { toast(res.error || 'خطأ', 'error'); return }
      toast('تم إضافة التصنيف بنجاح', 'success')
      setOpen(false)
      setForm({ name: '', expense_account_code: '', inventory_account_code: '' })
      qc.invalidateQueries({ queryKey: ['item-categories'] })
    },
    onError: () => toast('فشل الاتصال بالخادم', 'error')
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <FolderTree size={24} className="text-indigo-600" />
            تصنيفات الأصناف (Item Categories)
          </h1>
          <p className="text-xs text-slate-400 mt-1">تنظيم الأصناف في مجموعات منطقية للتقارير والتوجيه المحاسبي</p>
        </div>
        <button className="btn-primary gap-2" onClick={() => setOpen(true)}>
          <Plus size={16} /> إضافة تصنيف جديد
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading && Array(6).fill(0).map((_, i) => (
          <div key={i} className="card animate-pulse h-32 bg-slate-100" />
        ))}
        
        {categories?.map((cat: any) => (
          <div key={cat.id} className="card p-5 border-r-4 border-r-indigo-500 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                  <Tag size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">{cat.name}</h3>
                  <p className="text-[10px] text-slate-400">كود: #{cat.id}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="p-2 bg-slate-50 rounded-md">
                <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">حساب المخزون</p>
                <p className="text-xs font-mono font-medium text-slate-700">{cat.inventory_account_code || 'افتراضي'}</p>
              </div>
              <div className="p-2 bg-slate-50 rounded-md">
                <p className="text-[9px] text-slate-400 uppercase tracking-wider mb-1">حساب المصروف</p>
                <p className="text-xs font-mono font-medium text-slate-700">{cat.expense_account_code || 'افتراضي'}</p>
              </div>
            </div>
          </div>
        ))}

        {!isLoading && categories?.length === 0 && (
          <div className="col-span-full py-20 card text-center space-y-3">
            <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto">
              <FolderTree size={32} />
            </div>
            <p className="text-slate-400">لا توجد تصنيفات معرفة بعد</p>
          </div>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="إضافة تصنيف أصناف جديد">
        <div className="space-y-4">
          <div className="bg-blue-50 p-3 rounded-lg flex gap-3 text-blue-700 text-xs">
            <Info size={16} className="shrink-0" />
            <p>التصنيفات تساعد في تجميع التقارير المالية وتحديد الحسابات المحاسبية الافتراضية لكل مجموعة من الأصناف.</p>
          </div>

          <div>
            <label className="label">اسم التصنيف *</label>
            <input 
              className="input" 
              placeholder="مثال: مبيدات حشرية، أسمدة ورقية..." 
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">حساب المخزون (GL)</label>
              <input 
                className="input font-mono" 
                placeholder="1130" 
                value={form.inventory_account_code}
                onChange={e => setForm({...form, inventory_account_code: e.target.value})}
              />
            </div>
            <div>
              <label className="label">حساب المصروف (GL)</label>
              <input 
                className="input font-mono" 
                placeholder="5110" 
                value={form.expense_account_code}
                onChange={e => setForm({...form, expense_account_code: e.target.value})}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button className="btn-secondary flex-1" onClick={() => setOpen(false)}>إلغاء</button>
            <button 
              className="btn-primary flex-1" 
              disabled={createMutation.isPending || !form.name.trim()}
              onClick={() => createMutation.mutate(form)}
            >
              {createMutation.isPending ? 'جاري الحفظ...' : 'حفظ التصنيف'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
