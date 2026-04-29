import { useQuery } from '@tanstack/react-query'
import { glApi } from '../api/client'

export function useGlSystemIntegrityScore() {
  return useQuery({
    queryKey: ['gl-system-integrity-score'],
    queryFn: () => glApi.systemIntegrityScore(),
    refetchInterval: 60_000,
  })
}

export function useGlIntegrityIssues(detailed = false) {
  return useQuery({
    queryKey: ['gl-integrity-issues', detailed],
    queryFn: () => glApi.integrityCheckV2(detailed),
    refetchInterval: 60_000,
  })
}

export function useGlBatchPostingJobs(params?: {
  page?: number
  size?: number
  status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
}) {
  return useQuery({
    queryKey: ['gl-batch-post-jobs', params?.page ?? 1, params?.size ?? 10, params?.status ?? 'all'],
    queryFn: () => glApi.batchPostJobs(params),
    refetchInterval: 30_000,
  })
}

export function useGlAuditLog(params?: {
  page?: number
  size?: number
  table?: string
  action?: string
  from?: string
  to?: string
}) {
  return useQuery({
    queryKey: [
      'gl-audit-log',
      params?.page ?? 1,
      params?.size ?? 25,
      params?.table ?? '',
      params?.action ?? '',
      params?.from ?? '',
      params?.to ?? '',
    ],
    queryFn: () => glApi.auditLog(params),
  })
}
