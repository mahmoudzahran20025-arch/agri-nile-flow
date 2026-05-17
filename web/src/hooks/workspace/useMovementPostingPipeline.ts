import { useState, useCallback } from 'react'
import { inventoryApi } from '../../api/client'
import type { MovementDraft, DraftStatus } from '../../components/workspace/types'
import { isTransferType } from '../../components/workspace/types'
import { validateDraftForSubmission } from '../../components/workspace/validateDraftForSubmission'
import { workspaceEvents } from './workspaceEvents'

export interface PostingResult {
  success: boolean
  error?: Error | string
  data?: any
}

interface PostingPipelineHook {
  post: (draft: MovementDraft, setDraftStatus: (status: DraftStatus) => void) => Promise<PostingResult>
  isPosting: boolean
  lastError: Error | string | null
}

export function useMovementPostingPipeline(): PostingPipelineHook {
  const [isPosting, setIsPosting] = useState(false)
  const [lastError, setLastError] = useState<Error | string | null>(null)

  const post = useCallback(async (draft: MovementDraft, setDraftStatus: (status: DraftStatus) => void): Promise<PostingResult> => {
    if (isPosting) return { success: false, error: 'Posting already in progress' }

    // 1. Validation Lock
    setIsPosting(true)
    setLastError(null)
    setDraftStatus('posting')
    workspaceEvents.emit({ type: 'POSTING_START', draftId: draft.id } as any)

    try {
      // 2. Pre-flight validation
      const preflight = validateDraftForSubmission(draft)
      if (!preflight.valid) {
        throw new Error(preflight.errors[0]?.message ?? 'بيانات المسودة غير مكتملة')
      }

      // 3. Canonical Payload + routing
      const validLines = draft.lines.filter(l => l.item_code !== null && (l.quantity ?? 0) > 0)
      const isTransfer = isTransferType(draft.header.movement_type)

      let res: any

      if (isTransfer) {
        // Transfer batch: creates paired TRANSFER_OUT + TRANSFER_IN atomically
        if (!draft.header.target_warehouse_id) {
          throw new Error('مخزن الوجهة مطلوب في حركات التحويل')
        }
        const transferPayload = {
          movement_date: draft.header.movement_date,
          from_warehouse: draft.header.movement_type === 'TRANSFER_OUT'
            ? String(draft.header.warehouse_id)
            : String(draft.header.target_warehouse_id),
          to_warehouse: draft.header.movement_type === 'TRANSFER_OUT'
            ? String(draft.header.target_warehouse_id)
            : String(draft.header.warehouse_id),
          season_id:   draft.dimensions.season_id ?? undefined,
          center_code: draft.dimensions.center_code ?? undefined,
          notes:       draft.header.notes,
          items: validLines.map(l => ({
            item_code: l.item_code!,
            quantity:  l.quantity!,
          })),
        }
        res = await inventoryApi.transferBatch(transferPayload)
      } else {
        const payload: Parameters<typeof inventoryApi.createBatch>[0] = {
          movement_date:      draft.header.movement_date,
          warehouse:          String(draft.header.warehouse_id),
          movement_type:      draft.header.movement_type,
          supplier_code:      draft.header.supplier_code ?? undefined,
          document_number:    draft.header.document_number ? Number(draft.header.document_number) : undefined,
          season_id:          draft.dimensions.season_id ?? undefined,
          field_id:           draft.dimensions.field_id ?? undefined,
          work_order_id:      draft.dimensions.work_order_id ?? undefined,
          notes:              draft.header.notes,
          payment_method:     draft.header.payment_method,
          center_code:        draft.dimensions.center_code ?? undefined,
          service_type_code:  draft.dimensions.service_type_code || undefined,
          statement_text:     draft.dimensions.statement_text || undefined,
          items: validLines.map(l => ({
            item_code:     l.item_code!,
            quantity:      l.quantity!,
            unit_price:    l.unit_price ?? undefined,
            notes:         l.notes || undefined,
            pack_count:    l.pack_count ?? undefined,
            pack_capacity: l.package_capacity ?? undefined,
          }))
        }
        res = await inventoryApi.createBatch(payload)
      }

      // 4. Network Dispatch result check
      if (!res || res.error || (res.success === false)) {
        throw new Error(res?.error || 'Unknown server error during posting')
      }

      // 5. Reconciliation
      setDraftStatus('posted')
      workspaceEvents.emit({ type: 'POSTING_SUCCESS', draftId: draft.id } as any)
      return { success: true, data: res }

    } catch (error) {
      console.error('Posting pipeline error:', error)
      const errorMsg = error instanceof Error ? error.message : String(error)
      setLastError(errorMsg)
      setDraftStatus('failed')
      workspaceEvents.emit({ type: 'POSTING_ERROR', draftId: draft.id, error: errorMsg } as any)
      return { success: false, error: errorMsg }
      
    } finally {
      setIsPosting(false)
    }
  }, [isPosting])

  return { post, isPosting, lastError }
}
