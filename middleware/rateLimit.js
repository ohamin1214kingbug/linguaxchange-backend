const rateLimit = require('express-rate-limit')

// Keyed by IP (via req.ip, which requires app.set('trust proxy', 1) in
// index.js to reflect the real client behind Railway's proxy). Generous
// enough to not lock out someone mistyping a password a few times or a
// shared office/NAT network, tight enough to make brute-forcing or mass
// account creation impractical.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' }
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
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
  legacyHeaders: false,
  message: { error: 'Too many verification codes requested. Please try again later.' }
})

const otpCheckLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please request a new code and try again.' }
})

// Public, unauthenticated browse/lookup routes have no other throttle —
// without this, bulk-scraping (e.g. iterating user IDs) is unthrottled.
const publicGetLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
})

module.exports = { loginLimiter, registerLimiter, otpSendLimiter, otpCheckLimiter, publicGetLimiter }
