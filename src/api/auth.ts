import { Hono } from 'hono'
import type { Env } from '../types'
import { hashPassword, generateSalt, signJwt, verifyJwt } from '../middleware/auth'

const auth = new Hono<{ Bindings: Env }>()

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { email, password, company_id } = await c.req.json<{
    email: string; password: string; company_id: number
  }>()

  if (!email || !password || !company_id) {
    return c.json({ success: false, error: 'بيانات ناقصة' }, 400)
  }

  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
    .bind(email.toLowerCase().trim())
    .first<{ id: number; password_hash: string; password_salt: string; full_name: string }>()

  if (!user) {
    return c.json({ success: false, error: 'بيانات الدخول غير صحيحة' }, 401)
  }

  const hash = await hashPassword(password, user.password_salt)
  if (hash !== user.password_hash) {
    return c.json({ success: false, error: 'بيانات الدخول غير صحيحة' }, 401)
  }

  // Verify user has access to this company
  const access = await c.env.DB
    .prepare('SELECT role_id FROM user_companies WHERE user_id = ? AND company_id = ? AND is_active = 1')
    .bind(user.id, company_id)
    .first<{ role_id: number }>()

  if (!access) {
    return c.json({ success: false, error: 'لا يوجد صلاحية للوصول لهذه الشركة' }, 403)
  }

  const roleRow = await c.env.DB
    .prepare('SELECT name FROM roles WHERE id = ?')
    .bind(access.role_id)
    .first<{ name: string }>()

  const token = await signJwt(
    { sub: user.id, company_id, role: roleRow?.name ?? 'viewer' },
    c.env.JWT_SECRET
  )

  // Update last login
  await c.env.DB
    .prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?")
    .bind(user.id).run()

  return c.json({
    success: true,
    data: { token, user: { id: user.id, full_name: user.full_name, email, company_id, role: roleRow?.name } }
  })
})

// GET /api/auth/me
auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ success: false, error: 'غير مصرح' }, 401)

  const payload = await verifyJwt(authHeader.slice(7), c.env.JWT_SECRET)
  if (!payload) return c.json({ success: false, error: 'الجلسة منتهية' }, 401)

  const user = await c.env.DB
    .prepare('SELECT id, email, full_name, phone FROM users WHERE id = ?')
    .bind(payload.sub).first()

  const company = await c.env.DB
    .prepare('SELECT id, code, name FROM companies WHERE id = ?')
    .bind(payload.company_id).first()

  return c.json({ success: true, data: { user, company, role: payload.role } })
})

// GET /api/auth/companies?email=...
auth.get('/companies', async (c) => {
  const email = c.req.query('email')
  if (!email) return c.json({ success: false, error: 'البريد الإلكتروني مطلوب' }, 400)

  const user = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ? AND is_active = 1')
    .bind(email.toLowerCase().trim()).first<{ id: number }>()

  if (!user) return c.json({ success: true, data: [] })

  const { results } = await c.env.DB
    .prepare(`SELECT c.id, c.code, c.name
              FROM companies c
              JOIN user_companies uc ON uc.company_id = c.id
              WHERE uc.user_id = ? AND uc.is_active = 1 AND c.is_active = 1`)
    .bind(user.id).all()

  return c.json({ success: true, data: results })
})

export default auth
