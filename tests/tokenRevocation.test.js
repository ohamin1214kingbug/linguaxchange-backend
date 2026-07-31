const { isTokenStillValid } = require('../utils/tokenRevocation')

describe('isTokenStillValid', () => {
  const iat = 1785000000 // arbitrary fixed "issued at" in seconds

  test('valid when no cutoff has ever been set', () => {
    expect(isTokenStillValid(iat, null)).toBe(true)
    expect(isTokenStillValid(iat, undefined)).toBe(true)
  })

  test('invalid when the token was issued before the cutoff (logout/reset happened after)', () => {
    const cutoff = new Date((iat + 3600) * 1000).toISOString()
    expect(isTokenStillValid(iat, cutoff)).toBe(false)
  })

  test('valid when the token was issued after the cutoff (logged in again since)', () => {
    const cutoff = new Date((iat - 3600) * 1000).toISOString()
    expect(isTokenStillValid(iat, cutoff)).toBe(true)
  })

  test('valid at the exact cutoff instant', () => {
    const cutoff = new Date(iat * 1000).toISOString()
    expect(isTokenStillValid(iat, cutoff)).toBe(true)
  })
})
