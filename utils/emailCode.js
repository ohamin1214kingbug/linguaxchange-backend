// Sign-up email codes. Nothing is stored: sending a code returns a signed
// token holding an HMAC of (email, code). The HMAC key is the server secret,
// so the browser holding the token can't work the code out from it; it has
// to read the email. A correct code then earns a second token that
// /register requires for that same email.
// ponytail: a token can't count its own wrong guesses; the per-machine and
// per-address limits in middleware/rateLimit.js do. Store codes in a table
// if guessing ever shows up in the logs.
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { renderEmail } = require('./emailTemplate')

const CODE_TTL = '15m'
const VERIFIED_TTL = '1h'

const normalize = email => String(email || '').trim().toLowerCase()
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0')
const fingerprint = (email, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${normalize(email)}|${code}`).digest('hex')

function issueCodeToken(email, code) {
  return jwt.sign({ purpose: 'email_code', email: normalize(email), h: fingerprint(email, code) }, process.env.JWT_SECRET, { expiresIn: CODE_TTL })
}

// { ok: true } or { ok: false, error }.
function checkCode(codeToken, email, code) {
  let payload
  try { payload = jwt.verify(codeToken, process.env.JWT_SECRET) } catch {
    return { ok: false, error: 'This code has expired. Send a new one.' }
  }
  if (payload.purpose !== 'email_code' || payload.email !== normalize(email)) return { ok: false, error: 'Send a new code to this email.' }
  const given = Buffer.from(fingerprint(email, String(code || '').trim()))
  const expected = Buffer.from(payload.h)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, error: 'That code is not right.' }
  return { ok: true }
}

function issueVerifiedToken(email) {
  return jwt.sign({ purpose: 'email_verified', email: normalize(email) }, process.env.JWT_SECRET, { expiresIn: VERIFIED_TTL })
}

function isVerifiedFor(token, email) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    return payload.purpose === 'email_verified' && payload.email === normalize(email)
  } catch {
    return false
  }
}

function codeEmail(code) {
  return {
    subject: `Your GongbuLeng code: ${code}`,
    ...renderEmail({
      heading: 'Your GongbuLeng code',
      paragraphs: [`Your code is ${code}. Enter it on the sign-up page to confirm this is your email. It works for 15 minutes.`],
      footnote: "Didn't sign up? Ignore this email; no account is created without the code.",
    }),
  }
}

module.exports = { newCode, issueCodeToken, checkCode, issueVerifiedToken, isVerifiedFor, codeEmail, normalize }
