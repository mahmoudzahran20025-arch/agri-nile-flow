import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, ArrowLeft, Send, Plus, Trash2, AlertCircle, Info, Package, Calculator } from 'lucide-react'
import { inventoryApi, configApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'

export default function AdjustmentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  
  const [lines, setLines] = useState<any[]>([])
  const [addingLine, setAddingLine] = useState({ item_code: '', theoretical_qty: 0, counted_qty: 0 })

  const { data: adjustment } = useQuery({
    queryKey: ['inventory-adjustment', id],
    queryFn: () => inventoryApi.adjustmentDetail(Number(id)),
  })

  const { data: items } = useQuery({
    queryKey: ['items'],
    queryFn: () => configApi.items(),
  })

  const { data: balances } = useQuery({
    queryKey: ['inventory-balances', adjustment?.data?.warehouse_name],
    queryFn: () => inventoryApi.balances(adjustment?.data?.warehouse_name),
    enabled: !!adjustment?.data?.warehouse_name,
  })

  useEffect(() => {
    if (adjustment?.data?.lines) {
      setLines(adjustment.data.lines)
    }
  }, [adjustment])

  const postMutation = useMutation({
    mutationFn: () => inventoryApi.postAdjustment(Number(id)),
    onSuccess: (res: any) => {
      if (res.success === false) { toast(res.error || 'خطأ', 'error'); return }
      toast('تم ترحيل التسوية وتحديث الأرصدة بنجاح', 'success')
      qc.invalidateQueries({ queryKey: ['inventory-adjustment', id] })
      qc.invalidateQueries({ queryKey: ['inventory-balances'] })
      navigate('/inventory/adjustments')
    },
    onError: () => toast('فشل في الترحيل', 'error')
  })

  const addLine = () => {
    if (!addingLine.item_code) return
    const item = items?.find((i: any) => i.code === Number(addingLine.item_code))
    const balance = balances?.find((b: any) => b.item_code === Number(addingLine.item_code)) as any
    
    const newLine = {
      item_code: Number(addingLine.item_code),
      item_name: item?.name || 'صنف غير معروف',
      unit: item?.unit || 'وحدة',
      theoretical_qty: balance?.balance_qty || 0,
      counted_qty: addingLine.counted_qty,
      difference: addingLine.counted_qty - (balance?.balance_qty || 0)
    }

    setLines([...lines, newLine])
    setAddingLine({ item_code: '', theoretical_qty: 0, counted_qty: 0 })
  }

  const removeLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx))
  }

  const isPosted = adjustment?.data?.status === 'posted'

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="page-header">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/inventory/adjustments')} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-slate-500" />
          </button>
          <div>
            <h1 className="page-title flex items-center gap-2">
              <ClipboardCheck size={24} className="text-indigo-600" />
              تفاصيل أمر الجرد #{id}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              مخزن: <span className="font-bold text-slate-600">{adjustment?.data?.warehouse_name}</span> | 
              التاريخ: <span className="font-bold text-slate-600">{adjustment?.data?.adjustment_date}</span>
            </p>
          </div>
        </div>
        
        {!isPosted && (
          <div className="flex gap-3">
            <button 
              className="btn-primary gap-2 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200" 
              onClick={() => {
                if (window.confirm('هل أنت متأكد من ترحيل التسوية؟ سيتم تحديث أرصدة المخازن فوراً وتوليد قيود محاسبية.')) {
                  postMutation.mutate()
                }
              }}
              disabled={postMutation.isPending || lines.length === 0}
            >
              <Send size={16} /> ترحيل واعتماد الأرصدة
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-slate-700 flex items-center gap-2">
                <Calculator size={18} className="text-indigo-500" />
                بنود الجرد والمطابقة
              </h3>
              <span className="text-xs font-medium text-slate-400">إجمالي البنود: {lines.length}</span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="text-[10px] text-slate-400 font-bold uppercase tracking-wider bg-white">
                    <th className="px-6 py-3">الصنف</th>
                    <th className="px-6 py-3">الرصيد الدفتري</th>
                    <th className="px-6 py-3">الرصيد الفعلي</th>
                    <th className="px-6 py-3">الفارق (العجز/الزيادة)</th>
                    {!isPosted && <th className="px-6 py-3"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-slate-100 rounded flex items-center justify-center text-slate-400">
                            <Package size={14} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-800">{line.item_name}</p>
                            <p className="text-[10px] text-slate-400">كود: #{line.item_code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-slate-600">{line.theoretical_qty} {line.unit}</td>
                      <td className="px-6 py-4 text-sm font-mono font-bold text-indigo-600">{line.counted_qty} {line.unit}</td>
                      <td className="px-6 py-4">
                        <span className={`text-sm font-bold font-mono ${line.difference < 0 ? 'text-rose-600' : line.difference > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {line.difference > 0 ? '+' : ''}{line.difference} {line.unit}
                        </span>
                      </td>
                      {!isPosted && (
                        <td className="px-6 py-4">
                          <button onClick={() => removeLine(idx)} className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}

                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle size={24} className="text-slate-200" />
                          <p>لا توجد بنود مضافة لهذه التسوية</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {!isPosted && (
              <div className="p-4 bg-slate-50 border-t border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-3">
                <select 
                  className="input text-xs"
                  value={addingLine.item_code}
                  onChange={e => setAddingLine({...addingLine, item_code: e.target.value})}
                >
                  <option value="">-- اختر الصنف --</option>
                  {items?.map((i: any) => (
                    <option key={i.code} value={i.code}>{i.name} (كود {i.code})</option>
                  ))}
                </select>
                <input 
                  type="number" 
                  className="input text-xs" 
                  placeholder="الكمية الفعلية المردودة..." 
                  value={addingLine.counted_qty || ''}
                  onChange={e => setAddingLine({...addingLine, counted_qty: Number(e.target.value)})}
                />
                <button className="btn-secondary gap-2" onClick={addLine} disabled={!addingLine.item_code}>
                  <Plus size={14} /> إضافة للجرد
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Info size={18} className="text-indigo-500" />
              ملخص الحالة
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">الحالة الحالية:</span>
                {adjustment?.data?.status === 'posted' ? (
                  <span className="badge badge-success">تم الترحيل</span>
                ) : (
                  <span className="badge badge-warning">قيد الجرد (مسودة)</span>
                )}
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">المخزن:</span>
                <span className="font-bold text-slate-700">{adjustment?.data?.warehouse_name}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">بواسطة:</span>
                <span className="text-slate-700">المسؤول الحالي</span>
              </div>
              
              <div className="pt-4 border-t border-slate-100">
                <p className="text-[10px] text-slate-400 uppercase font-bold mb-2">تعليمات</p>
                <ul className="text-xs text-slate-500 space-y-2 list-disc list-inside">
                  <li>أدخل الرصيد الفعلي الذي تم جده يدوياً في الخانة المخصصة.</li>
                  <li>النظام سيحسب تلقائياً الفرق بين الرصيد الدفتري والفعلي.</li>
                  <li>عند الترحيل، سيتم ضبط الأرصدة تلقائياً لتطابق الرصيد الفعلي.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
