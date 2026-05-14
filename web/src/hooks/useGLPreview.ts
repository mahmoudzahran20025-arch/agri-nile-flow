import { useState, useEffect, useRef } from 'react'
import { glApi, type GlPreviewRequest, type GlPreviewResult } from '../api/gl'

const DEBOUNCE_MS = 600

interface UseGLPreviewState {
  data:    GlPreviewResult | null
  loading: boolean
  error:   string | null
}

/**
 * Debounced hook that calls POST /api/gl/preview whenever the request payload changes.
 * Returns null when amount <= 0 or event_type is missing.
 */
export function useGLPreview(req: Partial<GlPreviewRequest> | null): UseGLPreviewState {
  const [state, setState] = useState<UseGLPreviewState>({ data: null, loading: false, error: null })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!req || !req.event_type || !req.amount || req.amount <= 0) {
      setState({ data: null, loading: false, error: null })
      return
    }

    setState(prev => ({ ...prev, loading: true, error: null }))

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      try {
        const result = await glApi.preview(req as GlPreviewRequest)
        setState({ data: result, loading: false, error: null })
      } catch (err) {
        setState({ data: null, loading: false, error: (err as Error).message ?? 'خطأ في معاينة القيد' })
      }
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [
    req?.event_type,
    req?.amount,
    req?.description,
    req?.season_id,
    req?.center_code,
    req?.field_id,
    req?.debit_account,
    req?.credit_account,
  ])

  return state
}
