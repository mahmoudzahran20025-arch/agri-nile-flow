import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware } from '../../middleware/auth'

import costCenters   from './cost-centers'
import suppliers     from './suppliers'
import season        from './season'
import budget        from './budget'
import trialBalance  from './trial-balance'
import costPerFeddan from './cost-per-feddan'

const reports = new Hono<{ Bindings: Env }>()
reports.use('*', authMiddleware)

reports.route('/', costCenters)
reports.route('/', suppliers)
reports.route('/', season)
reports.route('/', budget)
reports.route('/', trialBalance)
reports.route('/', costPerFeddan)

export default reports
