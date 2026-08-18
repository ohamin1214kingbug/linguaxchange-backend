const { otpErrorKey } = require('../utils/phoneVerify')

// The bug this guards against isn't a crash — it's blaming the visitor.
// A Twilio trial restriction used to surface as "check the number and try
// again", which sent a real debugging session chasing a phone number that
// was never the problem.
describe('otpErrorKey', () => {
  test('numbers that genuinely cannot receive an SMS blame the number', () => {
    expect(otpErrorKey(21211)).toBe('auth.otpBadNumber') // invalid 'To'
    expect(otpErrorKey(60200)).toBe('auth.otpBadNumber') // invalid parameter
    expect(otpErrorKey(60205)).toBe('auth.otpBadNumber') // landline
  })

  test('rate limits tell the visitor to wait, not to edit the number', () => {
    expect(otpErrorKey(60203)).toBe('auth.otpTooManyAttempts')
    expect(otpErrorKey(60212)).toBe('auth.otpTooManyAttempts')
  })

  test('our own account and config failures never blame the number', () => {
    const ours = [
      21608, // trial account, unverified number — the one that misled us
      21408, // region not enabled for SMS
      20003, // bad credentials
      20404  // Verify service SID missing/wrong
    ]
    for (const code of ours) {
      expect(otpErrorKey(code)).toBe('auth.otpUnavailable')
    }
  })

  test('an unknown or absent code is treated as ours, not theirs', () => {
    // Safer default: an unrecognised failure is more likely our problem than
    // a visitor typo, and "try again later" is never actively misleading.
    expect(otpErrorKey(99999)).toBe('auth.otpUnavailable')
    expect(otpErrorKey(undefined)).toBe('auth.otpUnavailable')
  })
})
