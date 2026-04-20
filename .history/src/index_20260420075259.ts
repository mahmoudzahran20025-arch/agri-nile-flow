import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Env } from './types'
import authRoutes      from './api/auth'
import dashboardRoutes from './api/dashboard'
import supplierRoutes  from './api/suppliers'
import treasuryRoutes  from './api/treasury'
import inventoryRoutes from './api/inventory'
import configRoutes    from './api/config'
import usersRoutes     from './api/users'

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
  allowMethods:  ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders:  ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Total-Count'],
  maxAge:        86_400,
  credentials:   true,
}))

// ─── API Routes ───────────────────────────────────────────────
app.route('/api/auth',      authRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/suppliers', supplierRoutes)
app.route('/api/treasury',  treasuryRoutes)
app.route('/api/inventory', inventoryRoutes)
app.route('/api/config',    configRoutes)
app.route('/api/users',     usersRoutes)

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

export default app
