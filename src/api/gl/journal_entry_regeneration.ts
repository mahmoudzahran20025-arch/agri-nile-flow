/**
 * Journal Entry Regeneration Engine
 * =====================================================
 * Purpose: Rebuild journal entries from business_events
 * with full deterministic trace metadata
 * 
 * Pattern: Idempotent by (company_id, source_record_id, posting_rule_id)
 * Status: Phase 2 implementation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../db';

const journalEntryEngine = new Hono();

// =====================================================================
// SECTION 1: Type Definitions
// =====================================================================

interface BusinessEvent {
  id: number;
  company_id: number;
  ref_type: 'inventory_movement' | 'cash_transaction' | 'supplier_transaction';
  ref_id: number;
  event_date: string;
  amount: number;
  dimension_data: {
    center_code?: number;
    season_id?: number;
    field_id?: number;
  };
}

interface PostingRule {
  id: string;
  company_id: number;
  rule_type: string;
  posting_slots: PostingSlot[];
}

interface PostingSlot {
  slot_name: string;
  account_code: string;
  debit_credit: 'debit' | 'credit';
  dimension_mapping: string[]; // Which dimensions apply
}

interface JournalEntryToCreate {
  company_id: number;
  period_id?: number;
  entry_date: string;
  description: string;
  ref_type: string;
  ref_id: number;
  is_posted: number;
  created_by: number;
  posting_rule_trace: string;
  business_event_id: string;
  business_event_type: string;
  posting_rule_id: string;
  generated_by: string;
}

interface JournalEntryLineToCreate {
  entry_id: number;
  company_id: number;
  account_code: string;
  debit: number;
  credit: number;
  description: string;
  center_code?: number;
  season_id?: number;
  field_id?: number;
  rule_slot: string;
  source_ledger: string;
  source_record_id: number;
  currency_code: string;
  amount_in_base_currency?: number;
  business_event_id: string;
  posting_rule_id: string;
  source_module: string;
  rule_classification: 'debit' | 'credit' | 'balancing' | 'settlement';
  generated_at: string;
}

interface TraceLogEntry {
  id: string;
  company_id: number;
  business_event_type: string;
  source_record_id: number;
  source_module: string;
  source_timestamp: string;
  journal_entry_id: number;
  posting_rule_id: string;
  posting_rule_slot: string;
  posting_timestamp: string;
  generated_by: string;
  is_traced: number;
  classification: string;
}

// =====================================================================
// SECTION 2: Core JE Regeneration Logic
// =====================================================================

/**
 * Regenerate all journal entries from business events
 * Scope: 'full' | 'by_source' | 'by_period' | 'by_rule'
 */
journalEntryEngine.post('/rebuild', async (c: Context) => {
  try {
    const { scope, scope_value, company_id, dry_run } = c.req.query();
    const cid = company_id ? parseInt(company_id) : 1;
    const isDryRun = dry_run === 'true';

    let results = {
      scope,
      scope_value,
      company_id: cid,
      dry_run: isDryRun,
      business_events_processed: 0,
      journal_entries_created: 0,
      journal_entry_lines_created: 0,
      trace_logs_created: 0,
      errors: [] as string[],
    };

    // Step 1: Fetch business events matching scope
    const businessEvents = await fetchBusinessEventsInScope(cid, scope, scope_value);
    results.business_events_processed = businessEvents.length;

    if (isDryRun) {
      return c.json({
        ...results,
        preview: businessEvents.slice(0, 5),
      });
    }

    // Step 2: For each business event, regenerate its JE
    for (const event of businessEvents) {
      try {
        const { jeCreated, linesCreated, traceCreated } = await regenerateSingleJournalEntry(
          cid,
          event,
        );
        results.journal_entries_created += jeCreated;
        results.journal_entry_lines_created += linesCreated;
        results.trace_logs_created += traceCreated;
      } catch (err) {
        results.errors.push(`Event ${event.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return c.json({
      status: 'complete',
      ...results,
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

/**
 * Regenerate trace for a single business event
 * Returns: { jeCreated, linesCreated, traceCreated }
 */
async function regenerateSingleJournalEntry(
  companyId: number,
  event: BusinessEvent,
): Promise<{ jeCreated: number; linesCreated: number; traceCreated: number }> {
  let jeCreated = 0;
  let linesCreated = 0;
  let traceCreated = 0;

  // Check if JE already exists for this event
  const existingJE = await db
    .prepare(
      `SELECT id FROM journal_entries 
       WHERE company_id = ? AND ref_type = ? AND ref_id = ?
       LIMIT 1`,
    )
    .bind(companyId, event.ref_type, event.ref_id)
    .first();

  if (existingJE) {
    // Update existing JE with trace metadata
    await db
      .prepare(
        `UPDATE journal_entries
         SET business_event_id = ?, 
             business_event_type = ?,
             generated_by = 'engine-regeneration-' || datetime('now')
         WHERE id = ?`,
      )
      .bind(String(event.id), event.ref_type, existingJE.id)
      .run();
  } else {
    // Create new JE entry
    const newJE = await createJournalEntry(companyId, event);
    if (newJE) {
      jeCreated = 1;
    }
  }

  // Fetch the JE (either existing or newly created)
  const je = await db
    .prepare(
      `SELECT id, posting_rule_trace FROM journal_entries 
       WHERE company_id = ? AND ref_type = ? AND ref_id = ?
       LIMIT 1`,
    )
    .bind(companyId, event.ref_type, event.ref_id)
    .first();

  if (!je) {
    throw new Error(`Could not find or create journal entry for event ${event.id}`);
  }

  // Get posting rule to determine account assignments
  const postingRule = await fetchPostingRule(companyId, je.posting_rule_trace);
  if (!postingRule) {
    throw new Error(`Posting rule not found: ${je.posting_rule_trace}`);
  }

  // Update JE lines with trace metadata
  const lineUpdates = await updateJELineTraces(companyId, je.id, event, postingRule);
  linesCreated = lineUpdates.updated;

  // Create trace log entry
  const traceLog = await createTraceLogEntry(companyId, je.id, event, postingRule);
  if (traceLog) {
    traceCreated = 1;
  }

  return { jeCreated, linesCreated, traceCreated };
}

/**
 * Create a new journal entry from business event
 */
async function createJournalEntry(
  companyId: number,
  event: BusinessEvent,
): Promise<number | null> {
  try {
    // Determine posting rule based on event type
    const postingRuleId = determinePostingRule(event.ref_type);

    const newEntry: JournalEntryToCreate = {
      company_id: companyId,
      entry_date: event.event_date,
      description: `${event.ref_type} #${event.ref_id}`,
      ref_type: event.ref_type,
      ref_id: event.ref_id,
      is_posted: 1,
      created_by: 1, // System user
      posting_rule_trace: postingRuleId,
      business_event_id: String(event.id),
      business_event_type: event.ref_type,
      posting_rule_id: postingRuleId,
      generated_by: 'engine-' + new Date().toISOString(),
    };

    const result = await db
      .prepare(
        `INSERT INTO journal_entries (
        company_id, entry_date, description, ref_type, ref_id, is_posted, 
        created_by, posting_rule_trace, business_event_id, business_event_type, 
        posting_rule_id, generated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newEntry.company_id,
        newEntry.entry_date,
        newEntry.description,
        newEntry.ref_type,
        newEntry.ref_id,
        newEntry.is_posted,
        newEntry.created_by,
        newEntry.posting_rule_trace,
        newEntry.business_event_id,
        newEntry.business_event_type,
        newEntry.posting_rule_id,
        newEntry.generated_by,
      )
      .run();

    return result.meta.last_row_id;
  } catch (error) {
    console.error('Error creating journal entry:', error);
    return null;
  }
}

/**
 * Update journal entry lines with trace metadata
 */
async function updateJELineTraces(
  companyId: number,
  entryId: number,
  event: BusinessEvent,
  postingRule: PostingRule,
): Promise<{ updated: number }> {
  let updated = 0;

  // For each line in the entry, add trace metadata
  const lines = await db
    .prepare(
      `SELECT id, debit, credit FROM journal_entry_lines 
       WHERE entry_id = ? AND company_id = ?`,
    )
    .bind(entryId, companyId)
    .all();

  for (const line of lines as any[]) {
    const ruleClassification =
      line.debit > 0 ? 'debit' : line.credit > 0 ? 'credit' : 'balancing';

    const updateResult = await db
      .prepare(
        `UPDATE journal_entry_lines
         SET 
           business_event_id = ?,
           source_module = ?,
           source_record_id = ?,
           posting_rule_id = ?,
           rule_classification = ?,
           generated_at = datetime('now')
         WHERE id = ? AND entry_id = ?`,
      )
      .bind(
        String(event.id),
        event.ref_type,
        event.ref_id,
        postingRule.id,
        ruleClassification,
        line.id,
        entryId,
      )
      .run();

    if (updateResult.meta.changes > 0) {
      updated++;
    }
  }

  return { updated };
}

/**
 * Create audit trail entry in posting_trace_log
 */
async function createTraceLogEntry(
  companyId: number,
  entryId: number,
  event: BusinessEvent,
  postingRule: PostingRule,
): Promise<string | null> {
  try {
    const traceId = `trace-${companyId}-${event.id}-${entryId}`;

    await db
      .prepare(
        `INSERT OR IGNORE INTO posting_trace_log (
        id, company_id, business_event_type, source_record_id, source_module,
        source_timestamp, journal_entry_id, posting_rule_id, posting_timestamp,
        generated_by, is_traced, classification
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        traceId,
        companyId,
        event.ref_type,
        event.ref_id,
        event.ref_type,
        event.event_date,
        entryId,
        postingRule.id,
        new Date().toISOString(),
        'engine-regeneration',
        1,
        'regenerated',
      )
      .run();

    return traceId;
  } catch (error) {
    console.error('Error creating trace log:', error);
    return null;
  }
}

// =====================================================================
// SECTION 3: Query & Fetch Helpers
// =====================================================================

async function fetchBusinessEventsInScope(
  companyId: number,
  scope: string,
  scopeValue: string,
): Promise<BusinessEvent[]> {
  let query = `
    SELECT DISTINCT
      be.id, be.company_id, be.ref_type, be.ref_id, 
      be.event_date, be.amount
    FROM business_events be
    WHERE be.company_id = ?
  `;

  const params: any[] = [companyId];

  if (scope === 'by_source') {
    query += ` AND be.ref_type = ?`;
    params.push(scopeValue);
  } else if (scope === 'by_period') {
    query += ` AND DATE(be.event_date) BETWEEN ? AND ?`;
    const [start, end] = scopeValue.split('|');
    params.push(start, end);
  }

  query += ` LIMIT 10000`;

  const rows = (await db.prepare(query).bind(...params).all()) as BusinessEvent[];
  return rows;
}

async function fetchPostingRule(companyId: number, ruleId: string): Promise<PostingRule | null> {
  const rule = await db
    .prepare(`SELECT * FROM posting_rules WHERE company_id = ? AND id = ? LIMIT 1`)
    .bind(companyId, ruleId)
    .first();

  if (!rule) {
    return null;
  }

  // For now, return minimal structure
  return {
    id: rule.id,
    company_id: rule.company_id,
    rule_type: rule.rule_type || 'standard',
    posting_slots: [], // Would be parsed from rule definition
  };
}

/**
 * Determine which posting rule to use based on event type
 */
function determinePostingRule(refType: string): string {
  const ruleMap: Record<string, string> = {
    inventory_movement: 'PR-INV-001',
    cash_transaction: 'PR-CASH-001',
    supplier_transaction: 'PR-SUPP-001',
  };

  return ruleMap[refType] || 'PR-MANUAL-001';
}

// =====================================================================
// SECTION 4: Monitoring & Status
// =====================================================================

/**
 * Get regeneration progress
 */
journalEntryEngine.get('/progress', async (c: Context) => {
  const { company_id } = c.req.query();
  const cid = company_id ? parseInt(company_id) : 1;

  const stats = await db
    .prepare(
      `
    SELECT
      COUNT(*) as total_entries,
      SUM(CASE WHEN business_event_id IS NOT NULL THEN 1 ELSE 0 END) as with_trace,
      SUM(CASE WHEN posting_rule_id IS NOT NULL THEN 1 ELSE 0 END) as with_rule,
      SUM(CASE WHEN generated_by IS NOT NULL THEN 1 ELSE 0 END) as regenerated_count
    FROM journal_entries
    WHERE company_id = ?
  `,
    )
    .bind(cid)
    .first();

  return c.json({
    regeneration_progress: {
      total_journal_entries: stats.total_entries || 0,
      with_trace_link: stats.with_trace || 0,
      with_posting_rule: stats.with_rule || 0,
      regenerated_count: stats.regenerated_count || 0,
      coverage_pct:
        stats.total_entries > 0
          ? Math.round((((stats.with_trace || 0) / stats.total_entries) * 100) * 100) / 100
          : 0,
    },
  });
});

/**
 * Get trace reconciliation report
 */
journalEntryEngine.get('/reconciliation-report', async (c: Context) => {
  const { company_id } = c.req.query();
  const cid = company_id ? parseInt(company_id) : 1;

  const report = await db
    .prepare(
      `
    SELECT
      ref_type,
      COUNT(*) as entry_count,
      SUM(CASE WHEN business_event_id IS NOT NULL THEN 1 ELSE 0 END) as traced,
      SUM(CASE WHEN business_event_id IS NULL THEN 1 ELSE 0 END) as untraced
    FROM journal_entries
    WHERE company_id = ?
    GROUP BY ref_type
  `,
    )
    .bind(cid)
    .all();

  return c.json({
    reconciliation_report: report,
  });
});

export default journalEntryEngine;
