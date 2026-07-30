const { isValidPhoneNumber } = require('../utils/phoneVerify')

describe('isValidPhoneNumber', () => {
  test('accepts valid E.164 numbers', () => {
    expect(isValidPhoneNumber('+14155551234')).toBe(true)
    expect(isValidPhoneNumber('+821012345678')).toBe(true)
    expect(isValidPhoneNumber('+34612345678')).toBe(true)
  })

  test('rejects numbers missing the + prefix', () => {
    expect(isValidPhoneNumber('14155551234')).toBe(false)
  })

  test('rejects numbers with a leading zero after +', () => {
    expect(isValidPhoneNumber('+04155551234')).toBe(false)
  })

  test('rejects too-short or too-long numbers', () => {
    expect(isValidPhoneNumber('+123456')).toBe(false)
    expect(isValidPhoneNumber('+1234567890123456')).toBe(false)
  })

  test('rejects non-numeric or malformed input', () => {
    expect(isValidPhoneNumber('+1abc5551234')).toBe(false)
    expect(isValidPhoneNumber('')).toBe(false)
    expect(isValidPhoneNumber(null)).toBe(false)
    expect(isValidPhoneNumber(undefined)).toBe(false)
  })
})
