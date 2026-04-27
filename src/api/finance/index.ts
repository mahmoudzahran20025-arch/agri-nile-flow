import { Hono } from 'hono'
import type { Env } from '../../types'
import { authMiddleware, roleGuard } from '../../middleware/auth'

import banking    from './banking'
import purchasing from './purchasing'

const finance = new Hono<{ Bindings: Env }>()
finance.use('*', authMiddleware)
finance.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

finance.route('/', banking)
finance.route('/', purchasing)

export default finance
