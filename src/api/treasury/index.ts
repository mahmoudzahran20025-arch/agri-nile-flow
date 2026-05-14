/**
 * treasury/index.ts
 * ==================
 * Aggregate router for all treasury sub-modules.
 * Replaces the monolithic src/api/treasury.ts.
 *
 * Route ownership:
 *   cash.ts   — cash transaction lifecycle (GET/POST /transactions, GET /balance, GET /supplier-payments)
 *   equity.ts — partner capital management (GET/POST/PATCH /partners)
 */

import { Hono } from 'hono'
import type { Env } from '../../types'
import cash   from './cash'
import equity from './equity'

const treasury = new Hono<{ Bindings: Env }>()

treasury.route('/', cash)
treasury.route('/', equity)

export default treasury
