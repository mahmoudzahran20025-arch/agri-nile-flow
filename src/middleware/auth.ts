import type { Context, Next } from 'hono'
import type { Env, JwtPayload } from '../types'

// ─── PBKDF2 via Web Crypto (no external deps) ────────────────
export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' },
    key, 256
  )
  return btoa(String.fromCharCode(...new Uint8Array(bits)))
}

export function generateSalt(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return btoa(String.fromCharCode(...arr))
}

// ─── JWT (HMAC-SHA256, no external lib) ──────────────────────
function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64url(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  )
}

export async function signJwt(payload: Omit<JwtPayload, 'exp'>, secret: string, ttlSeconds = 86_400): Promise<string> {
  const header  = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body    = b64url(new TextEncoder().encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })))
  const sig     = b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(`${header}.${body}`)))
  return `${header}.${body}.${sig}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const [h, b, s] = token.split('.')
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(s), new TextEncoder().encode(`${h}.${b}`))
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(b))) as JwtPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ─── Middleware ───────────────────────────────────────────────
export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'غير مصرح', code: 'UNAUTHORIZED' }, 401)
  }

  const token   = authHeader.slice(7)
  const payload = await verifyJwt(token, c.env.JWT_SECRET)
  if (!payload) {
    return c.json({ success: false, error: 'الجلسة منتهية أو غير صالحة', code: 'INVALID_TOKEN' }, 401)
  }

  c.set('user' as never, payload)
  await next()
}

export function getUser(c: Context): JwtPayload {
  return c.get('user' as never) as JwtPayload
}

// Enforce company_id from JWT — never trust client for tenant scoping
export function requireCompany(c: Context, requestedCompanyId?: number): number {
  const user = getUser(c)
  if (requestedCompanyId && requestedCompanyId !== user.company_id && user.role !== 'super_admin') {
    throw new Error('FORBIDDEN')
  }
  return user.company_id
}
