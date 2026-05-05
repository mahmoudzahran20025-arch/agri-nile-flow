import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Package, ArrowRight, Warehouse,
  ArrowDownCircle, ArrowUpCircle, Calendar, Hash, DollarSign,
  BarChart3, Download, Plus,
} from 'lucide-react'
import { inventoryApi, configApi, downloadCsv } from '../../api/client'
import AddInventoryBatchModal from '../../components/forms/AddInventoryBatchModal'
import { usePermission } from '../../hooks/usePermission'
import type { Item } from '../../types'

// ─── Formatters ────────────────────────────────────────────────

const EGP = (n: number | null | undefined) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n)
}
const NUM = (n: number | null | undefined, dp = 3) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: dp }).format(n)
}
const DATE_AR = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })

// ─── Types ─────────────────────────────────────────────────────

interface CardRow {
  movement_date:  string
  warehouse:      string
  movement_type:  string
  quantity:       number
  unit_price:     number | null
  qty_in:         number
  qty_out:        number
  balance_qty:    number
  value_in:       number
  value_out:      number
  balance_value:  number
  document_number: number | null
  notes:          string | null
}

interface StockByWarehouse {
  warehouse:     string
  balance_qty:   number
  balance_value: number
}

// ─── Summary KPI card ─────────────────────────────────────────

function KPI({ label, value, sub, color = 'slate', icon }: {
  label: string; value: string; sub?: string
  color?: 'green' | 'red' | 'blue' | 'amber' | 'slate'
  icon: React.ReactNode
}) {
  const colors = {
    green: 'bg-green-50 text-green-700 border-green-100',
    red:   'bg-red-50   text-red-700   border-red-100',
    blue:  'bg-blue-50  text-blue-700  border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2 opacity-70">{icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────

export default function ItemCardPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { canWrite } = usePermission()

  const itemCode    = Number(code)
  const [addOpen,   setAddOpen]   = useState(false)
  const [warehouse, setWarehouse] = useState('')

  // Item meta
  const { data: items = [] } = useQuery({
    queryKey: ['config', 'items'],
    queryFn:  configApi.items as () => Promise<Item[]>,
    staleTime: 120_000,
  })
  const item = items.find(i => i.code === itemCode)

  // Stock by warehouse
  const { data: stockData } = useQuery({
    queryKey: ['inventory', 'stock', itemCode],
    queryFn:  () => inventoryApi.itemStock(itemCode),
    enabled:  !!itemCode,
  })

  // Card movements (filtered by warehouse)
  const { data: cardRaw, isLoading: cardLoading } = useQuery({
    queryKey: ['inventory', 'card', itemCode, warehouse],
    queryFn:  () => inventoryApi.itemCard(itemCode, warehouse || undefined) as Promise<CardRow[]>,
    enabled:  !!itemCode,
  })
  const card = cardRaw ?? []

  // Warehouses for filter
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.warehouses,
    staleTime: 120_000,
  })

  // ── Computed stats ───────────────────────────────────────────

  const totalIn    = card.reduce((s, r) => s + (r.qty_in  ?? 0), 0)
  const totalOut   = card.reduce((s, r) => s + (r.qty_out ?? 0), 0)
  const totalValIn = card.reduce((s, r) => s + (r.value_in  ?? 0), 0)
  const totalValOut= card.reduce((s, r) => s + (r.value_out ?? 0), 0)
  const lastRow    = card.length > 0 ? card[card.length - 1] : null
  const avgCost    = stockData?.avg_cost ?? 0

  const byWarehouse = (stockData?.by_warehouse ?? []) as StockByWarehouse[]

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-10">

      {/* ── Breadcrumb + header ────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <nav className="flex items-center gap-1.5 text-sm text-slate-400 mb-2">
            <Link to="/inventory" className="hover:text-slate-600 transition-colors">أرصدة المخازن</Link>
            <ArrowRight size={13} />
            <span className="text-slate-700 font-medium">
              {item?.name ?? `#${itemCode}`}
            </span>
          </nav>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-brand-100 rounded-2xl flex items-center justify-center text-brand-700">
              <Package size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">
                {item?.name ?? `صنف #${itemCode}`}
              </h1>
              <p className="text-sm text-slate-400 flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Hash size={12} />كود: {itemCode}
                </span>
                {item?.unit && (
                  <span className="flex items-center gap-1">
                    <Package size={12} />الوحدة: {item.unit}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn-secondary gap-2"
            onClick={() => downloadCsv(`/inventory/item/${itemCode}/card`, `كرت_${item?.name ?? itemCode}`, warehouse ? { warehouse } : {})}
          >
            <Download size={15} /> تصدير CSV
          </button>
          {canWrite('inventory') && (
            <button className="btn-primary gap-2" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> حركة جديدة
            </button>
          )}
        </div>
      </div>

      {/* ── KPI row ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="الرصيد الكلي"
          value={`${NUM(stockData?.total_qty)} ${item?.unit ?? ''}`}
          sub={`قيمة: ${EGP(stockData?.total_value)}`}
          color={( stockData?.total_qty ?? 0) > 0 ? 'blue' : 'red'}
          icon={<Warehouse size={14} />} />
        <KPI label="متوسط سعر التكلفة"
          value={EGP(avgCost)}
          sub="per unit"
          color="amber"
          icon={<DollarSign size={14} />} />
        <KPI label="إجمالي الوارد"
          value={NUM(totalIn)}
          sub={EGP(totalValIn)}
          color="green"
          icon={<ArrowDownCircle size={14} />} />
        <KPI label="إجمالي المنصرف"
          value={NUM(totalOut)}
          sub={EGP(totalValOut)}
          color="red"
          icon={<ArrowUpCircle size={14} />} />
      </div>

      {/* ── Middle row: warehouse breakdown + trend ──────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Warehouse breakdown */}
        <div className="card p-4">
          <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Warehouse size={15} className="text-slate-400" /> التوزيع على المخازن
          </h3>
          {byWarehouse.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">لا توجد أرصدة</p>
          ) : (
            <div className="space-y-2">
              {byWarehouse.map(wh => {
                const total  = stockData?.total_qty ?? 1
                const pct    = total > 0 ? (wh.balance_qty / total) * 100 : 0
                const isLow  = item?.reorder_threshold ? wh.balance_qty <= item.reorder_threshold : false
                return (
                  <div key={wh.warehouse}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <button
                        className="font-medium text-slate-700 hover:text-brand-600 transition-colors"
                        onClick={() => setWarehouse(wh.warehouse === warehouse ? '' : wh.warehouse)}>
                        {wh.warehouse}
                        {warehouse === wh.warehouse && <span className="text-xs mr-1 text-brand-600">(محدد)</span>}
                      </button>
                      <div className="flex items-center gap-2">
                        {isLow && <span className="text-xs text-red-500 font-medium">⚠ منخفض</span>}
                        <span className={`font-bold ${wh.balance_qty > 0 ? 'text-slate-700' : 'text-slate-400'}`}>
                          {NUM(wh.balance_qty)}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isLow ? 'bg-red-400' : 'bg-brand-500'}`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{EGP(wh.balance_value)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Mini chart – last 12 movements */}
        <div className="card p-4 lg:col-span-2">
          <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <BarChart3 size={15} className="text-slate-400" /> آخر 12 حركة — رصيد الكمية
          </h3>
          {card.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">لا توجد حركات</p>
          ) : (
            <div className="flex items-end gap-1 h-32 bg-slate-50/50 rounded-lg p-2 border border-dashed border-slate-200">
              {card.slice(-15).map((row, i) => {
                const maxBal = Math.max(...card.slice(-15).map(r => Math.abs(r.balance_qty ?? 0)), 1)
                const h      = Math.max(((row.balance_qty ?? 0) / maxBal) * 100, 4)
                const isAdd  = row.movement_type === 'اضافة'
                return (
                  <div key={i} className="flex-1 flex flex-col items-center group relative h-full justify-end"
                    title={`${DATE_AR(row.movement_date)} — ${row.movement_type}: ${NUM(row.quantity)}\nالرصيد: ${NUM(row.balance_qty)}`}>
                    <div
                      className={`w-full max-w-[12px] rounded-t-[2px] transition-all ${isAdd ? 'bg-green-500 group-hover:bg-green-600' : 'bg-red-400 group-hover:bg-red-500'}`}
                      style={{ height: `${h}%` }}
                    />
                    <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none">
                      {NUM(row.balance_qty)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {lastRow && (
            <p className="text-xs text-slate-400 mt-3 text-center">
              آخر حركة: {DATE_AR(lastRow.movement_date)} ·
              الرصيد الحالي: <span className="font-semibold text-slate-600">{NUM(stockData?.total_qty)} {item?.unit ?? ''}</span>
            </p>
          )}
        </div>
      </div>

      {/* ── Warehouse filter bar ──────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setWarehouse('')}
          className={`btn text-sm ${!warehouse ? 'btn-primary' : 'btn-secondary'}`}>
          كل المخازن
        </button>
        {warehouses.map(wh => (
          <button key={wh}
            onClick={() => setWarehouse(wh === warehouse ? '' : wh)}
            className={`btn text-sm ${warehouse === wh ? 'btn-primary' : 'btn-secondary'}`}>
            {wh}
          </button>
        ))}
      </div>

      {/* ── Movements table ───────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2">
            <Calendar size={15} className="text-slate-400" />
            كرت الصنف
            {warehouse && <span className="text-sm font-normal text-brand-600">— {warehouse}</span>}
          </h3>
          <span className="text-xs text-slate-400">{card.length} حركة</span>
        </div>

        {cardLoading ? (
          <div className="p-16 text-center text-slate-400">
            <Package size={36} className="mx-auto mb-3 opacity-30 animate-pulse" />
            جاري التحميل...
          </div>
        ) : card.length === 0 ? (
          <div className="p-16 text-center text-slate-400">
            <Package size={36} className="mx-auto mb-3 opacity-20" />
            لا توجد حركات مسجلة
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['التاريخ','المخزن','النوع','الكمية','الوحدة','سعر الوحدة','وارد','منصرف','رصيد الكمية','رصيد القيمة','مستند','ملاحظات'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {card.map((row, i) => {
                  const isAdd  = row.movement_type === 'اضافة'
                  const isLast = i === card.length - 1
                  return (
                    <tr key={i} className={`hover:bg-slate-50 transition-colors ${isLast ? 'bg-brand-50/40 font-medium' : ''}`}>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{DATE_AR(row.movement_date)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{row.warehouse}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
                          ${isAdd ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {isAdd
                            ? <><ArrowDownCircle size={11} /> وارد</>
                            : <><ArrowUpCircle   size={11} /> منصرف</>
                          }
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-800 text-center">{NUM(row.quantity)}</td>
                      <td className="px-3 py-2.5 text-slate-500 text-center">{item?.unit ?? '—'}</td>
                      <td className="px-3 py-2.5 text-slate-500 text-center">{row.unit_price ? EGP(row.unit_price) : '—'}</td>
                      <td className="px-3 py-2.5 text-green-700 font-medium text-center">
                        {row.qty_in  > 0 ? NUM(row.qty_in)  : ''}
                      </td>
                      <td className="px-3 py-2.5 text-red-600 font-medium text-center">
                        {row.qty_out > 0 ? NUM(row.qty_out) : ''}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-bold ${(row.balance_qty ?? 0) > 0 ? 'text-slate-800' : 'text-slate-400'}`}>
                          {NUM(row.balance_qty)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-brand-700 text-center">{EGP(row.balance_value)}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-center">{row.document_number ?? '—'}</td>
                      <td className="px-3 py-2.5 text-slate-500 max-w-32 truncate">{row.notes ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Summary footer */}
              <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-sm">
                <tr>
                  <td colSpan={6} className="px-3 py-2.5 text-slate-600">
                    الإجمالي ({card.length} حركة)
                    {warehouse && ` — ${warehouse}`}
                  </td>
                  <td className="px-3 py-2.5 text-green-700 text-center">{NUM(totalIn)}</td>
                  <td className="px-3 py-2.5 text-red-600  text-center">{NUM(totalOut)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={(stockData?.total_qty ?? 0) > 0 ? 'text-brand-700' : 'text-slate-400'}>
                      {NUM(stockData?.total_qty)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-brand-700 text-center">{EGP(stockData?.total_value)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Back to inventory */}
      <button
        onClick={() => navigate('/inventory')}
        className="btn-secondary gap-2 text-sm">
        <ArrowRight size={14} /> العودة إلى أرصدة المخازن
      </button>

      <AddInventoryBatchModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultWarehouse={warehouse || undefined}
      />
    </div>
  )
}
