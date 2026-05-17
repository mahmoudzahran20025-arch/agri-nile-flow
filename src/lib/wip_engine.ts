/**
 * WIP Engine — append-only cost accumulation into wip_ledger.
 *
 * Invariants (binding architectural decisions):
 *  - wip_ledger is source of truth; GL is the accounting reflection layer only
 *  - running_balance is deterministic and append-only — no UPDATE of historical rows
 *  - Every INSERT computes running_balance as (last row running_balance + debit - credit)
 *  - crop_cycle_id must reference an active crop cycle; we check and warn but do not block
 *    GL posting (the caller already posted to GL; WIP is an additional write)
 */

import type { D1Database } from '@cloudflare/workers-types'

export type WIPCostCategory =
  | 'materials' | 'labor' | 'equipment' | 'overhead' | 'depreciation'
  | 'irrigation' | 'land_rent' | 'fuel' | 'maintenance' | 'contractor'
  | 'transport'  | 'other'

export interface PostCostToWIPOpts {
  db:               D1Database
  company_id:       number
  crop_cycle_id:    number
  season_id:        number
  transaction_date: string
  cost_category:    WIPCostCategory
  subcategory_code?: string | null
  debit:            number
  credit?:          number
  description?:     string | null
  source_module?:   string | null
  source_id?:       number | null
  journal_entry_id?: number | null
  // Depreciation proportional allocation fields
  allocation_method?: 'percentage' | 'machine_hours' | 'acreage' | 'manual' | null
  allocation_share?:  number | null
}

export interface WIPPostResult {
  wip_ledger_id:   number
  running_balance: number
}

/**
 * Append a cost row to wip_ledger.
 * Computes running_balance from the latest existing row for this crop_cycle.
 * Returns the new row id and running balance.
 */
export async function postCostToWIP(opts: PostCostToWIPOpts): Promise<WIPPostResult> {
  const { db, company_id, crop_cycle_id } = opts

  // Guard: cycle must exist and be active
  const cycle = await db.prepare(
    'SELECT id, status, season_id FROM crop_cycles WHERE id = ? AND company_id = ?'
  ).bind(crop_cycle_id, company_id).first<{ id: number; status: string; season_id: number }>()

  if (!cycle) {
    throw new Error(`WIP_ENGINE: crop_cycle_id=${crop_cycle_id} not found for company ${company_id}`)
  }
  if (cycle.status !== 'active') {
    throw new Error(`WIP_ENGINE: Cannot post to non-active crop cycle ${crop_cycle_id} (status=${cycle.status})`)
  }

  const debit  = Math.round((opts.debit  ?? 0) * 100) / 100
  const credit = Math.round((opts.credit ?? 0) * 100) / 100

  // Compute running balance from last row for this crop cycle
  const lastRow = await db.prepare(
    `SELECT running_balance FROM wip_ledger
     WHERE company_id = ? AND crop_cycle_id = ?
     ORDER BY id DESC LIMIT 1`
  ).bind(company_id, crop_cycle_id).first<{ running_balance: number }>()

  const prevBalance    = lastRow?.running_balance ?? 0
  const runningBalance = Math.round((prevBalance + debit - credit) * 100) / 100

  const { meta } = await db.prepare(`
    INSERT INTO wip_ledger
      (company_id, crop_cycle_id, season_id, transaction_date,
       cost_category, subcategory_code,
       debit, credit, running_balance,
       description, source_module, source_id, journal_entry_id,
       allocation_method, allocation_share)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    company_id,
    crop_cycle_id,
    opts.season_id,
    opts.transaction_date,
    opts.cost_category,
    opts.subcategory_code ?? null,
    debit,
    credit,
    runningBalance,
    opts.description ?? null,
    opts.source_module ?? null,
    opts.source_id ?? null,
    opts.journal_entry_id ?? null,
    opts.allocation_method ?? null,
    opts.allocation_share ?? null,
  ).run()

  return { wip_ledger_id: meta.last_row_id, running_balance: runningBalance }
}

/**
 * Convenience: post a credit (settlement / reversal) to WIP.
 */
export async function creditCostFromWIP(opts: Omit<PostCostToWIPOpts, 'debit'> & { amount: number }): Promise<WIPPostResult> {
  return postCostToWIP({ ...opts, debit: 0, credit: opts.amount })
}
