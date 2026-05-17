import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveWorkOrderLabor as peResolveWorkOrderLabor,
  resolveContractAdvance as peResolveContractAdvance,
} from '../../posting_engine'
import { postFromBusinessEvent } from '../business_events'
import { resolveControlAccount } from '../../posting_engine'
import { postCostToWIP } from '../../wip_engine'

export async function resolveWorkOrderLabor(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    amount: number
    date: string
    description: string
    created_by?: number
    center_code?: number
    season_id?: number
    field_id?: number
    // When set, labor cost is also posted to wip_ledger for the crop cycle.
    crop_cycle_id?: number | null
  },
): Promise<number | null> {
  const [cogsAcc, wagesPayableAcc] = await Promise.all([
    resolveControlAccount(db, opts.company_id, 'inventory_cogs_adjustment'),
    resolveControlAccount(db, opts.company_id, 'wages_payable'),
  ])

  const blueprint = await peResolveWorkOrderLabor(
    db, 
    opts.company_id, 
    cogsAcc || '', 
    wagesPayableAcc || '', 
    opts.amount,
    opts.description
  )
  
  if (blueprint.isBlocked || !blueprint.lines.length) {
    throw new Error(`WORK_ORDER_LABOR_POSTING_BLOCKED: ${blueprint.validationErrors.join(', ')}`)
  }

  const refId = opts.ref_id
  const laborEntryId = await postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'work_order_labor',
    source_module: 'operations',
    source_id:     refId,
    source_link_id: refId,
    event_date:    opts.date,
    description:   `تكلفة عمالة/معدات | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { amount: opts.amount },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l: any) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `تكلفة عمالة/معدات | ${opts.description}`,
      center_code:   opts.center_code,
      season_id:     opts.season_id,
      field_id:      opts.field_id,
      rule_slot:     l.rule_slot,
      source_ledger: 'manual',
      source_record_id: refId,
    })),
    onJournalEntryPosted: async (entryId) => {
      await db.prepare('UPDATE work_tasks SET journal_entry_id = ? WHERE work_order_id = ? AND company_id = ?')
        .bind(entryId, refId, opts.company_id).run()
    },
  })

  // WIP side-effect: work order tied to a crop cycle → accumulate labor cost.
  if (opts.crop_cycle_id && opts.season_id) {
    try {
      await postCostToWIP({
        db,
        company_id:         opts.company_id,
        crop_cycle_id:      opts.crop_cycle_id,
        season_id:          opts.season_id,
        transaction_date:   opts.date,
        cost_category:      'labor',
        cost_category_code: 'LABOR',
        debit:              opts.amount,
        description:        `عمالة: ${opts.description}`,
        source_module:      'operations',
        source_id:          refId,
        journal_entry_id:   laborEntryId,
      })
    } catch (wipErr) {
      console.error(`WIP_ACCUMULATION_FAILED: work order ${refId}:`, (wipErr as Error).message)
    }
  }

  return laborEntryId
}

export async function resolveContractAdvance(
  db: D1Database,
  opts: {
    company_id: number
    ref_id: number
    amount: number
    date: string
    description: string
    contract_id: number
    created_by?: number
  },
): Promise<number | null> {
  const [cashAcc, deferredAcc] = await Promise.all([
    resolveControlAccount(db, opts.company_id, 'cash'),
    resolveControlAccount(db, opts.company_id, 'deferred_revenue'), // or similar for contract advances
  ])

  const blueprint = await peResolveContractAdvance(
    db, 
    opts.company_id, 
    cashAcc || '', 
    deferredAcc || '', 
    opts.amount,
    opts.description
  )

  const refId = opts.ref_id
  return postFromBusinessEvent(db, {
    company_id:    opts.company_id,
    event_type:    'contract_advance',
    source_module: 'contracts',
    source_id:     refId,
    source_link_id: refId,
    event_date:    opts.date,
    description:   `دفعة مقدمة عقد | ${opts.description}`,
    created_by:    opts.created_by,
    payload:       { contract_id: opts.contract_id, amount: opts.amount },
    trace:         blueprint.trace ?? null,
    lines:         blueprint.lines.map((l: any) => ({
      account_code:  l.account_code!,
      debit:         l.debit ?? 0,
      credit:        l.credit ?? 0,
      description:   l.description ?? `دفعة مقدمة عقد | ${opts.description}`,
      rule_slot:     l.rule_slot,
      source_ledger: 'manual',
      source_record_id: refId,
    })),
    onJournalEntryPosted: async (entryId) => {
      await db.prepare('UPDATE cash_transactions SET journal_entry_id = ? WHERE id = ? AND company_id = ?')
        .bind(entryId, refId, opts.company_id).run()
    },
  })
}
