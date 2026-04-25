import { Hono } from 'hono'
import type { Env } from '../types'
import { hashPassword, generateSalt, signJwt, verifyJwt } from '../middleware/auth'
import { authMiddleware, getUser } from '../middleware/auth'

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

  const roleName = roleRow?.name ?? 'viewer'

  const token = await signJwt(
    { sub: user.id, company_id, role: roleName },
    c.env.JWT_SECRET
  )

  // Load permissions for this role
  let permissions: string[] = []
  if (roleName === 'super_admin') {
    const all = await c.env.DB.prepare('SELECT module, action FROM permissions').all<{ module: string; action: string }>()
    permissions = all.results.map(p => `${p.module}.${p.action}`)
  } else {
    const rows = await c.env.DB.prepare(`
      SELECT p.module, p.action
      FROM role_permissions rp
      JOIN roles r ON r.name = ?
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = r.id
    `).bind(roleName).all<{ module: string; action: string }>()
    permissions = rows.results.map(p => `${p.module}.${p.action}`)
  }

  // Update last login
  await c.env.DB
    .prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?")
    .bind(user.id).run()

  return c.json({
    success: true,
    data: { token, user: { id: user.id, full_name: user.full_name, email, company_id, role: roleName }, permissions }
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
    .bind(payload.sub).first<{ id: number; email: string; full_name: string; phone: string }>()

  const company = await c.env.DB
    .prepare('SELECT id, code, name FROM companies WHERE id = ?')
    .bind(payload.company_id).first()

  // Fetch permissions for this user/role
  let permissions: string[] = []
  if (payload.role === 'super_admin') {
    const all = await c.env.DB.prepare('SELECT module, action FROM permissions').all<{ module: string; action: string }>()
    permissions = all.results.map(p => `${p.module}.${p.action}`)
  } else {
    const rows = await c.env.DB.prepare(`
      SELECT p.module, p.action 
      FROM role_permissions rp
      JOIN roles r ON r.name = ?
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = r.id
    `).bind(payload.role).all<{ module: string; action: string }>()
    permissions = rows.results.map(p => `${p.module}.${p.action}`)
  }

  return c.json({ success: true, data: { user, company, role: payload.role, permissions } })
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

// POST /api/auth/change-password (requires auth)
auth.post('/change-password', authMiddleware, async (c) => {
  const { sub: userId } = getUser(c)
  const { current_password, new_password } = await c.req.json<{
    current_password: string; new_password: string
  }>()

  if (!current_password || !new_password) {
    return c.json({ success: false, error: 'كلمة المرور الحالية والجديدة مطلوبتان' }, 400)
  }
  if (new_password.length < 6) {
    return c.json({ success: false, error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' }, 400)
  }

  const user = await c.env.DB
    .prepare('SELECT password_hash, password_salt FROM users WHERE id = ?')
    .bind(userId).first<{ password_hash: string; password_salt: string }>()

  if (!user) return c.json({ success: false, error: 'المستخدم غير موجود' }, 404)

  const currentHash = await hashPassword(current_password, user.password_salt)
  if (currentHash !== user.password_hash) {
    return c.json({ success: false, error: 'كلمة المرور الحالية غير صحيحة' }, 401)
  }

  const newSalt = generateSalt()
  const newHash = await hashPassword(new_password, newSalt)

  await c.env.DB
    .prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .bind(newHash, newSalt, userId).run()

  return c.json({ success: true, data: null, message: 'تم تغيير كلمة المرور بنجاح' })
})

// GET /api/auth/rbac-matrix — full roles × permissions grid (company_admin+)
auth.get('/rbac-matrix', authMiddleware, async (c) => {
  const { role } = getUser(c)
  if (!['super_admin', 'company_admin'].includes(role)) {
    return c.json({ success: false, error: 'يتطلب صلاحية مدير الشركة' }, 403)
  }

  const [rolesRes, permsRes, rpRes] = await Promise.all([
    c.env.DB.prepare('SELECT id, name FROM roles ORDER BY id')
      .all<{ id: number; name: string }>(),
    c.env.DB.prepare('SELECT id, module, action FROM permissions ORDER BY module, action')
      .all<{ id: number; module: string; action: string }>(),
    c.env.DB.prepare('SELECT role_id, permission_id FROM role_permissions')
      .all<{ role_id: number; permission_id: number }>(),
  ])

  const granted = new Set(rpRes.results.map(r => `${r.role_id}:${r.permission_id}`))
  const modules = [...new Set(permsRes.results.map(p => p.module))]

  const matrix = rolesRes.results.map(r => ({
    role: r.name,
    permissions: Object.fromEntries(
      permsRes.results.map(p => [`${p.module}.${p.action}`, granted.has(`${r.id}:${p.id}`)])
    ),
  }))

  return c.json({ success: true, data: {
    roles:        rolesRes.results.map(r => r.name),
    permissions:  permsRes.results.map(p => ({ key: `${p.module}.${p.action}`, module: p.module, action: p.action })),
    modules,
    matrix,
  }})
})

export default auth
