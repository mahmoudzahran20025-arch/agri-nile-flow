import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Env } from './types'
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

const app = new Hono<{ Bindings: Env }>()

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
app.onError((err, c) => {
  console.error('[Worker Error]', err.message)
  if (err.message === 'FORBIDDEN') {
    return c.json({ success: false, error: 'غير مصرح بهذا الإجراء' }, 403)
  }
  return c.json({ success: false, error: 'خطأ في الخادم' }, 500)
})

export default {
  fetch: app.fetch,

  // ─── Scheduled Cron Handler ─────────────────────────────────
  // يشتغل كل يوم الساعة 10 مساءً UTC (تقريباً منتصف الليل بتوقيت القاهرة)
  // يحوّل جميع مهام الزيارات المعلقة من أيام سابقة إلى "missed"
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

        // تحويل كل location_tasks بتاريخ أقدم من اليوم وحالتها pending → missed
        const result = await env.DB.prepare(
          `UPDATE location_tasks
           SET status = 'missed'
           WHERE status = 'pending' AND task_date < ?`
        ).bind(today).run()

        console.log(`[Cron] Marked ${result.meta.changes ?? 0} overdue location tasks as missed (${today})`)
      } catch (err) {
        console.error('[Cron] Failed to mark missed tasks:', err)
      }
    })())
  },
}
