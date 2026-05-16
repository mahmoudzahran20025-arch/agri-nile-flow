import { useQuery } from '@tanstack/react-query';
import { resolveFinancialPostingState, type PostingStateInputs } from '../../lib/gl/resolveFinancialPostingState';
import type { FinancialPostingState } from '../../lib/gl/financialPostingState';
import { inventoryApi } from '../../api/client';

export interface UseFinancialVisibilityProps {
  movementId: number | null;
  sourceModule?: string;
  companyId?: string;
}

export interface FinancialVisibilityResult {
  financialState: FinancialPostingState | null;
  journalEntryId: number | null;
  outboxStatus: string | null;
  reconciliationStatus: string | null;
  lastError: string | null;
  requiresAttention: boolean;
  isLoading: boolean;
}

// In a real implementation, we would query an endpoint that gathers outbox, business event, and movement statuses.
// For now, we mock the retrieval of the PostingStateInputs using existing movement data.
export function useFinancialVisibility({ movementId, sourceModule = 'inventory', companyId }: UseFinancialVisibilityProps): FinancialVisibilityResult {
  
  // Here we use a hypothetical endpoint that gives us the aggregated posting state.
  // We'll map this to `inventoryApi.transactions` for now to check status, but ideally
  // an endpoint like `/finance/posting-state/:id` should exist.
  const { data, isLoading } = useQuery({
    queryKey: ['financial-visibility', sourceModule, movementId],
    queryFn: async () => {
      if (!movementId) return null;
      // Mocking the inputs for the resolver by fetching the movement.
      // In reality, this would fetch from a specialized timeline endpoint.
      const res = await inventoryApi.transactions({ start: '2000-01-01', end: '2099-12-31' }); // This is highly simplified
      const movement = (res as any)?.data?.find((m: any) => m.id === movementId);
      
      if (!movement) return null;

      const inputs: PostingStateInputs = {
        movementStatus: movement?.status || 'draft',
        movementJournalEntryId: movement?.document_number || null, // using document_number as placeholder for JE
        outboxStatus: movement?.status === 'posted' ? 'done' : 'pending',
        businessEventStatus: 'processed',
        journalEntryExists: !!movement?.document_number,
        hasLineVariance: false
      };

      return resolveFinancialPostingState(inputs);
    },
    enabled: !!movementId,
    refetchInterval: (data) => {
      // Poll if we are in a processing state
      return data && (data.status === 'queued' || data.status === 'processing') ? 2000 : false;
    }
  });

  const financialState = data ?? null;

  return {
    financialState,
    journalEntryId: financialState?.journalEntryId ?? null,
    outboxStatus: financialState?.outboxJobId ? 'done' : null,
    reconciliationStatus: financialState?.status === 'reconciliation_required' ? 'failed' : 'ok',
    lastError: financialState?.errorReason ?? null,
    requiresAttention: financialState ? (
      financialState.status === 'failed' || 
      financialState.status === 'orphaned' || 
      financialState.status === 'reconciliation_required' ||
      financialState.status === 'partial'
    ) : false,
    isLoading
  };
}
