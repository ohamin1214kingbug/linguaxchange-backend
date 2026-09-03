const { isSuspended } = require('../utils/suspension')

const NOW = new Date('2026-09-03T12:00:00Z')
const hours = n => new Date(NOW.getTime() + n * 60 * 60 * 1000)

describe('isSuspended', () => {
  test('a null column is not a suspension', () => {
    expect(isSuspended({ suspendedUntil: null, now: NOW }).suspended).toBe(false)
  })

  test('a future date is an active suspension', () => {
    expect(isSuspended({ suspendedUntil: hours(24), now: NOW }).suspended).toBe(true)
  })

  // Suspensions lapse on their own — nothing sweeps the column — so the
  // check has to be a comparison, not a NULL test.
  test('a past date has lapsed', () => {
    expect(isSuspended({ suspendedUntil: hours(-1), now: NOW }).suspended).toBe(false)
  })

  test('an ISO string works as well as a Date', () => {
    expect(isSuspended({ suspendedUntil: hours(24).toISOString(), now: NOW }).suspended).toBe(true)
  })

  test('reports when it ends, so the user can be told', () => {
    expect(isSuspended({ suspendedUntil: hours(24), now: NOW }).until.getTime()).toBe(hours(24).getTime())
  })

  // Bad data must not become an accidental permanent ban. Refusing to guess
  // keeps the failure in the logs rather than locking someone out.
  test('an unparseable value is not treated as a suspension', () => {
    expect(isSuspended({ suspendedUntil: 'whenever', now: NOW }).suspended).toBe(false)
  })
})
