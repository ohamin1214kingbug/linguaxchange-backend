const twilio = require('twilio')

const client = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null

// E.164: a leading + followed by 7-15 digits, first digit non-zero.
const E164_RE = /^\+[1-9]\d{6,14}$/

function isValidPhoneNumber(phone) {
  return typeof phone === 'string' && E164_RE.test(phone)
}

// Keyed on Twilio's numeric error codes, never the message text — Twilio
// rewords those without notice.
//
// Only codes the VISITOR can actually act on get a "fix your number" style
// message. Everything absent from this map — trial-account restrictions
// (21608), region not enabled (21408), bad credentials (20003), missing
// Verify service (20404) — is our configuration, not their typo, and telling
// them to re-check a perfectly good number just sends them in circles.
const USER_FIXABLE = {
  21211: 'auth.otpBadNumber',        // invalid 'To' number
  60200: 'auth.otpBadNumber',        // invalid parameter, in practice the number
  60205: 'auth.otpBadNumber',        // landline — can't receive SMS
  60203: 'auth.otpTooManyAttempts',  // max send attempts for this number
  60212: 'auth.otpTooManyAttempts'   // too many concurrent requests
}

function otpErrorKey(code) {
  return USER_FIXABLE[code] || 'auth.otpUnavailable'
}

async function sendOtp(phoneNumber) {
  if (!client || !process.env.TWILIO_VERIFY_SID) {
    return { ok: false, error: 'Phone verification is not configured' }
  }
  try {
    await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verifications.create({ to: phoneNumber, channel: 'sms' })
    return { ok: true }
  } catch (e) {
    // `code` is what makes a failure diagnosable — it's the thing you can
    // look up, unlike the prose.
    return { ok: false, code: e.code, error: e.message }
  }
}

// Twilio Verify consumes the code on check — it doesn't persist a
// "verified" state, so the caller is responsible for recording that
// (see routes/auth.js signing a short-lived token after a true result).
async function checkOtp(phoneNumber, code) {
  if (!client || !process.env.TWILIO_VERIFY_SID) {
    return { ok: false, error: 'Phone verification is not configured' }
  }
  try {
    const result = await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verificationChecks.create({ to: phoneNumber, code })
    return { ok: result.status === 'approved' }
  } catch (e) {
    // Twilio throws (rather than returning a status) for things like an
    // already-consumed or expired code — treat the same as "not approved".
    return { ok: false, error: e.message }
  }
}

module.exports = { sendOtp, checkOtp, isValidPhoneNumber, otpErrorKey }
