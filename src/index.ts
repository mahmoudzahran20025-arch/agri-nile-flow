import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Env, JwtPayload } from './types'
import authRoutes       from './api/auth'
import dashboardRoutes  from './api/dashboard'
import supplierRoutes   from './api/suppliers'
import treasuryRoutes   from './api/treasury'
import inventoryRoutes  from './api/inventory'
import configRoutes     from './api/config'
import usersRoutes      from './api/users'
import fieldsRoutes     from './api/fields'
import employeesRoutes  from './api/employees'
import operationsRoutes from './api/operations'
import contractsRoutes  from './api/contracts'
import exportRoutes     from './api/export'
import glRoutes         from './api/gl'
import adminRoutes      from './api/admin'
import auditRoutes      from './api/audit'
import stagingRoutes    from './api/staging'
import hrRoutes         from './api/hr'
import docsRoutes       from './api/documents'
import calendarRoutes   from './api/calendar'
import financeRoutes    from './api/finance'
import reportsRoutes    from './api/reports'
import budgetsRoutes    from './api/budgets'
import classifierRoutes from './api/classifier'
import validationRoutes from './api/validation'
import assetsRoutes      from './api/assets'
import schemaRoutes      from './api/schema'
import cropCyclesRoutes          from './api/crop-cycles'
import harvestSettlementsRoutes  from './api/harvest-settlements'
import costCategoriesRoutes      from './api/cost-categories'
import { processAllPendingOutbox } from './lib/process_outbox'
import { runHealthForAllCompanies } from './lib/daily_finance_health'
import { getTodayIsoDate } from './lib/utils/date'

const app = new Hono<{ Bindings: Env; Variables: { jwtPayload: JwtPayload } }>()

const ALLOWED_ORIGINS = [
  'https://agri-nile-flow-lake.pages.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

// ─── Global Middleware ────────────────────────────────────────
app.use('*', logger())
app.use('/api/*', cors({
  origin: (origin) => {
    // Allow exact matches
    if (ALLOWED_ORIGINS.includes(origin)) return origin
    // Allow any preview URLs under pages.dev (e.g., [hash].agri-nile-flow-lake.pages.dev)
    if (origin && origin.includes('.agri-nile-flow-lake.pages.dev')) return origin
    return ALLOWED_ORIGINS[0]
  },
  allowMethods:  ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders:  ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Total-Count'],
  maxAge:        86_400,
  credentials:   true,
}))

// ─── API Routes ───────────────────────────────────────────────
app.route('/api/auth',       authRoutes)
app.route('/api/dashboard',  dashboardRoutes)
app.route('/api/suppliers',  supplierRoutes)
app.route('/api/treasury',   treasuryRoutes)
app.route('/api/inventory',  inventoryRoutes)
app.route('/api/config',     configRoutes)
app.route('/api/users',      usersRoutes)
app.route('/api/fields',     fieldsRoutes)
app.route('/api/employees',  employeesRoutes)
app.route('/api/operations', operationsRoutes)
app.route('/api/contracts',  contractsRoutes)
app.route('/api/export',     exportRoutes)
app.route('/api/gl',         glRoutes)
app.route('/api/admin',      adminRoutes)
app.route('/api/audit',      auditRoutes)
app.route('/api/staging',    stagingRoutes)
app.route('/api/hr',         hrRoutes)
app.route('/api/documents',  docsRoutes)
app.route('/api/calendar',   calendarRoutes)
app.route('/api/finance',    financeRoutes)
app.route('/api/reports',    reportsRoutes)
app.route('/api/budgets',    budgetsRoutes)
app.route('/api/classifier', classifierRoutes)
app.route('/api/validation', validationRoutes)
app.route('/api/assets',       assetsRoutes)
app.route('/api/schema',       schemaRoutes)
app.route('/api/crop-cycles',          cropCyclesRoutes)
app.route('/api/harvest-settlements',  harvestSettlementsRoutes)
app.route('/api/cost-categories',      costCategoriesRoutes)

// ─── Health Check ─────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }))

// ─── 404 for unknown API paths ────────────────────────────────
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ success: false, error: 'المسار غير موجود' }, 404)
  }
  // SPA fallback — Cloudflare Assets handles static files
  return c.text('Not Found', 404)
})

// ─── Global Error Handler ─────────────────────────────────────
app.onError(async (err, c) => {
  const method   = c.req.method
  const endpoint = c.req.path
  
  console.error(`[Worker Error] ${method} ${endpoint}:`, err.message)

  // Try to log the error to the database for observability
  try {
    // Get user and company if available (safe check)
    let userId: number | null = null
    let companyId: number | null = null
    try {
      const payload = c.get('jwtPayload') // Standard Hono JWT location if used
      if (payload) {
        userId = Number(payload.sub)
        companyId = Number(payload.company_id)
      }
    } catch { /* ignore if no user context */ }

    // Read body preview (limited length)
    let bodyPreview = ''
    try {
      const body = await c.req.raw.clone().text()
      bodyPreview = body.slice(0, 1000)
    } catch { /* ignore */ }

    await c.env.DB.prepare(
      `INSERT INTO system_error_logs (company_id, user_id, endpoint, method, error_message, stack_trace, request_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(companyId, userId, endpoint, method, err.message, err.stack ?? null, bodyPreview).run()
  } catch (logErr) {
    console.error('[Logging Failed]', logErr)
  }

  if (err.message === 'FORBIDDEN') {
    return c.json({ success: false, error: 'غير مصرح بهذا الإجراء' }, 403)
  }
  
  // Return a clean error to the client
  return c.json({ 
    success: false, 
    error: 'حدث خطأ غير متوقع في النظام',
    trace_id: Date.now() // For user to report
  }, 500)
})

export default {
  fetch: app.fetch,

  // ─── Scheduled Cron Handler ─────────────────────────────────
  // Two triggers (see wrangler.toml):
  //   "0 22 * * *"   — daily at 22:00 UTC: marks overdue location tasks as missed
  //   "*/15 * * * *" — every 15 min: sweeps inventory GL posting outbox
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const isDailyRun = event.cron === '0 22 * * *'

      // ── Daily: mark overdue location tasks + finance health check ──
      if (isDailyRun) {
        try {
          const today = getTodayIsoDate()

          const result = await env.DB.prepare(
            `UPDATE location_tasks SET status = 'missed' WHERE status = 'pending' AND task_date < ?`
          ).bind(today).run()
          console.log(`[Cron:daily] Marked ${result.meta.changes ?? 0} overdue location tasks as missed (${today})`)
        } catch (err) {
          console.error('[Cron:daily] Failed to mark missed tasks:', err)
        }

        try {
          await runHealthForAllCompanies(env.DB)
          console.log('[Cron:daily] Finance health check complete')
        } catch (err) {
          console.error('[Cron:daily] Finance health check failed:', err)
        }
      }

      // ── Every 15 min: sweep inventory GL posting outbox ────
      try {
        await processAllPendingOutbox(env.DB)
        console.log(`[Cron:outbox] Inventory posting outbox sweep complete (${event.cron})`)
      } catch (err) {
        console.error('[Cron:outbox] Outbox sweep failed:', err)
      }
    })())
  },
}
