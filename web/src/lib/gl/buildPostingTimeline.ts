export interface TimelineEvent {
  id: string;
  timestamp: string;
  stage: 
    | 'workspace_created' 
    | 'queued' 
    | 'outbox_processing' 
    | 'je_posted' 
    | 'reconciliation_verified' 
    | 'failure' 
    | 'retry';
  description: string;
  metadata?: Record<string, any>;
  isError: boolean;
}

export interface PostingTimelineInput {
  movementCreatedAt: string;
  outboxCreatedAt?: string;
  outboxProcessedAt?: string;
  outboxStatus?: string;
  journalEntryId?: number | null;
  journalEntryCreatedAt?: string;
  reconciliationStatus?: string;
  reconciliationCheckedAt?: string;
  errorLog?: Array<{ timestamp: string, message: string }>;
  retryLog?: Array<{ timestamp: string, attempt: number }>;
}

/**
 * Reconstructs the exact chronological audit timeline of a movement's 
 * lifecycle from Workspace creation through GL Posting and Reconciliation.
 */
export function buildPostingTimeline(input: PostingTimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // 1. Workspace Created
  events.push({
    id: `ws_create_${input.movementCreatedAt}`,
    timestamp: input.movementCreatedAt,
    stage: 'workspace_created',
    description: 'Movement draft submitted by Workspace Orchestrator',
    isError: false,
  });

  // 2. Queued in Outbox
  if (input.outboxCreatedAt) {
    events.push({
      id: `q_${input.outboxCreatedAt}`,
      timestamp: input.outboxCreatedAt,
      stage: 'queued',
      description: 'Payload serialized and queued in Outbox',
      isError: false,
    });
  }

  // 3. Outbox Processing
  if (input.outboxProcessedAt && input.outboxStatus !== 'pending') {
    events.push({
      id: `proc_${input.outboxProcessedAt}`,
      timestamp: input.outboxProcessedAt,
      stage: 'outbox_processing',
      description: `Outbox processor completed with status: ${input.outboxStatus}`,
      isError: input.outboxStatus === 'failed',
    });
  }

  // 4. JE Posted
  if (input.journalEntryId && input.journalEntryCreatedAt) {
    events.push({
      id: `je_${input.journalEntryId}`,
      timestamp: input.journalEntryCreatedAt,
      stage: 'je_posted',
      description: `Journal Entry #${input.journalEntryId} successfully posted to General Ledger`,
      metadata: { journalEntryId: input.journalEntryId },
      isError: false,
    });
  }

  // 5. Failures
  if (input.errorLog) {
    input.errorLog.forEach((err, idx) => {
      events.push({
        id: `err_${idx}_${err.timestamp}`,
        timestamp: err.timestamp,
        stage: 'failure',
        description: `Posting failure: ${err.message}`,
        isError: true,
      });
    });
  }

  // 6. Retries
  if (input.retryLog) {
    input.retryLog.forEach((retry, idx) => {
      events.push({
        id: `rt_${idx}_${retry.timestamp}`,
        timestamp: retry.timestamp,
        stage: 'retry',
        description: `Retry attempt #${retry.attempt} initiated`,
        isError: false,
      });
    });
  }

  // 7. Reconciliation
  if (input.reconciliationCheckedAt) {
    const isOk = input.reconciliationStatus === 'ok';
    events.push({
      id: `recon_${input.reconciliationCheckedAt}`,
      timestamp: input.reconciliationCheckedAt,
      stage: 'reconciliation_verified',
      description: isOk ? 'Reconciliation passed' : 'Reconciliation variance detected',
      isError: !isOk,
    });
  }

  // Sort chronologically
  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
