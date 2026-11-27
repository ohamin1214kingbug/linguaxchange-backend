// The link in the admin's blocked-country email (utils/adminNotify.js) that
// opens the "send them the branded email" page (routes/admin.js). It has to
// carry the member's email, so it is sealed (AES-256-GCM, key derived from
// JWT_SECRET) rather than just signed: a URL ends up in logs and history, and
// a signed token can still be read. Expires after 7 days.
const crypto = require('crypto')

const TTL_MS = 7 * 24 * 60 * 60 * 1000
const keyFrom = secret => crypto.createHash('sha256').update(`${secret}:blocked-reply`).digest()

function sealReply(data, { secret = process.env.JWT_SECRET, now = Date.now() } = {}) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify({ ...data, exp: now + TTL_MS })), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

// The data, or null when tampered with, expired or not a token at all.
function openReply(token, { secret = process.env.JWT_SECRET, now = Date.now() } = {}) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url')
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'))
    return data.exp > now ? data : null
  } catch { return null }
}

module.exports = { sealReply, openReply, TTL_MS }
