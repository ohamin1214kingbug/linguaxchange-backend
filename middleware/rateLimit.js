const crypto = require('crypto')
const rateLimit = require('express-rate-limit')
const { ipKeyGenerator } = rateLimit

// Keyed by IP (via req.ip, which requires app.set('trust proxy', 2) in
// index.js to reflect the real client behind Railway's proxies). Generous
// enough to not lock out someone mistyping a password a few times or a
// shared office/NAT network, tight enough to make brute-forcing or mass
// account creation impractical.
// Browsers reach the API through gongbuleng.com's proxy (frontend proxy.js),
// because UCM's campus DNS blocks Railway hostnames. Those requests arrive
// from Vercel's servers, so req.ip alone would put every visitor in one
// bucket and a few bad logins anywhere would lock everyone out. The proxy
// passes the visitor's address in x-client-ip (Vercel overwrites
// X-Forwarded-For, so the browser can't choose it) together with a shared
// secret. The header is trusted only with that secret: without the check,
// anyone calling Railway directly could name their own bucket and dodge
// every limit below.
function proxiedClientIp(req) {
  const secret = process.env.API_PROXY_SECRET
  const given = req.get('x-proxy-secret')
  if (!secret || !given) return null
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return req.get('x-client-ip') || null
}

const keyGenerator = req => ipKeyGenerator(proxiedClientIp(req) || req.ip)

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  keyGenerator,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' }
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  keyGenerator,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this network. Please try again later.' }
})

// Each send costs real money (Twilio's per-verification fee), so this is
// tighter than the other limiters — it's the one endpoint where letting
// requests through unchecked has a direct dollar cost, not just abuse risk.
const otpSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  keyGenerator,
  legacyHeaders: false,
  message: { error: 'Too many verification codes requested. Please try again later.' }
})

const otpCheckLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  keyGenerator,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please request a new code and try again.' }
})

// Public, unauthenticated browse/lookup routes have no other throttle —
// without this, bulk-scraping (e.g. iterating user IDs) is unthrottled.
const publicGetLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  keyGenerator,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
})

// Sending has no per-message cost on the current Resend plan, but the monthly
// allowance is finite and an unthrottled send endpoint is a spam relay pointed
// at arbitrary addresses. Same shape as otpSendLimiter.
const verifyEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  keyGenerator,
  legacyHeaders: false,
  message: { error: 'Too many verification emails requested. Please try again later.' }
})

module.exports = { keyGenerator, loginLimiter, registerLimiter, otpSendLimiter, otpCheckLimiter, publicGetLimiter, verifyEmailLimiter }
