// computeReminderWindow/formatSessionTime are pure, but the module also
// creates a Supabase client at import time — mock it out so this stays a
// fast, isolated unit test with no network/DB dependency.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({})
}))

const { computeReminderWindow, formatSessionTime } = require('../utils/classReminder')

describe('computeReminderWindow', () => {
  test('window is 55 to 65 minutes from now', () => {
    const now = new Date('2026-07-25T12:00:00.000Z')
    const { from, to } = computeReminderWindow(now)
    expect(from.toISOString()).toBe('2026-07-25T12:55:00.000Z')
    expect(to.toISOString()).toBe('2026-07-25T13:05:00.000Z')
  })

  test('window is exactly 10 minutes wide, comfortably exceeding a 5-10 min poll interval', () => {
    const { from, to } = computeReminderWindow(new Date('2026-01-01T00:00:00.000Z'))
    expect(to.getTime() - from.getTime()).toBe(10 * 60 * 1000)
  })
})

describe('formatSessionTime', () => {
  test('falls back to UTC with an explicit note when no timezone is given (Feature 3 not built yet)', () => {
    const result = formatSessionTime('2026-07-25T14:30:00.000Z', undefined)
    expect(result.isUtcFallback).toBe(true)
    expect(result.display).toBe('Jul 25, 2026, 2:30 PM UTC')
    expect(result.note).toMatch(/UTC/)
  })

  test('renders in the given IANA timezone with no fallback note when one is provided', () => {
    const result = formatSessionTime('2026-07-25T14:30:00.000Z', 'Asia/Seoul')
    expect(result.isUtcFallback).toBe(false)
    expect(result.display).toBe('Jul 25, 2026, 11:30 PM')
    expect(result.note).toBeNull()
  })
})
