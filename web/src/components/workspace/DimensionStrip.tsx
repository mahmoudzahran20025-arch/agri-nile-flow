import { useQuery } from '@tanstack/react-query'
import { configApi, fieldsApi, operationsApi, inventoryApi } from '../../api/client'
import { cropCyclesApi } from '../../api/crop-cycles'
import type { MovementDimensions, MovementType } from './types'

// ─── Reference data types ────────────────────────────────────────────────────

type SeasonOption      = { id: number; name: string; status: string }
type CostCenterOption  = { code: number; name: string }
type FieldOption       = { id: number; name: string }
type WorkOrderOption   = { id: number; name: string; field_id?: number; season_id?: number; center_code?: number; crop_cycle_id?: number | null }
type ServiceTypeOption = { code: string; name_ar: string; service_group: string }
type CropCycleOption   = { id: number; crop_name: string; field_name: string; status: string }

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  dimensions:   MovementDimensions
  movementType: MovementType
  onChange:     (patch: Partial<MovementDimensions>) => void
}

export default function DimensionStrip({ dimensions, movementType, onChange }: Props) {
  const isIssue = movementType === 'ISSUE'

  // ── Reference data queries (lightweight GETs, already trivial) ──────────

  const { data: seasons = [] } = useQuery({
    queryKey: ['config', 'seasons'],
    queryFn:  () => configApi.seasons() as Promise<SeasonOption[]>,
    staleTime: 300_000,
    select: (res: unknown) => {
      const arr = (res as { data?: SeasonOption[] })?.data ?? (res as SeasonOption[])
      return (Array.isArray(arr) ? arr : []).filter(
        (s: SeasonOption) => s.status !== 'closed' && s.status !== 'cancelled'
      )
    },
  })

  const { data: costCenters = [] } = useQuery({
    queryKey: ['config', 'cc'],
    queryFn:  () => configApi.costCenters() as Promise<CostCenterOption[]>,
    staleTime: 300_000,
  })

  const { data: fields = [] } = useQuery({
    queryKey: ['fields'],
    queryFn:  () => fieldsApi.list() as Promise<FieldOption[]>,
    staleTime: 300_000,
  })

  const { data: workOrders = [] } = useQuery({
    queryKey: ['inventory-work-orders'],
    queryFn:  () => operationsApi.listOrders({ size: 100 }) as unknown as Promise<{ data: WorkOrderOption[] }>,
    staleTime: 120_000,
    select: (res: unknown) => ((res as { data?: WorkOrderOption[] })?.data ?? res) as WorkOrderOption[],
  })

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['inventory-service-types'],
    queryFn:  () => inventoryApi.serviceTypes() as Promise<ServiceTypeOption[]>,
    staleTime: 300_000,
  })

  // Only load active crop cycles (for ISSUE movements where WIP accumulation is relevant)
  const { data: cropCycles = [] } = useQuery({
    queryKey: ['crop-cycles', 'active', dimensions.field_id, dimensions.season_id],
    queryFn:  () => cropCyclesApi.list({
      status:    'active',
      field_id:  dimensions.field_id  ?? undefined,
      season_id: dimensions.season_id ?? undefined,
    }) as Promise<CropCycleOption[]>,
    staleTime: 120_000,
    enabled: isIssue,
  })

  // ── Work order change — prepare for future autofill ─────────────────────

  function handleWorkOrderChange(woId: string) {
    if (!woId) {
      onChange({ work_order_id: null })
      return
    }
    const wo = (workOrders as WorkOrderOption[]).find(w => String(w.id) === woId)
    const patch: Partial<MovementDimensions> = { work_order_id: Number(woId) }

    // Autofill season, center, field, crop_cycle from work order
    if (wo?.season_id)    patch.season_id    = wo.season_id
    if (wo?.center_code)  patch.center_code  = wo.center_code
    if (wo?.field_id)     patch.field_id     = wo.field_id
    if (wo?.crop_cycle_id != null) patch.crop_cycle_id = wo.crop_cycle_id

    onChange(patch)
  }

  // ── Derived state ──────────────────────────────────────────────────────

  const woSelected = !!dimensions.work_order_id
  const reqBadge   = <span className="text-red-500 mr-0.5">*</span>

  return (
    <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 shrink-0">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 items-end">

        {/* Season */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            الموسم {isIssue && reqBadge}
          </label>
          <select
            className={`input text-sm w-full ${isIssue && !dimensions.season_id ? 'border-amber-400' : ''}`}
            value={dimensions.season_id ?? ''}
            onChange={e => onChange({ season_id: e.target.value ? Number(e.target.value) : null })}
            disabled={woSelected && !!dimensions.season_id}
          >
            <option value="">— الموسم —</option>
            {seasons.map((s: SeasonOption) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Cost Center */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            مركز التكلفة {isIssue && reqBadge}
          </label>
          <select
            className={`input text-sm w-full ${isIssue && !dimensions.center_code ? 'border-amber-400' : ''}`}
            value={dimensions.center_code ?? ''}
            onChange={e => onChange({ center_code: e.target.value ? Number(e.target.value) : null })}
            disabled={woSelected && !!dimensions.center_code}
          >
            <option value="">— المركز —</option>
            {(costCenters as CostCenterOption[]).map(cc => (
              <option key={cc.code} value={cc.code}>{cc.code} — {cc.name}</option>
            ))}
          </select>
        </div>

        {/* Field */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            الحقل
          </label>
          <select
            className="input text-sm w-full"
            value={dimensions.field_id ?? ''}
            onChange={e => onChange({ field_id: e.target.value ? Number(e.target.value) : null })}
            disabled={woSelected && !!dimensions.field_id}
          >
            <option value="">— بدون حقل —</option>
            {(fields as FieldOption[]).map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

        {/* Work Order */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            أمر العمل
          </label>
          <select
            className="input text-sm w-full"
            value={dimensions.work_order_id ?? ''}
            onChange={e => handleWorkOrderChange(e.target.value)}
          >
            <option value="">— بدون أمر عمل —</option>
            {(workOrders as WorkOrderOption[]).map(wo => (
              <option key={wo.id} value={wo.id}>{wo.name}</option>
            ))}
          </select>
        </div>

        {/* Crop Cycle — only meaningful for ISSUE movements */}
        {isIssue && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              دورة المحصول
            </label>
            <select
              className="input text-sm w-full"
              value={dimensions.crop_cycle_id ?? ''}
              onChange={e => onChange({ crop_cycle_id: e.target.value ? Number(e.target.value) : null })}
              disabled={woSelected && dimensions.crop_cycle_id != null}
            >
              <option value="">— بدون دورة —</option>
              {(cropCycles as CropCycleOption[]).map(cc => (
                <option key={cc.id} value={cc.id}>
                  {cc.crop_name} ({cc.field_name})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Service Type */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            نوع الخدمة {isIssue && reqBadge}
          </label>
          <select
            className={`input text-sm w-full ${isIssue && !dimensions.service_type_code ? 'border-amber-400' : ''}`}
            value={dimensions.service_type_code}
            onChange={e => onChange({ service_type_code: e.target.value })}
          >
            <option value="">— نوع الخدمة —</option>
            {(serviceTypes as ServiceTypeOption[]).map(s => (
              <option key={s.code} value={s.code}>{s.name_ar} ({s.code})</option>
            ))}
          </select>
        </div>

        {/* Statement text */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">
            البيان {isIssue && reqBadge}
          </label>
          <input
            type="text"
            className={`input text-sm w-full ${isIssue && !dimensions.statement_text.trim() ? 'border-amber-400' : ''}`}
            placeholder="وصف الصرف"
            value={dimensions.statement_text}
            onChange={e => onChange({ statement_text: e.target.value })}
          />
        </div>
      </div>

      {/* Auto-fill hint */}
      {woSelected && (
        <p className="text-[10px] text-slate-400 mt-2 px-1">
          ← تم تعيين الأبعاد تلقائياً من أمر العمل. لتغييرها يدوياً، أزل أمر العمل أولاً.
        </p>
      )}
    </div>
  )
}
