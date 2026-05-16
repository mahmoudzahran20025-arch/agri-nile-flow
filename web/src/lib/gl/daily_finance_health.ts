import { 
  detectApDrift, 
  detectInventoryGlDrift, 
  detectNullJournalEntry, 
  detectStaleOutboxJob,
  type ReconciliationSignal
} from './financialSignals';

export interface DailyFinanceHealthReport {
  timestamp: string;
  isHealthy: boolean;
  totalSignals: number;
  criticalSignals: number;
  signals: ReconciliationSignal[];
}

/**
 * Executes a daily suite of deterministic checks across the financial boundary.
 * In a real environment, this would pull bulk snapshots from the database.
 */
export function generateDailyFinanceHealth(
  dbSnapshot: any // Placeholder for actual DB records
): DailyFinanceHealthReport {
  const signals: ReconciliationSignal[] = [];

  // Mocking iteration over DB snapshot
  const movements = dbSnapshot.movements || [];
  const outboxJobs = dbSnapshot.outboxJobs || [];
  const apBalance = dbSnapshot.apBalance || 0;
  const glApBalance = dbSnapshot.glApBalance || 0;
  const invValuation = dbSnapshot.invValuation || 0;
  const glInvBalance = dbSnapshot.glInvBalance || 0;

  // 1. AP Drift
  const apSignal = detectApDrift(apBalance, glApBalance);
  if (apSignal) signals.push(apSignal);

  // 2. Inventory vs GL Drift
  const invSignal = detectInventoryGlDrift(invValuation, glInvBalance);
  if (invSignal) signals.push(invSignal);

  // 3. Null JE & Orphan detection
  movements.forEach((m: any) => {
    const nullJeSignal = detectNullJournalEntry(m.status, m.journal_entry_id);
    if (nullJeSignal) signals.push(nullJeSignal);
  });

  // 4. Stale Posting / Outbox mismatch detection
  outboxJobs.forEach((job: any) => {
    const staleSignal = detectStaleOutboxJob(job.status, job.created_at);
    if (staleSignal) signals.push(staleSignal);
  });

  const criticalSignals = signals.filter(s => s.severity === 'high').length;

  return {
    timestamp: new Date().toISOString(),
    isHealthy: criticalSignals === 0,
    totalSignals: signals.length,
    criticalSignals,
    signals,
  };
}
