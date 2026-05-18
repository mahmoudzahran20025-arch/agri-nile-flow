/**
 * process_outbox.ts — Inventory Posting Outbox Worker
 * ====================================================
 * Extracted from governance.ts so the same logic can be called from:
 *   1. POST /api/inventory/posting-outbox/process  (manual trigger)
 *   2. Cloudflare Workers scheduled() cron handler (automatic)
 */

import type { D1Database } from '@cloudflare/workers-types'
import { FinanceCore } from './finance_core'
import { postCostToWIP } from './wip_engine'

export interface OutboxProcessResult {
  scanned: number
  posted:  number
  failed:  number
}

/**
 * Process up to `limit` pending outbox messages for a single company.
 * Safe to call concurrently for different companies; sequential for same company.
 *
 * Pre-flight guard: skips any message whose movement already has
 * gl_posting_status = 'posted' — prevents double-posting on retries.
 */
export async function processInventoryPostingOutbox(
  db:        D1Database,
  companyId: number,
  limit:     number = 50,
): Promise<OutboxProcessResult> {
  limit = Math.min(Math.max(limit, 1), 200)

  const { results: jobs } = await db.prepare(
    `SELECT id, event_type, movement_id, payload_json, attempts
     FROM inventory_posting_outbox
     WHERE company_id = ? AND status IN ('pending', 'outbox_pending')
     ORDER BY id ASC
     LIMIT ?`
  ).bind(companyId, limit).all<{
    id:           number
    event_type:   string
    movement_id:  number
    payload_json: string
    attempts:     number
  }>()

  let posted = 0
  let failed = 0

  for (const job of jobs) {
    // ── Pre-flight: skip only if movement is genuinely posted (has a real JE).
    //    A movement with gl_posting_status='posted' but journal_entry_id IS NULL
    //    is a ghost — it must be re-processed, not skipped.
    const movRow = await db.prepare(
      'SELECT gl_posting_status, journal_entry_id FROM inventory_movements WHERE id = ? AND company_id = ?'
    ).bind(job.movement_id, companyId).first<{ gl_posting_status: string; journal_entry_id: number | null }>()

    if (movRow?.gl_posting_status === 'posted' && movRow.journal_entry_id != null) {
      await db.prepare(
        `UPDATE inventory_posting_outbox
         SET status = 'done', processed_at = datetime('now'), last_error = NULL, updated_at = datetime('now')
         WHERE id = ? AND company_id = ?`
      ).bind(job.id, companyId).run()
      posted++
      continue
    }

    // Mark as processing (prevents another worker instance from picking it up)
    await db.prepare(
      `UPDATE inventory_posting_outbox SET status = 'processing', updated_at = datetime('now')
       WHERE id = ? AND company_id = ?`
    ).bind(job.id, companyId).run()

    try {
      const payload = JSON.parse(job.payload_json || '{}')
      let jeId: number | null = null

      if (job.event_type === 'inventory_movement') {
        jeId = await FinanceCore.resolveInventoryMovement(db, payload)
      } else if (job.event_type === 'inventory_transfer') {
        jeId = await FinanceCore.resolveInventoryTransfer(db, payload)
      } else {
        throw new Error(`Unsupported event_type: ${job.event_type}`)
      }

      // Batch atomically: outbox done + movement(s) posted in one round-trip.
      // This eliminates the window where outbox is 'done' but movement stays 'pending'
      // if the Worker crashes between the two separate UPDATEs.
      const targetMovementId = Number((payload as Record<string, unknown>)?.target_movement_id ?? 0)
      const batchUpdates: D1PreparedStatement[] = [
        db.prepare(
          `UPDATE inventory_posting_outbox
           SET status = 'done', processed_at = datetime('now'), last_error = NULL, updated_at = datetime('now')
           WHERE id = ? AND company_id = ?`
        ).bind(job.id, companyId),
        db.prepare(
          `UPDATE inventory_movements
           SET gl_posting_status = 'posted', gl_posted_at = datetime('now'),
               gl_posting_error = NULL, journal_entry_id = COALESCE(?, journal_entry_id)
           WHERE id = ? AND company_id = ?`
        ).bind(jeId, job.movement_id, companyId),
      ]
      if (targetMovementId > 0) {
        batchUpdates.push(
          db.prepare(
            `UPDATE inventory_movements
             SET gl_posting_status = 'posted', gl_posted_at = datetime('now'),
                 gl_posting_error = NULL, journal_entry_id = COALESCE(?, journal_entry_id)
             WHERE id = ? AND company_id = ?`
          ).bind(jeId, targetMovementId, companyId)
        )
      }
      await db.batch(batchUpdates)

      // WIP cost write — only for ISSUE movements linked to a crop cycle.
      // Non-blocking: failure does not affect GL or movement status.
      if (
        job.event_type === 'inventory_movement' &&
        payload.movement_type === 'ISSUE' &&
        payload.crop_cycle_id &&
        payload.season_id &&
        payload.value > 0
      ) {
        try {
          await postCostToWIP({
            db,
            company_id: companyId,
            crop_cycle_id: payload.crop_cycle_id,
            season_id: payload.season_id,
            transaction_date: payload.date,
            cost_category: 'materials',
            debit: payload.value,
            description: `مواد — ${payload.item_name ?? payload.item_code} (outbox)`,
            source_module: 'inventory',
            source_id: job.movement_id,
          })
        } catch (wipErr: unknown) {
          console.error(`[WIP_ENGINE] Outbox movement ${job.movement_id}: ${(wipErr as Error)?.message ?? wipErr}`)
        }
      }

      posted++
    } catch (err: unknown) {
      failed++
      const nextRetry  = (job.attempts ?? 0) + 1
      const nextStatus = nextRetry >= 10 ? 'failed' : 'pending'
      const errMsg     = String((err as Error)?.message ?? err)

      await db.prepare(
        `UPDATE inventory_posting_outbox
         SET status = ?, attempts = ?, last_error = ?, updated_at = datetime('now')
         WHERE id = ? AND company_id = ?`
      ).bind(nextStatus, nextRetry, errMsg, job.id, companyId).run()

      await db.prepare(
        `UPDATE inventory_movements
         SET gl_posting_status = ?, gl_posting_error = ?
         WHERE id = ? AND company_id = ?`
      ).bind(nextStatus === 'failed' ? 'failed' : 'pending', errMsg, job.movement_id, companyId).run()
    }
  }

  return { scanned: jobs.length, posted, failed }
}

/**
 * Called from the cron handler — iterates over all companies that have pending
 * outbox messages and processes each in turn.
 *
 * Stuck-job recovery: any row left in 'processing' for more than 5 minutes is
 * reset to 'pending' (attempts + 1) before scanning begins. This handles Worker
 * crashes that occur after marking a job 'processing' but before completing it.
 */
export async function processAllPendingOutbox(db: D1Database): Promise<void> {
  // Reset stale 'processing' jobs — 5 min staleness threshold
  try {
    const staleResult = await db.prepare(
      `UPDATE inventory_posting_outbox
       SET status = 'pending', attempts = attempts + 1,
           last_error = 'reset: stale processing (>5 min)', updated_at = datetime('now')
       WHERE status = 'processing'
         AND updated_at < datetime('now', '-5 minutes')`
    ).run()
    if ((staleResult.meta.changes ?? 0) > 0) {
      console.warn(`[Outbox] Reset ${staleResult.meta.changes} stale processing jobs`)
    }
  } catch (err) {
    console.error('[Outbox] Stale-job reset failed:', err)
  }

  const { results } = await db.prepare(
    `SELECT DISTINCT company_id FROM inventory_posting_outbox
     WHERE status IN ('pending', 'outbox_pending')
     LIMIT 20`
  ).all<{ company_id: number }>()

  for (const { company_id } of results) {
    try {
      await processInventoryPostingOutbox(db, company_id, 50)
    } catch (err) {
      console.error(`[Outbox] Failed for company ${company_id}:`, err)
    }
  }
}
