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

module.exports = { loginLimiter, registerLimiter }
