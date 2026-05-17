export interface ReconciliationSignal {
  type: 
    | 'ap_drift' 
    | 'inventory_gl_drift' 
    | 'null_journal_entry' 
    | 'orphan_business_event' 
    | 'stale_outbox_job' 
    | 'missing_balance_sync';
  severity: 'high' | 'medium' | 'low';
  message: string;
  metadata: Record<string, any>;
  timestamp: string;
}

export const detectApDrift = (apBalance: number, glBalance: number): ReconciliationSignal | null => {
  if (Math.abs(apBalance - glBalance) > 0.01) {
    return {
      type: 'ap_drift',
      severity: 'high',
      message: `AP subledger balance (${apBalance}) does not match GL balance (${glBalance})`,
      metadata: { apBalance, glBalance, diff: Math.abs(apBalance - glBalance) },
      timestamp: new Date().toISOString()
    };
  }
  return null;
};

export const detectInventoryGlDrift = (inventoryValue: number, glValue: number): ReconciliationSignal | null => {
  if (Math.abs(inventoryValue - glValue) > 0.01) {
    return {
      type: 'inventory_gl_drift',
      severity: 'high',
      message: `Inventory Valuation (${inventoryValue}) drifts from GL Inventory Account (${glValue})`,
      metadata: { inventoryValue, glValue, diff: Math.abs(inventoryValue - glValue) },
      timestamp: new Date().toISOString()
    };
  }
  return null;
};

export const detectNullJournalEntry = (movementStatus: string, journalEntryId: number | null): ReconciliationSignal | null => {
  if (movementStatus === 'posted' && !journalEntryId) {
    return {
      type: 'null_journal_entry',
      severity: 'high',
      message: 'Movement is marked as posted but has no associated journal_entry_id',
      metadata: { movementStatus, journalEntryId },
      timestamp: new Date().toISOString()
    };
  }
  return null;
};

export const detectStaleOutboxJob = (jobStatus: string, jobCreatedAt: string): ReconciliationSignal | null => {
  const jobDate = new Date(jobCreatedAt).getTime();
  const now = Date.now();
  // 30 minutes threshold
  if ((jobStatus === 'pending' || jobStatus === 'processing') && (now - jobDate > 1800000)) {
    return {
      type: 'stale_outbox_job',
      severity: 'medium',
      message: `Outbox job is stale (created at ${jobCreatedAt} but still ${jobStatus})`,
      metadata: { jobStatus, jobCreatedAt, staleDurationMs: now - jobDate },
      timestamp: new Date().toISOString()
    };
  }
  return null;
};
