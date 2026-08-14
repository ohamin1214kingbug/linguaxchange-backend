const { isTokenStillValid } = require('../utils/tokenRevocation')

// /change-password bumps token_valid_after (killing every other device's
// token) and then issues a fresh token for the current device. Those two
// steps must not race each other: jwt's `iat` claim is whole seconds, so a
// cutoff that still carries milliseconds lands *after* the new token's iat
// and kills the token it just handed out — the user changes their password
// and is immediately logged out with a valid-looking token.
//
// The route guards this with cutoff.setMilliseconds(0). These assert that
// guard actually works, and that removing it would break.
describe('password-change cutoff vs. the token issued right after it', () => {
  const MID_SECOND = 1785000000500 // .500 into the second
  const zeroed = ms => { const d = new Date(ms); d.setMilliseconds(0); return d.toISOString() }
  const iatOf = ms => Math.floor(ms / 1000) // what jwt.sign() stamps

  test('token issued in the same second as the cutoff survives', () => {
    expect(isTokenStillValid(iatOf(MID_SECOND), zeroed(MID_SECOND))).toBe(true)
  })

  test('without zeroing the ms, that same token would be rejected', () => {
    expect(isTokenStillValid(iatOf(MID_SECOND), new Date(MID_SECOND).toISOString())).toBe(false)
  })

  test('tokens issued before the change are still rejected', () => {
    expect(isTokenStillValid(iatOf(MID_SECOND) - 1, zeroed(MID_SECOND))).toBe(false)
  })

  test('a token issued a second later is fine', () => {
    expect(isTokenStillValid(iatOf(MID_SECOND) + 1, zeroed(MID_SECOND))).toBe(true)
  })
})
