/**
 * suppliers/index.ts
 * ==================
 * Aggregate router for all supplier sub-modules.
 * Replaces the monolithic src/api/suppliers.ts.
 *
 * Route ownership:
 *   master.ts   — supplier CRUD + all read endpoints (/, /aging, /drafts, /:code, /:code/summary, etc.)
 *   invoices.ts — transaction lifecycle (POST /:code/transactions, PATCH/DELETE /:code/transactions/:id)
 *   payments.ts — AP settlement (/:code/match-payment, /:code/unmatch-payment, /aging-summary)
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import master   from './master'
import invoices from './invoices'
import payments from './payments'

const suppliers = new Hono<{ Bindings: Env }>()

suppliers.route('/', payments)
suppliers.route('/', invoices)
suppliers.route('/', master)

export default suppliers
