import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, roleGuard } from '../../middleware/auth'

import branches   from './branches'
import jobDetails from './job-details'
import attendance from './attendance'
import leaves     from './leaves'
import payroll    from './payroll'
import assets     from './assets'
import profile    from './profile'
import geo        from './geo'
import dashboard  from './dashboard'

const hr = new Hono<{ Bindings: Env }>()
hr.use('*', authMiddleware)
hr.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// All sub-routers define their full paths (e.g. '/branches', '/payroll/:id')
// so they mount cleanly at '/' without path mangling.
hr.route('/', branches)
hr.route('/', jobDetails)
hr.route('/', attendance)
hr.route('/', leaves)
hr.route('/', payroll)
hr.route('/', assets)
hr.route('/', profile)
hr.route('/', geo)
hr.route('/', dashboard)

export default hr
