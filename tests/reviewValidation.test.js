const { isValidRating } = require('../utils/reviewValidation')

describe('isValidRating', () => {
  test('accepts integers 1 through 5', () => {
    for (let r = 1; r <= 5; r++) expect(isValidRating(r)).toBe(true)
  })

  test('rejects out-of-range values', () => {
    expect(isValidRating(0)).toBe(false)
    expect(isValidRating(6)).toBe(false)
    expect(isValidRating(-1)).toBe(false)
  })

  test('rejects non-integers and NaN', () => {
    expect(isValidRating(3.5)).toBe(false)
    expect(isValidRating(NaN)).toBe(false)
  })
})
