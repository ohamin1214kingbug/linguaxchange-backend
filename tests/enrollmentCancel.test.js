const { canRefundCancellation } = require('../utils/enrollmentCancel')

describe('canRefundCancellation', () => {
  const now = new Date('2026-08-01T12:00:00Z')

  test('refunds when cancelled well before the 24h cutoff', () => {
    expect(canRefundCancellation('2026-08-05T12:00:00Z', now)).toBe(true)
  })

  test('does not refund when cancelled inside 24h of the session', () => {
    expect(canRefundCancellation('2026-08-01T20:00:00Z', now)).toBe(false)
  })

  test('refunds at the exact 24h boundary', () => {
    expect(canRefundCancellation('2026-08-02T12:00:00Z', now)).toBe(true)
  })

  test('does not refund for a session already in the past', () => {
    expect(canRefundCancellation('2026-07-30T12:00:00Z', now)).toBe(false)
  })
})
