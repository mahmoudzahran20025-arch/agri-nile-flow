import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inventoryApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import Modal from '../ui/Modal'
import { ArrowRightLeft, Package, MapPin } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  itemCode: number
  itemName: string
  sourceWarehouse: string
  maxQuantity: number
}

export default function InternalTransferModal({ open, onClose, itemCode, itemName, sourceWarehouse, maxQuantity }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [toWarehouse, setToWarehouse] = useState('')
  const [quantity, setQuantity] = useState<number | ''>('')
  const [notes, setNotes] = useState('')

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-setup'],
    queryFn: () => inventoryApi.warehousesSetup(),
  })

  const warehouses = (warehousesData as any)?.entities || []
  const validWarehouses = warehouses.filter((w: any) => w.name !== sourceWarehouse)

  const directTransferMutation = useMutation({
    mutationFn: () => inventoryApi.transfer({
      movement_date: new Date().toISOString().split('T')[0],
      item_code: itemCode,
      quantity: Number(quantity),
      from_warehouse: sourceWarehouse,
      to_warehouse: toWarehouse,
      notes
    }),
    onSuccess: (res: any) => {
      if (res.success === false) { toast(res.error || 'فشل التحويل', 'error'); return }
      toast('تم تحويل المخزون بنجاح', 'success')
      qc.invalidateQueries({ queryKey: ['inventory'] })
      onClose()
    },
    onError: () => toast('خطأ في الاتصال بالخادم', 'error')
  })

  return (
    <Modal open={open} onClose={onClose} title="تحويل مخزني داخلي (Internal Transfer)">
      <div className="space-y-4">
        
        {/* Item Info Card */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center">
              <Package size={20} />
            </div>
            <div>
              <p className="font-bold text-slate-800">{itemName}</p>
              <p className="text-xs text-indigo-600 font-semibold">المتاح للنقل: {maxQuantity}</p>
            </div>
          </div>
        </div>

        {/* Transfer Path */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
          <div>
            <label className="label text-slate-500">من مخزن (المصدر)</label>
            <div className="input bg-slate-50 text-slate-500 cursor-not-allowed flex items-center gap-2">
              <MapPin size={16} />
              {sourceWarehouse}
            </div>
          </div>
          
          <div className="pb-3 text-slate-400">
            <ArrowRightLeft size={20} />
          </div>

          <div>
            <label className="label">إلى مخزن (الوجهة) *</label>
            <select 
              className="input border-indigo-200 focus:border-indigo-500 focus:ring-indigo-500" 
              value={toWarehouse} 
              onChange={e => setToWarehouse(e.target.value)}
            >
              <option value="">-- اختر المخزن --</option>
              {validWarehouses.map((w: any) => (
                <option key={w.name} value={w.name}>{w.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">الكمية المراد نقلها *</label>
          <div className="relative">
            <input 
              type="number" 
              className="input pr-16" 
              placeholder="0.0"
              min={0.1}
              max={maxQuantity}
              step="any"
              value={quantity}
              onChange={e => setQuantity(Number(e.target.value))}
            />
            <button 
              className="absolute top-1/2 -translate-y-1/2 right-2 text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100"
              onClick={() => setQuantity(maxQuantity)}
            >
              الكل
            </button>
          </div>
        </div>

        <div>
          <label className="label">ملاحظات (اختياري)</label>
          <input 
            type="text" 
            className="input" 
            placeholder="سبب التحويل أو رقم إذن النقل..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <div className="flex gap-3 pt-4">
          <button className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
          <button 
            className="btn-primary flex-1 bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200" 
            disabled={directTransferMutation.isPending || !toWarehouse || !quantity || quantity <= 0 || quantity > maxQuantity}
            onClick={() => directTransferMutation.mutate()}
          >
            {directTransferMutation.isPending ? 'جاري التحويل...' : 'تأكيد التحويل'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
