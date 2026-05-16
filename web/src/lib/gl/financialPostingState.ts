export type CanonicalPostingState = 
  | 'draft' 
  | 'queued' 
  | 'processing' 
  | 'posted' 
  | 'partial' 
  | 'failed' 
  | 'orphaned' 
  | 'reconciliation_required';

export interface FinancialPostingState {
  status: CanonicalPostingState;
  journalEntryId?: number | null;
  outboxJobId?: string | null;
  businessEventId?: string | null;
  errorReason?: string | null;
  lastUpdated: string;
}

export const isTerminalState = (state: CanonicalPostingState): boolean => {
  return state === 'posted' || state === 'failed' || state === 'orphaned';
};

export const requiresReconciliation = (state: CanonicalPostingState): boolean => {
  return state === 'reconciliation_required' || state === 'partial' || state === 'orphaned';
};
