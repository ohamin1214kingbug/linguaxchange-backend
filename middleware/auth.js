const jwt = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')
const { isTokenStillValid } = require('../utils/tokenRevocation')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) return res.status(401).json({ error: 'Missing or invalid Authorization header' })

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    // JWTs can't be deleted once issued — logout and password-reset instead
    // bump this per-user cutoff, and any token issued before it is rejected
    // even though it hasn't expired yet.
    const { data: user } = await supabase
      .from('users')
      .select('token_valid_after')
      .eq('id', payload.userId)
      .single()

    if (!isTokenStillValid(payload.iat, user?.token_valid_after)) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    req.userId = payload.userId
    next()
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

async function requireAdmin(req, res, next) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('email')
      .eq('id', req.userId)
      .single()

    if (error || !user || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      return res.status(403).json({ error: 'Admin access required' })
    }
    next()
  } catch (e) {
    res.status(500).json({ error: 'Could not verify admin access' })
  }
}

// Boolean check (not middleware) for routes that need "owner OR admin"
// rather than "admin only" — e.g. a teacher editing their own class.
async function isAdmin(userId) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .single()
    return !error && !!user && ADMIN_EMAILS.includes(user.email.toLowerCase())
  } catch (e) {
    return false
  }
}

module.exports = { requireAuth, requireAdmin, isAdmin }
