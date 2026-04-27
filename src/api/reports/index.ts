import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware } from '../../middleware/auth'

import costCenters from './cost-centers'
import suppliers   from './suppliers'
import season      from './season'
import budget      from './budget'

const reports = new Hono<{ Bindings: Env }>()
reports.use('*', authMiddleware)

reports.route('/', costCenters)
reports.route('/', suppliers)
reports.route('/', season)
reports.route('/', budget)

export default reports
