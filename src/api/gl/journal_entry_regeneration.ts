/**
 * Journal Entry Regeneration Engine
 * =====================================================
 * Purpose: Rebuild journal entries from business_events
 * with full deterministic trace metadata
 *
 * Pattern: Idempotent by (company_id, source_record_id, posting_rule_id)
 */

import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Env } from '../../types'
import { authMiddleware, getUser, roleGuard } from '../../middleware/auth'

const journalEntryEngine = new Hono<{ Bindings: Env }>()
journalEntryEngine.use('*', authMiddleware)
journalEntryEngine.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// =====================================================================
// SECTION 1: Type Definitions
// =====================================================================

interface BusinessEvent {
  id: number
  company_id: number
  event_type: string
  source_module: string
  source_id: number
  event_date: string
}

interface PostingRule {
  id: string | number
  company_id: number
  rule_type: string
}

// =====================================================================
// SECTION 2: Core JE Regeneration Logic
// =====================================================================

journalEntryEngine.post('/rebuild', async (c) => {
  try {
    const { company_id: cidParam } = getUser(c)
    const db = c.env.DB
    const scope = c.req.query('scope')
    const scope_value = c.req.query('scope_value')
    const isDryRun = c.req.query('dry_run') === 'true'

    const results = {
      scope,
      scope_value,
      company_id: cidParam,
      dry_run: isDryRun,
      business_events_processed: 0,
      journal_entries_created: 0,
      journal_entry_lines_created: 0,
      skipped_posted: 0,
      errors: [] as string[],
    }

    const businessEvents = await fetchBusinessEventsInScope(db, cidParam, scope, scope_value)
    results.business_events_processed = businessEvents.length

    if (isDryRun) {
      return c.json({ ...results, preview: businessEvents.slice(0, 5) })
    }

    for (const event of businessEvents) {
      try {
        const { jeCreated, linesCreated, skipped } = await regenerateSingleJournalEntry(db, cidParam, event)
        results.journal_entries_created += jeCreated
        results.journal_entry_lines_created += linesCreated
        results.skipped_posted += skipped
      } catch (err) {
        results.errors.push(`Event ${event.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return c.json({ status: 'complete', ...results })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500)
  }
})

async function regenerateSingleJournalEntry(
  db: D1Database,
  companyId: number,
  event: BusinessEvent,
): Promise<{ jeCreated: number; linesCreated: number; skipped: number }> {
  let jeCreated = 0

  // journal_entries links back via ref_type='business_event' and ref_id=event.id
  const existingJE = await db
    .prepare(`SELECT id, is_posted FROM journal_entries WHERE company_id = ? AND ref_type = 'business_event' AND ref_id = ? LIMIT 1`)
    .bind(companyId, event.id)
    .first<{ id: number; is_posted: number }>()

  if (existingJE) {
    // Tag trace metadata on the header (safe — trigger only blocks line modifications)
    await db
      .prepare(`UPDATE journal_entries SET business_event_id = ?, business_event_type = ?, generated_by = 'engine-regeneration-' || datetime('now') WHERE id = ?`)
      .bind(String(event.id), event.event_type, existingJE.id)
      .run()

    // Lines of posted entries cannot be modified — tag them only if the entry is unposted
    if (existingJE.is_posted) {
      return { jeCreated: 0, linesCreated: 0, skipped: 1 }
    }
  } else {
    const postingRuleId = determinePostingRule(event.event_type)
    await db
      .prepare(`INSERT INTO journal_entries (company_id, entry_date, description, ref_type, ref_id, is_posted, created_by, posting_rule_trace, business_event_id, business_event_type, posting_rule_id, generated_by) VALUES (?, ?, ?, 'business_event', ?, 1, 1, ?, ?, ?, ?, ?)`)
      .bind(companyId, event.event_date, `${event.event_type} #${event.source_id}`, event.id, postingRuleId, String(event.id), event.event_type, postingRuleId, 'engine-' + new Date().toISOString())
      .run()
    jeCreated = 1
  }

  const je = await db
    .prepare(`SELECT id, posting_rule_trace FROM journal_entries WHERE company_id = ? AND ref_type = 'business_event' AND ref_id = ? LIMIT 1`)
    .bind(companyId, event.id)
    .first<{ id: number; posting_rule_trace: string | null }>()

  if (!je) throw new Error(`Could not find journal entry for event ${event.id}`)

  const postingRule = je.posting_rule_trace
    ? await fetchPostingRule(db, companyId, je.posting_rule_trace)
    : null

  const lines = await db
    .prepare(`SELECT id, debit, credit FROM journal_entry_lines WHERE entry_id = ? AND company_id = ?`)
    .bind(je.id, companyId)
    .all<{ id: number; debit: number; credit: number }>()

  for (const line of lines.results) {
    const ruleClassification = line.debit > 0 ? 'debit' : line.credit > 0 ? 'credit' : 'balancing'
    await db
      .prepare(`UPDATE journal_entry_lines SET business_event_id = ?, source_module = ?, source_record_id = ?, posting_rule_id = ?, rule_classification = ?, generated_at = datetime('now') WHERE id = ? AND entry_id = ?`)
      .bind(String(event.id), event.source_module, event.source_id, postingRule?.id ?? null, ruleClassification, line.id, je.id)
      .run()
  }

  return { jeCreated, linesCreated: lines.results.length, skipped: 0 }
}

async function fetchBusinessEventsInScope(
  db: D1Database,
  companyId: number,
  scope: string | undefined,
  scopeValue: string | undefined,
): Promise<BusinessEvent[]> {
  let query = `SELECT id, company_id, event_type, source_module, source_id, event_date FROM business_events WHERE company_id = ? AND status = 'posted'`
  const params: unknown[] = [companyId]

  if (scope === 'by_source' && scopeValue) {
    query += ` AND event_type = ?`
    params.push(scopeValue)
  } else if (scope === 'by_period' && scopeValue) {
    const [start, end] = scopeValue.split('|')
    query += ` AND DATE(event_date) BETWEEN ? AND ?`
    params.push(start, end)
  }

  query += ` LIMIT 10000`
  const rows = await db.prepare(query).bind(...params).all<BusinessEvent>()
  return rows.results
}

async function fetchPostingRule(db: D1Database, companyId: number, ruleId: string): Promise<PostingRule | null> {
  const rule = await db
    .prepare(`SELECT id, company_id, rule_type FROM posting_rules WHERE company_id = ? AND id = ? LIMIT 1`)
    .bind(companyId, ruleId)
    .first<PostingRule>()
  return rule ?? null
}

function determinePostingRule(eventType: string): string {
  const ruleMap: Record<string, string> = {
    inventory_movement:  'PR-INV-001',
    purchase_receipt:    'PR-INV-001',
    cash_transaction:    'PR-CASH-001',
    expense:             'PR-CASH-001',
    revenue:             'PR-CASH-001',
    supplier_invoice:    'PR-SUPP-001',
    supplier_payment:    'PR-SUPP-001',
  }
  return ruleMap[eventType] ?? 'PR-MANUAL-001'
}

// =====================================================================
// SECTION 3: Monitoring & Status
// =====================================================================

journalEntryEngine.get('/progress', async (c) => {
  const { company_id } = getUser(c)
  const db = c.env.DB

  const stats = await db
    .prepare(`SELECT COUNT(*) as total_entries, SUM(CASE WHEN business_event_id IS NOT NULL THEN 1 ELSE 0 END) as with_trace, SUM(CASE WHEN posting_rule_id IS NOT NULL THEN 1 ELSE 0 END) as with_rule, SUM(CASE WHEN generated_by IS NOT NULL THEN 1 ELSE 0 END) as regenerated_count FROM journal_entries WHERE company_id = ?`)
    .bind(company_id)
    .first<{ total_entries: number; with_trace: number; with_rule: number; regenerated_count: number }>()

  const total = stats?.total_entries ?? 0
  return c.json({
    regeneration_progress: {
      total_journal_entries: total,
      with_trace_link: stats?.with_trace ?? 0,
      with_posting_rule: stats?.with_rule ?? 0,
      regenerated_count: stats?.regenerated_count ?? 0,
      coverage_pct: total > 0 ? Math.round(((stats?.with_trace ?? 0) / total) * 10000) / 100 : 0,
    },
  })
})

journalEntryEngine.get('/reconciliation-report', async (c) => {
  const { company_id } = getUser(c)
  const db = c.env.DB

  const report = await db
    .prepare(`SELECT ref_type, COUNT(*) as entry_count, SUM(CASE WHEN business_event_id IS NOT NULL THEN 1 ELSE 0 END) as traced, SUM(CASE WHEN business_event_id IS NULL THEN 1 ELSE 0 END) as untraced FROM journal_entries WHERE company_id = ? GROUP BY ref_type`)
    .bind(company_id)
    .all()

  return c.json({ reconciliation_report: report.results })
})

export default journalEntryEngine
