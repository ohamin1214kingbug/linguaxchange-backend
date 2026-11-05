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

// A campus or office network puts many members behind one public address,
// so a limit keyed on the address alone is shared by the whole network: on
// UCM Wi-Fi a handful of classmates signing up or logging in together would
// lock out the rest. Where a request names who it is for, the tight limit is
// keyed on that (the account, the phone) and the address only gets a looser
// ceiling that still stops one machine hammering many accounts.

// The account a login-type request is for: the email on /login, or the
// signed-in member on /change-password and /account/delete.
const accountKey = req => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  return `${keyGenerator(req)}|${email || req.userId || ''}`
}

// Not combined with the address: each send costs money and texts that
// number, so the cap belongs to the phone however many networks ask.
const phoneKey = req => {
  const phone = typeof req.body?.phone_number === 'string' ? req.body.phone_number.replace(/\s/g, '') : ''
  return `phone|${phone}`
}

const ipPhoneKey = req => `${keyGenerator(req)}|${phoneKey(req)}`

function limiter(windowMs, limit, error, options = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    message: { error },
    ...options,
  })
}

const FIFTEEN_MINUTES = 15 * 60 * 1000
const HOUR = 60 * 60 * 1000

// Only failed attempts count, so members logging in normally never use up
// the limit. Per account: guessing one password. Per address: trying one
// password across many accounts.
const loginLimiter = [
  limiter(FIFTEEN_MINUTES, 50, 'Too many login attempts. Please try again in a few minutes.', { skipSuccessfulRequests: true }),
  limiter(FIFTEEN_MINUTES, 10, 'Too many login attempts. Please try again in a few minutes.', { skipSuccessfulRequests: true, keyGenerator: accountKey }),
]

// Signing up already needs a verified phone, which caps fake accounts by
// itself; this only slows a single machine scripting the form.
const registerLimiter = limiter(HOUR, 30, 'Too many accounts created from this network. Please try again later.')

// Each send costs real money (Twilio's per-verification fee), so this is
// the tightest limit — the one endpoint where letting requests through has
// a direct dollar cost, not just abuse risk.
const otpSendLimiter = [
  limiter(HOUR, 20, 'Too many verification codes requested. Please try again later.'),
  limiter(HOUR, 3, 'Too many verification codes requested. Please try again later.', { keyGenerator: phoneKey }),
]

// Twilio itself allows only a few wrong codes per verification; this stops
// one machine cycling through new ones.
const otpCheckLimiter = [
  limiter(HOUR, 50, 'Too many attempts. Please request a new code and try again.'),
  limiter(HOUR, 10, 'Too many attempts. Please request a new code and try again.', { keyGenerator: ipPhoneKey }),
]

// Public, unauthenticated browse/lookup routes have no other throttle —
// without this, bulk-scraping (e.g. iterating user IDs) is unthrottled.
const publicGetLimiter = limiter(60 * 1000, 100, 'Too many requests. Please slow down.')

// Sending has no per-message cost on the current Resend plan, but the monthly
// allowance is finite and an unthrottled send endpoint is a spam relay pointed
// at arbitrary addresses. The route requires sign-in, so the tight limit is
// per member.
const verifyEmailLimiter = [
  limiter(HOUR, 20, 'Too many verification emails requested. Please try again later.'),
  limiter(HOUR, 5, 'Too many verification emails requested. Please try again later.', { keyGenerator: req => `user|${req.userId}` }),
]

module.exports = { keyGenerator, accountKey, phoneKey, loginLimiter, registerLimiter, otpSendLimiter, otpCheckLimiter, publicGetLimiter, verifyEmailLimiter }
