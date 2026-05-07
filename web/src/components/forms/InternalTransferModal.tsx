import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inventoryApi, configApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import Modal from '../ui/Modal'
import { ArrowRightLeft, Package, Plus, Trash2, CheckCircle } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  initialItemCode?: number
  initialItemName?: string
  initialSourceWarehouse?: string
}

interface TransferLine {
  id: string
  item_code: string
  item_name?: string
  quantity: string
  available?: number
  error?: string
}

const uid = () => Math.random().toString(36).slice(2, 9)

export default function InternalTransferModal({ open, onClose, initialItemCode, initialItemName, initialSourceWarehouse }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [fromWarehouse, setFromWarehouse] = useState(initialSourceWarehouse || '')
  const [toWarehouse, setToWarehouse] = useState('')
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<TransferLine[]>([])

  // Reset/Initialize
  useEffect(() => {
    if (open) {
      setFromWarehouse(initialSourceWarehouse || '')
      setToWarehouse('')
      setTransferDate(new Date().toISOString().split('T')[0])
      setNotes('')
      if (initialItemCode) {
        setLines([{ id: uid(), item_code: String(initialItemCode), item_name: initialItemName, quantity: '' }])
      } else {
        setLines([{ id: uid(), item_code: '', quantity: '' }])
      }
    }
  }, [open, initialItemCode, initialItemName, initialSourceWarehouse])

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: inventoryApi.warehouses,
    enabled: open
  })

  const { data: items = [] } = useQuery({
    queryKey: ['config-items-simple'],
    queryFn: configApi.items,
    enabled: open
  })

  const addLine = () => setLines(ls => [...ls, { id: uid(), item_code: '', quantity: '' }])
  const removeLine = (id: string) => setLines(ls => ls.length > 1 ? ls.filter(l => l.id !== id) : ls)
  
  const updateLine = (id: string, patch: Partial<TransferLine>) => 
    setLines(ls => ls.map(l => l.id === id ? { ...l, ...patch } : l))

  const handleQtyChange = (id: string, raw: string) => {
    const qty = Number(raw)
    setLines(ls => ls.map(l => {
      if (l.id !== id) return l
      if (!raw) return { ...l, quantity: '', error: undefined }
      if (qty <= 0) return { ...l, quantity: raw, error: 'الكمية يجب أن تكون أكبر من صفر' }
      if (l.available !== undefined && qty > l.available) {
        return { ...l, quantity: raw, error: `المتاح ${l.available}` }
      }
      return { ...l, quantity: raw, error: undefined }
    }))
  }

  const handleItemChange = async (id: string, code: string) => {
    const it = (items as any[]).find(i => String(i.code) === code)
    updateLine(id, { item_code: code, item_name: it?.name, available: undefined, error: undefined })
    
    if (code && fromWarehouse) {
      try {
        const stock = await inventoryApi.itemStock(Number(code), fromWarehouse)
        updateLine(id, { available: stock.total_qty })
      } catch {
        // stock fetch is best-effort — unavailable stock simply shows no available qty
      }
    }
  }

  const batchTransferMutation = useMutation({
    mutationFn: () => inventoryApi.transferBatch({
      movement_date: transferDate,
      from_warehouse: fromWarehouse,
      to_warehouse: toWarehouse,
      notes,
      items: lines.map(l => ({ item_code: Number(l.item_code), quantity: Number(l.quantity) }))
    }),
    onSuccess: (res: any) => {
      if (res.success === false) { toast(res.error || 'فشل التحويل', 'error'); return }
      toast(`تم تحويل ${lines.length} صنف بنجاح`, 'success')
      qc.invalidateQueries({ queryKey: ['inventory'], refetchType: 'active' })
      onClose()
    },
    onError: () => toast('خطأ في الاتصال بالخادم', 'error')
  })

  const isValid = fromWarehouse && toWarehouse && fromWarehouse !== toWarehouse && 
                  lines.length > 0 && lines.every(l => l.item_code && Number(l.quantity) > 0 && !l.error && (l.available === undefined || Number(l.quantity) <= l.available))

  return (
    <Modal open={open} onClose={onClose} title="تحويل بين المخازن" size="lg">
      <div className="space-y-5">
        
        {/* Warehouses Selection */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">من مخزن (المصدر)</label>
            <select 
              className="input bg-white border-slate-200"
              value={fromWarehouse}
              onChange={e => { setFromWarehouse(e.target.value); setLines(ls => ls.map(l => ({...l, available: undefined}))) }}
            >
              <option value="">-- اختر المصدر --</option>
              {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          
          <div className="pt-5 text-brand-500">
            <ArrowRightLeft size={20} />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">إلى مخزن (الوجهة)</label>
            <select 
              className="input bg-white border-slate-200"
              value={toWarehouse}
              onChange={e => setToWarehouse(e.target.value)}
            >
              <option value="">-- اختر الوجهة --</option>
              {warehouses.filter(w => w !== fromWarehouse).map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
        </div>

        {/* Transfer date */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 block mb-1">تاريخ التحويل</label>
          <input
            type="date"
            className="input bg-white border-slate-200"
            value={transferDate}
            onChange={e => setTransferDate(e.target.value)}
          />
        </div>

        {fromWarehouse && toWarehouse && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            سيتم إنشاء حركة تحويل بتاريخ اليوم من <strong>{fromWarehouse}</strong> إلى <strong>{toWarehouse}</strong> لكل الأصناف المحددة.
          </div>
        )}

        {/* Items List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <Package size={16} className="text-brand-500" />
              الأصناف المراد نقلها
            </h3>
            <button className="btn-ghost text-xs text-brand-600 gap-1 h-8" onClick={addLine}>
              <Plus size={14} /> إضافة صنف
            </button>
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {lines.map((line) => (
              <div key={line.id} className="group flex gap-2 items-start bg-white border border-slate-200 rounded-xl p-3 hover:border-brand-200 hover:shadow-sm transition-all">
                <div className="flex-1 space-y-2">
                  <select 
                    className="input text-sm py-1.5"
                    value={line.item_code}
                    onChange={e => handleItemChange(line.id, e.target.value)}
                  >
                    <option value="">-- اختر الصنف --</option>
                    {(items as any[]).map(i => <option key={i.code} value={i.code}>{i.name}</option>)}
                  </select>
                  
                  {line.item_code && (
                    <div className="flex items-center gap-4 px-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                        الرصيد المتاح: <span className={line.available === 0 ? 'text-red-500 font-bold' : 'text-slate-800'}>
                          {line.available !== undefined ? line.available : '...'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-32 space-y-2">
                  <div className="relative">
                    <input 
                      type="number" 
                      className={`input text-sm py-1.5 pr-8 ${line.error ? 'border-red-500 bg-red-50' : ''}`}
                      placeholder="الكمية"
                      value={line.quantity}
                      onChange={e => handleQtyChange(line.id, e.target.value)}
                    />
                    <button 
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-brand-600 font-bold"
                      onClick={() => line.available !== undefined && updateLine(line.id, { quantity: String(line.available) })}
                    >
                      الكل
                    </button>
                  </div>
                </div>

                {line.error && (
                  <div className="text-[11px] text-red-600 px-1">{line.error}</div>
                )}

                <button 
                  className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all mt-0.5"
                  onClick={() => removeLine(line.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="label text-xs">ملاحظات التحويل (اختياري)</label>
          <input 
            type="text" 
            className="input text-sm" 
            placeholder="مثال: نقل لموقع العمل، تسوية مخزنية..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
          <button 
            className="btn-primary flex-1 gap-2" 
            disabled={batchTransferMutation.isPending || !isValid}
            onClick={() => batchTransferMutation.mutate()}
          >
            {batchTransferMutation.isPending ? 'جاري التحويل...' : (
              <>
                <CheckCircle size={18} />
                تأكيد تحويل {lines.length} صنف
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
