import type { CanonicalPostingState, FinancialPostingState } from './financialPostingState';

export interface PostingStateInputs {
  movementStatus: string;
  movementJournalEntryId: number | null;
  outboxStatus?: 'pending' | 'processing' | 'done' | 'failed' | null;
  businessEventStatus?: 'pending' | 'processed' | 'failed' | null;
  journalEntryExists: boolean;
  hasLineVariance?: boolean; // E.g., not all lines were posted
}

/**
 * Resolves the deterministic financial posting state by evaluating multiple
 * potential failure domains across the async pipeline.
 */
export function resolveFinancialPostingState(inputs: PostingStateInputs): FinancialPostingState {
  const {
    movementStatus,
    movementJournalEntryId,
    outboxStatus,
    businessEventStatus,
    journalEntryExists,
    hasLineVariance
  } = inputs;

  let status: CanonicalPostingState = 'draft';
  let errorReason: string | null = null;

  // Rule 1: Orphaned Detection (Movement posted, but no JE mapped or missing from DB)
  if (movementStatus === 'posted' && (!movementJournalEntryId || !journalEntryExists)) {
    status = 'orphaned';
    errorReason = 'Movement marked posted but Journal Entry is missing or NULL';
  }
  // Rule 2: Reconciliation Required (State mismatch between Outbox and Movement)
  else if (outboxStatus === 'done' && movementStatus !== 'posted') {
    status = 'reconciliation_required';
    errorReason = 'Outbox job completed but movement remains unposted';
  }
  // Rule 3: Business Event failures
  else if (businessEventStatus === 'failed') {
    status = 'failed';
    errorReason = 'Business Event execution failed in the background';
  }
  // Rule 4: Outbox failures
  else if (outboxStatus === 'failed') {
    status = 'failed';
    errorReason = 'Outbox processor failed to execute the posting job';
  }
  // Rule 5: Partial Posting (Usually line mismatches)
  else if (movementStatus === 'posted' && hasLineVariance) {
    status = 'partial';
    errorReason = 'Movement posted but line value variance detected';
  }
  // Rule 6: Happy Path Posted
  else if (movementStatus === 'posted' && movementJournalEntryId && journalEntryExists) {
    status = 'posted';
  }
  // Rule 7: In-Flight Processing
  else if (outboxStatus === 'processing' || businessEventStatus === 'pending') {
    status = 'processing';
  }
  // Rule 8: Queued for async
  else if (outboxStatus === 'pending') {
    status = 'queued';
  }
  // Rule 9: Draft
  else {
    status = 'draft';
  }

  return {
    status,
    journalEntryId: movementJournalEntryId,
    outboxJobId: null, // Would be provided by real input
    businessEventId: null, // Would be provided by real input
    errorReason,
    lastUpdated: new Date().toISOString()
  };
}
