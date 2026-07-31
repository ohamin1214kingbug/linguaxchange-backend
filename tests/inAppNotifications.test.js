jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({})
}))

const { computeStartingSoonWindow, computeLiveWindow } = require('../utils/inAppNotifications')

describe('computeStartingSoonWindow', () => {
  test('covers 8-13 minutes from now', () => {
    const now = new Date('2026-08-01T12:00:00Z')
    const { from, to } = computeStartingSoonWindow(now)
    expect(from.toISOString()).toBe('2026-08-01T12:08:00.000Z')
    expect(to.toISOString()).toBe('2026-08-01T12:13:00.000Z')
  })
})

describe('computeLiveWindow', () => {
  test('covers the 5 minutes up to now', () => {
    const now = new Date('2026-08-01T12:00:00Z')
    const { from, to } = computeLiveWindow(now)
    expect(from.toISOString()).toBe('2026-08-01T11:55:00.000Z')
    expect(to.toISOString()).toBe(now.toISOString())
  })
})
