const twilio = require('twilio')

const client = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null

// E.164: a leading + followed by 7-15 digits, first digit non-zero.
const E164_RE = /^\+[1-9]\d{6,14}$/

function isValidPhoneNumber(phone) {
  return typeof phone === 'string' && E164_RE.test(phone)
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
    return { ok: false, error: e.message }
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

module.exports = { sendOtp, checkOtp, isValidPhoneNumber }
