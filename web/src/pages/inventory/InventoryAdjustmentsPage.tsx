import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ClipboardCheck, Plus, Calendar, Warehouse, ArrowRight, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { inventoryApi } from '../../api/client'
import Modal from '../../components/ui/Modal'

export default function InventoryAdjustmentsPage() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const { data: adjustments, isLoading } = useQuery({
    queryKey: ['inventory-adjustments'],
    queryFn: () => inventoryApi.adjustments(),
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ClipboardCheck size={24} className="text-indigo-600" />
            التسويات الجردية (Inventory Adjustments)
          </h1>
          <p className="text-xs text-slate-400 mt-1">مطابقة الأرصدة الفعلية في المخازن مع أرصدة النظام ومعالجة الفروقات</p>
        </div>
        <button className="btn-primary gap-2" onClick={() => setOpen(true)}>
          <Plus size={16} /> بدء جرد جديد
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="px-6 py-4">رقم العملية</th>
                <th className="px-6 py-4">التاريخ</th>
                <th className="px-6 py-4">المخزن</th>
                <th className="px-6 py-4">ملاحظات</th>
                <th className="px-6 py-4">الحالة</th>
                <th className="px-6 py-4">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && Array(5).fill(0).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={6} className="px-6 py-4 h-12 bg-slate-50/50"></td>
                </tr>
              ))}
              
              {adjustments?.map((adj: any) => (
                <tr key={adj.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-mono font-medium text-slate-700">#{adj.id}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <Calendar size={14} className="text-slate-400" />
                      {adj.adjustment_date}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-slate-800">
                    <div className="flex items-center gap-2">
                      <Warehouse size={14} className="text-indigo-500" />
                      {adj.warehouse_name}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{adj.notes || '-'}</td>
                  <td className="px-6 py-4">
                    {adj.status === 'posted' ? (
                      <span className="badge badge-success gap-1">
                        <CheckCircle2 size={12} /> مرحل
                      </span>
                    ) : adj.status === 'draft' ? (
                      <span className="badge badge-warning gap-1">
                        <Clock size={12} /> مسودة
                      </span>
                    ) : (
                      <span className="badge badge-danger gap-1">
                        <AlertTriangle size={12} /> ملغى
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      className="text-indigo-600 hover:text-indigo-800 font-bold text-xs flex items-center gap-1"
                      onClick={() => navigate(`/inventory/adjustments/${adj.id}`)}
                    >
                      التفاصيل <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}

              {!isLoading && adjustments?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    لا توجد عمليات جرد مسجلة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="بدء جرد مخزني جديد">
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
            تم دمج أداة التسوية الجردية مع مساحة العمل الموحدة.
            برجاء الانتقال إلى واجهة الجرد الفعلي الجديدة.
          </div>
          <div className="flex gap-3 pt-4">
            <button className="btn-secondary flex-1" onClick={() => setOpen(false)}>إلغاء</button>
            <button 
              className="btn-primary flex-1" 
              onClick={() => navigate('/inventory/physical-count')}
            >
              الانتقال لورقة الجرد
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
