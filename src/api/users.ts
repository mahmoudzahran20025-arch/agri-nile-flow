import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware, getUser, hashPassword, generateSalt } from '../middleware/auth'

const users = new Hono<{ Bindings: Env }>()
users.use('*', authMiddleware)

// GET /api/users — list all users in the caller's company
users.get('/', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.last_login,
           r.name AS role
    FROM users u
    JOIN user_companies uc ON uc.user_id = u.id
    JOIN roles r ON r.id = uc.role_id
    WHERE uc.company_id = ? AND uc.is_active = 1
    ORDER BY u.full_name
  `).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// POST /api/users — create user + assign to caller's company
users.post('/', async (c) => {
  const { company_id, role: callerRole } = getUser(c)
  if (callerRole !== 'super_admin' && callerRole !== 'company_admin') {
    return c.json({ success: false, error: 'غير مصرح بإضافة مستخدمين' }, 403)
  }

  const b = await c.req.json<{
    email: string; full_name: string; password: string; role: string; phone?: string
  }>()

  if (!b.email || !b.full_name || !b.password || !b.role) {
    return c.json({ success: false, error: 'البريد والاسم وكلمة المرور والدور مطلوبة' }, 400)
  }

  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(b.email.toLowerCase().trim()).first<{ id: number }>()

  let userId: number

  if (existing) {
    userId = existing.id
  } else {
    const salt = generateSalt()
    const hash = await hashPassword(b.password, salt)
    const result = await c.env.DB.prepare(
      'INSERT INTO users (email, password_hash, password_salt, full_name, phone, is_active) VALUES (?,?,?,?,?,1)'
    ).bind(b.email.toLowerCase().trim(), hash, salt, b.full_name.trim(), b.phone ?? null).run()
    userId = result.meta.last_row_id as number
  }

  const roleRow = await c.env.DB
    .prepare('SELECT id FROM roles WHERE name = ?')
    .bind(b.role).first<{ id: number }>()

  if (!roleRow) return c.json({ success: false, error: 'الدور المحدد غير موجود' }, 400)

  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO user_companies (user_id, company_id, role_id, is_active) VALUES (?,?,?,1)'
  ).bind(userId, company_id, roleRow.id).run()

  return c.json({ success: true, data: { id: userId } }, 201)
})

// PATCH /api/users/:id — update name, role, or active status
users.patch('/:id', async (c) => {
  const { company_id, role: callerRole } = getUser(c)
  if (callerRole !== 'super_admin' && callerRole !== 'company_admin') {
    return c.json({ success: false, error: 'غير مصرح بتعديل المستخدمين' }, 403)
  }

  const id = Number(c.req.param('id'))
  const b  = await c.req.json<{ full_name?: string; role?: string; is_active?: number }>()

  if (b.full_name) {
    await c.env.DB
      .prepare('UPDATE users SET full_name = ? WHERE id = ?')
      .bind(b.full_name.trim(), id).run()
  }

  if (b.role) {
    const roleRow = await c.env.DB
      .prepare('SELECT id FROM roles WHERE name = ?')
      .bind(b.role).first<{ id: number }>()
    if (roleRow) {
      await c.env.DB
        .prepare('UPDATE user_companies SET role_id = ? WHERE user_id = ? AND company_id = ?')
        .bind(roleRow.id, id, company_id).run()
    }
  }

  if (b.is_active !== undefined) {
    await c.env.DB
      .prepare('UPDATE user_companies SET is_active = ? WHERE user_id = ? AND company_id = ?')
      .bind(b.is_active, id, company_id).run()
  }

  return c.json({ success: true, data: null })
})

export default users
