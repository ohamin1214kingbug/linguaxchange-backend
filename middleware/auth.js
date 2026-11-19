const jwt = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')
const { isTokenStillValid } = require('../utils/tokenRevocation')
const { isSuspended } = require('../utils/suspension')

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
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('token_valid_after, suspended_until, suspension_reason, phone_verified')
      .eq('id', payload.userId)
      .single()

    // Fail closed. This row carries both the suspension and the revocation
    // cutoff; without it neither check below can run. Reading only `data`
    // used to let a failed lookup through as "not suspended, not revoked".
    if (userError || !user) return res.status(401).json({ error: 'Invalid or expired token' })

    // Before the token-revocation check, not after: suspending bumps
    // token_valid_after too, so with the order reversed every suspended
    // user saw "Invalid or expired token" and never the reason or the end
    // date. Costs no extra query — this row is already fetched.
    const suspension = isSuspended({ suspendedUntil: user?.suspended_until })
    if (suspension.suspended) {
      return res.status(403).json({
        error: 'Your account is suspended',
        suspended_until: suspension.until.toISOString(),
        reason: user.suspension_reason || null
      })
    }

    if (!isTokenStillValid(payload.iat, user?.token_valid_after)) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    req.userId = payload.userId
    req.phoneVerified = user.phone_verified === true
    next()
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// After requireAuth, on actions that reach other members for free (tandems,
// tandem groups, creating or offering to teach a class). Joining a class
// already needs bananas, which only a verified phone unlocks; without this,
// a Google account that skipped the phone step could still message and
// notify real members (owner report, 2026-11-19). The error is a
// translation key: the pages show it with t(), and code lets them link to
// the phone page. Reports stay open to everyone.
function requireVerifiedPhone(req, res, next) {
  if (req.phoneVerified) return next()
  res.status(403).json({ error: 'common.phoneRequired', code: 'PHONE_REQUIRED' })
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

// Admin rights come from ADMIN_EMAILS, so they also need the address to be
// proven (email code or Google). Otherwise registering an admin's address
// before they do would hand over the admin page.
function isAdminUser(user) {
  return Boolean(user?.email_verified_at) && ADMIN_EMAILS.includes(String(user.email).toLowerCase())
}

async function requireAdmin(req, res, next) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('email, email_verified_at')
      .eq('id', req.userId)
      .single()

    if (error || !isAdminUser(user)) {
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
      .select('email, email_verified_at')
      .eq('id', userId)
      .single()
    return !error && isAdminUser(user)
  } catch (e) {
    return false
  }
}

module.exports = { requireAuth, requireAdmin, isAdmin, isAdminUser, requireVerifiedPhone }
