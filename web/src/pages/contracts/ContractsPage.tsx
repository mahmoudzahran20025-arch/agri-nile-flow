import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Plus, ShoppingCart, TrendingUp, Banknote, CheckCircle2 } from 'lucide-react'
import { contractsApi, configApi, suppliersApi, fieldsApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import { usePermission } from '../../hooks/usePermission'

type Tab = 'purchase' | 'sales'

interface PurchaseContract {
  id: number; contract_number: string; contract_date: string; subject: string
  total_value: number; paid_value: number; status: string
  supplier_name?: string; season_name?: string; delivery_date?: string
}
interface SalesContract {
  id: number; contract_number: string; contract_date: string; buyer_name: string
  crop_type: string; quantity_ton: number; unit_price: number; total_value: number
  advance_paid: number; status: string; season_name?: string; field_name?: string
  advance_gl_entry_id?: number | null
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة', active: 'نشط', partial: 'جزئي', completed: 'مكتمل', cancelled: 'ملغى',
}
// @ts-ignore
const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-yellow', active: 'badge-blue', partial: 'badge-yellow',
  completed: 'badge-green', cancelled: 'badge-red',
}
const CONTRACT_STATUSES = ['draft','active','partial','completed','cancelled']

function fmt(n: number) { return Number(n).toLocaleString('ar-EG') }

export default function ContractsPage() {
  const { canWrite } = usePermission()
  const qc = useQueryClient()
  const [tab, setTab]         = useState<Tab>('purchase')
  const [openPurch, setOP]    = useState(false)
  const [openSales, setOS]    = useState(false)
  const [err, setErr]         = useState('')
  const [advContract, setAdv] = useState<SalesContract | null>(null)
  const [advForm, setAdvF]    = useState({ amount: '', receipt_date: new Date().toISOString().slice(0,10), notes: '' })
  const [advErr, setAdvErr]   = useState('')

  const [pForm, setPF] = useState({
    contract_number: '', contract_date: '', subject: '',
    total_value: '', paid_value: '', season_id: '', supplier_code: '',
    delivery_date: '', notes: '',
  })
  const [sForm, setSF] = useState({
    contract_number: '', contract_date: '', buyer_name: '', buyer_phone: '',
    crop_type: '', quantity_ton: '', unit_price: '', advance_paid: '',
    season_id: '', field_id: '', delivery_date: '', notes: '',
  })

  const { data: purchases = [] } = useQuery({
    queryKey: ['contracts-purchase'],
    queryFn:  () => contractsApi.listPurchase(),
  })
  const { data: sales = [] } = useQuery({
    queryKey: ['contracts-sales'],
    queryFn:  () => contractsApi.listSales(),
  })
  const { data: seasons = [] } = useQuery({ queryKey: ['seasons'],   queryFn: configApi.seasons })
  const { data: suppData }     = useQuery({ queryKey: ['suppliers-mini'], queryFn: () => suppliersApi.list({ size: 200 }) })
  const suppliers = (suppData as { data?: { code: number; name: string }[] })?.data ?? []
  const { data: fields = [] }  = useQuery({ queryKey: ['fields'],    queryFn: () => fieldsApi.list() })

  const createPurchase = useMutation({
    mutationFn: () => contractsApi.createPurchase({
      contract_number: pForm.contract_number.trim(),
      contract_date:   pForm.contract_date,
      subject:         pForm.subject.trim(),
      total_value:     Number(pForm.total_value) || 0,
      paid_value:      Number(pForm.paid_value)  || 0,
      season_id:       pForm.season_id    ? Number(pForm.season_id)    : undefined,
      supplier_code:   pForm.supplier_code ? Number(pForm.supplier_code) : undefined,
      delivery_date:   pForm.delivery_date || undefined,
      notes:           pForm.notes || undefined,
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setErr(res.error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['contracts-purchase'] })
      setOP(false)
      setPF({ contract_number:'', contract_date:'', subject:'', total_value:'', paid_value:'', season_id:'', supplier_code:'', delivery_date:'', notes:'' })
      setErr('')
    },
  })

  const createSales = useMutation({
    mutationFn: () => contractsApi.createSales({
      contract_number: sForm.contract_number.trim(),
      contract_date:   sForm.contract_date,
      buyer_name:      sForm.buyer_name.trim(),
      buyer_phone:     sForm.buyer_phone || undefined,
      crop_type:       sForm.crop_type,
      quantity_ton:    Number(sForm.quantity_ton) || 0,
      unit_price:      Number(sForm.unit_price)   || 0,
      advance_paid:    Number(sForm.advance_paid)  || 0,
      season_id:       sForm.season_id ? Number(sForm.season_id) : undefined,
      field_id:        sForm.field_id  ? Number(sForm.field_id)  : undefined,
      delivery_date:   sForm.delivery_date || undefined,
      notes:           sForm.notes || undefined,
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setErr(res.error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['contracts-sales'] })
      setOS(false)
      setSF({ contract_number:'', contract_date:'', buyer_name:'', buyer_phone:'', crop_type:'', quantity_ton:'', unit_price:'', advance_paid:'', season_id:'', field_id:'', delivery_date:'', notes:'' })
      setErr('')
    },
  })

  const updatePurchStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      contractsApi.updatePurchaseStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contracts-purchase'] }),
  })
  const updateSalesStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      contractsApi.updateSalesStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contracts-sales'] }),
  })

  const receiveAdvMut = useMutation({
    mutationFn: (c: SalesContract) =>
      contractsApi.receiveAdvance(c.id, {
        amount:       Number(advForm.amount),
        receipt_date: advForm.receipt_date,
        notes:        advForm.notes || undefined,
      }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { setAdvErr(res.error ?? 'خطأ'); return }
      qc.invalidateQueries({ queryKey: ['contracts-sales'] })
      setAdv(null)
      setAdvF({ amount: '', receipt_date: new Date().toISOString().slice(0,10), notes: '' })
      setAdvErr('')
    },
    onError: (e: Error) => setAdvErr(e.message),
  })

  const CROPS = ['قمح','ذرة','أرز','قصب سكر','قطن','بنجر','بصل','طماطم','أخرى']

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-brand-600" />
          <h1 className="text-xl font-bold text-gray-900">العقود</h1>
        </div>
        {canWrite('contracts') && (
          <button
            className="btn btn-primary"
            onClick={() => { tab === 'purchase' ? setOP(true) : setOS(true); setErr('') }}
          >
            <Plus size={16} /> عقد جديد
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setTab('purchase')}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'purchase' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ShoppingCart size={16} /> عقود الشراء
          <span className="badge badge-blue">{(purchases as PurchaseContract[]).length}</span>
        </button>
        <button
          onClick={() => setTab('sales')}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'sales' ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <TrendingUp size={16} /> عقود البيع
          <span className="badge badge-green">{(sales as SalesContract[]).length}</span>
        </button>
      </div>

      {/* Purchase Tab */}
      {tab === 'purchase' && (
        <div className="card overflow-hidden p-0">
          {(purchases as PurchaseContract[]).length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <ShoppingCart size={40} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد عقود شراء</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="th">رقم العقد</th>
                  <th className="th">التاريخ</th>
                  <th className="th">الموضوع</th>
                  <th className="th">المورد</th>
                  <th className="th">الموسم</th>
                  <th className="th">الإجمالي</th>
                  <th className="th">المدفوع</th>
                  <th className="th">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {(purchases as PurchaseContract[]).map(p => (
                  <tr key={p.id} className="border-b hover:bg-gray-50">
                    <td className="td font-mono text-brand-700">{p.contract_number}</td>
                    <td className="td">{p.contract_date}</td>
                    <td className="td font-medium">{p.subject}</td>
                    <td className="td text-gray-500">{p.supplier_name ?? '—'}</td>
                    <td className="td text-gray-500">{p.season_name ?? '—'}</td>
                    <td className="td font-medium">{fmt(p.total_value)} ج</td>
                    <td className="td">{fmt(p.paid_value)} ج</td>
                    <td className="td">
                      <select
                        className="text-xs border rounded px-1.5 py-0.5 bg-white"
                        value={p.status}
                        onChange={e => updatePurchStatus.mutate({ id: p.id, status: e.target.value })}
                      >
                        {CONTRACT_STATUSES.map(s => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t font-semibold text-sm">
                <tr>
                  <td className="td" colSpan={5}>الإجمالي</td>
                  <td className="td text-brand-700">
                    {fmt((purchases as PurchaseContract[]).reduce((s, p) => s + Number(p.total_value), 0))} ج
                  </td>
                  <td className="td text-green-700">
                    {fmt((purchases as PurchaseContract[]).reduce((s, p) => s + Number(p.paid_value), 0))} ج
                  </td>
                  <td className="td"></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Sales Tab */}
      {tab === 'sales' && (
        <div className="card overflow-hidden p-0">
          {(sales as SalesContract[]).length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <TrendingUp size={40} className="mx-auto mb-3 opacity-30" />
              <p>لا توجد عقود بيع</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="th">رقم العقد</th>
                  <th className="th">التاريخ</th>
                  <th className="th">المشتري</th>
                  <th className="th">المحصول</th>
                  <th className="th">الكمية (طن)</th>
                  <th className="th">سعر الطن</th>
                  <th className="th">إجمالي العقد</th>
                  <th className="th">الدفعة المقدمة</th>
                  <th className="th">الحالة</th>
                  <th className="th">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {(sales as SalesContract[]).map(s => (
                  <tr key={s.id} className="border-b hover:bg-gray-50">
                    <td className="td font-mono text-brand-700">{s.contract_number}</td>
                    <td className="td">{s.contract_date}</td>
                    <td className="td font-medium">{s.buyer_name}</td>
                    <td className="td">
                      <span className="badge badge-green">{s.crop_type}</span>
                    </td>
                    <td className="td text-center">{fmt(s.quantity_ton)}</td>
                    <td className="td">{fmt(s.unit_price)} ج</td>
                    <td className="td font-medium text-brand-700">{fmt(s.total_value)} ج</td>
                    <td className="td">
                      <div className="flex items-center gap-1.5">
                        <span className={s.advance_paid > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>
                          {fmt(s.advance_paid)} ج
                        </span>
                        {s.advance_paid > 0 && s.advance_gl_entry_id && (
                          <span title="مسجل في دفتر الأستاذ"><CheckCircle2 size={13} className="text-emerald-500" /></span>
                        )}
                      </div>
                    </td>
                    <td className="td">
                      <select
                        className="text-xs border rounded px-1.5 py-0.5 bg-white"
                        value={s.status}
                        onChange={e => updateSalesStatus.mutate({ id: s.id, status: e.target.value })}
                      >
                        {CONTRACT_STATUSES.map(st => (
                          <option key={st} value={st}>{STATUS_LABELS[st]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="td">
                      {s.advance_paid > 0 && !s.advance_gl_entry_id && canWrite('contracts') && (
                        <button
                          onClick={() => { setAdv(s); setAdvF(f => ({ ...f, amount: String(s.advance_paid) })); setAdvErr('') }}
                          className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-100 whitespace-nowrap"
                          title="تسجيل الدفعة المقدمة في الخزينة والمحاسبة"
                        >
                          <Banknote size={12} /> استلام مقدم
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t font-semibold text-sm">
                <tr>
                  <td className="td" colSpan={6}>الإجمالي</td>
                  <td className="td text-brand-700">
                    {fmt((sales as SalesContract[]).reduce((s, c) => s + Number(c.total_value), 0))} ج
                  </td>
                  <td className="td text-green-700">
                    {fmt((sales as SalesContract[]).reduce((s, c) => s + Number(c.advance_paid), 0))} ج
                  </td>
                  <td className="td"></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Purchase Contract Modal */}
      <Modal open={openPurch} onClose={() => setOP(false)} title="عقد شراء جديد" size="lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">رقم العقد *</label>
            <input className="input" value={pForm.contract_number} onChange={e => setPF(p => ({ ...p, contract_number: e.target.value }))} />
          </div>
          <div>
            <label className="label">التاريخ *</label>
            <input className="input" type="date" value={pForm.contract_date} onChange={e => setPF(p => ({ ...p, contract_date: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <label className="label">موضوع العقد *</label>
            <input className="input" value={pForm.subject} onChange={e => setPF(p => ({ ...p, subject: e.target.value }))} placeholder="توريد أسمدة موسم 2025" />
          </div>
          <div>
            <label className="label">المورد</label>
            <select className="input" value={pForm.supplier_code} onChange={e => setPF(p => ({ ...p, supplier_code: e.target.value }))}>
              <option value="">— اختر —</option>
              {suppliers.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">الموسم</label>
            <select className="input" value={pForm.season_id} onChange={e => setPF(p => ({ ...p, season_id: e.target.value }))}>
              <option value="">— اختر —</option>
              {(seasons as { id: number; name: string }[]).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">إجمالي العقد</label>
            <input className="input" type="number" value={pForm.total_value} onChange={e => setPF(p => ({ ...p, total_value: e.target.value }))} />
          </div>
          <div>
            <label className="label">المبلغ المدفوع</label>
            <input className="input" type="number" value={pForm.paid_value} onChange={e => setPF(p => ({ ...p, paid_value: e.target.value }))} />
          </div>
          <div>
            <label className="label">تاريخ التسليم</label>
            <input className="input" type="date" value={pForm.delivery_date} onChange={e => setPF(p => ({ ...p, delivery_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={pForm.notes} onChange={e => setPF(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setOP(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => createPurchase.mutate()}
            disabled={createPurchase.isPending || !pForm.contract_number || !pForm.contract_date || !pForm.subject}
          >
            {createPurchase.isPending ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </Modal>

      {/* Receive Advance Modal */}
      <Modal
        open={!!advContract}
        onClose={() => { setAdv(null); setAdvErr('') }}
        title="استلام دفعة مقدمة من عقد بيع"
      >
        {advContract && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-emerald-800">
                عقد #{advContract.contract_number} — {advContract.buyer_name}
              </p>
              <p className="text-xs text-emerald-600 mt-1">
                سيتم إنشاء قيد محاسبي: DR خزينة / CR إيرادات مؤجلة
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">المبلغ المستلم (ج.م) *</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={advForm.amount}
                  onChange={e => setAdvF(f => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">تاريخ الاستلام *</label>
                <input
                  className="input"
                  type="date"
                  value={advForm.receipt_date}
                  onChange={e => setAdvF(f => ({ ...f, receipt_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">ملاحظات</label>
                <input
                  className="input"
                  value={advForm.notes}
                  onChange={e => setAdvF(f => ({ ...f, notes: e.target.value }))}
                  placeholder="اختياري"
                />
              </div>
            </div>
            {advErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{advErr}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button className="btn btn-ghost" onClick={() => { setAdv(null); setAdvErr('') }}>إلغاء</button>
              <button
                className="btn btn-primary"
                onClick={() => advContract && receiveAdvMut.mutate(advContract)}
                disabled={receiveAdvMut.isPending || !advForm.amount || !advForm.receipt_date || Number(advForm.amount) <= 0}
              >
                {receiveAdvMut.isPending ? 'جاري التسجيل...' : 'تسجيل الاستلام وإنشاء القيد'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Sales Contract Modal */}
      <Modal open={openSales} onClose={() => setOS(false)} title="عقد بيع جديد" size="lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">رقم العقد *</label>
            <input className="input" value={sForm.contract_number} onChange={e => setSF(p => ({ ...p, contract_number: e.target.value }))} />
          </div>
          <div>
            <label className="label">التاريخ</label>
            <input className="input" type="date" value={sForm.contract_date} onChange={e => setSF(p => ({ ...p, contract_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">اسم المشتري *</label>
            <input className="input" value={sForm.buyer_name} onChange={e => setSF(p => ({ ...p, buyer_name: e.target.value }))} />
          </div>
          <div>
            <label className="label">هاتف المشتري</label>
            <input className="input" type="tel" value={sForm.buyer_phone} onChange={e => setSF(p => ({ ...p, buyer_phone: e.target.value }))} />
          </div>
          <div>
            <label className="label">نوع المحصول *</label>
            <select className="input" value={sForm.crop_type} onChange={e => setSF(p => ({ ...p, crop_type: e.target.value }))}>
              <option value="">— اختر —</option>
              {CROPS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">الكمية (طن) *</label>
            <input className="input" type="number" value={sForm.quantity_ton} onChange={e => setSF(p => ({ ...p, quantity_ton: e.target.value }))} />
          </div>
          <div>
            <label className="label">سعر الطن</label>
            <input className="input" type="number" value={sForm.unit_price} onChange={e => setSF(p => ({ ...p, unit_price: e.target.value }))} />
          </div>
          <div>
            <label className="label">الدفعة المقدمة</label>
            <input className="input" type="number" value={sForm.advance_paid} onChange={e => setSF(p => ({ ...p, advance_paid: e.target.value }))} />
          </div>
          <div>
            <label className="label">الموسم</label>
            <select className="input" value={sForm.season_id} onChange={e => setSF(p => ({ ...p, season_id: e.target.value }))}>
              <option value="">— اختر —</option>
              {(seasons as { id: number; name: string }[]).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">القطعة</label>
            <select className="input" value={sForm.field_id} onChange={e => setSF(p => ({ ...p, field_id: e.target.value }))}>
              <option value="">— اختر —</option>
              {(fields as { id: number; name: string }[]).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">تاريخ التسليم</label>
            <input className="input" type="date" value={sForm.delivery_date} onChange={e => setSF(p => ({ ...p, delivery_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={sForm.notes} onChange={e => setSF(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        {err && <p className="text-red-600 text-sm mt-3">{err}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setOS(false)}>إلغاء</button>
          <button
            className="btn btn-primary"
            onClick={() => createSales.mutate()}
            disabled={createSales.isPending || !sForm.contract_number || !sForm.buyer_name || !sForm.crop_type || !sForm.quantity_ton}
          >
            {createSales.isPending ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
