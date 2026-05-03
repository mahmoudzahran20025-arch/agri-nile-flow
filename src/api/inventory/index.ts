import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware } from '../../middleware/auth'

import items       from './items'
import movements   from './movements'
import receipts    from './receipts'
import adjustments from './adjustments'
import analytics   from './analytics'
import governance  from './governance'
import balances    from './balances'
import transactions from './transactions'

const inventory = new Hono<{ Bindings: Env }>()
inventory.use('*', authMiddleware)

// All sub-routers define full paths, mounted at '/'.
inventory.route('/', items)
inventory.route('/', movements)
inventory.route('/', receipts)
inventory.route('/', adjustments)
inventory.route('/', analytics)
inventory.route('/', governance)
inventory.route('/', balances)
inventory.route('/', transactions)

export default inventory
