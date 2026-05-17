import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware } from '../../middleware/auth'

import items        from './items'
import movements    from './movements'
import receipts     from './receipts'
import adjustments  from './adjustments'
import analytics    from './analytics'
import governance   from './governance'
import balances     from './balances'
import transactions from './transactions'
import issues       from './issues'
import transfers    from './transfers'

const inventory = new Hono<{ Bindings: Env }>()
inventory.use('*', authMiddleware)

// All sub-routers define full paths, mounted at '/'.
// items defines /warehouses, /item/:code/stock, /item/:code/card, /balances, /categories
// — all must resolve under /inventory/*, so mount at root.
inventory.route('/items', items)   // /inventory/items/* (new callers)
inventory.route('/', items)        // /inventory/warehouses, /inventory/item/:code/* (backward compat)
inventory.route('/', movements)
inventory.route('/', receipts)
inventory.route('/', adjustments)
inventory.route('/', analytics)
inventory.route('/', governance)
inventory.route('/', balances)
inventory.route('/', transactions)
inventory.route('/', issues)
inventory.route('/', transfers)

export default inventory
