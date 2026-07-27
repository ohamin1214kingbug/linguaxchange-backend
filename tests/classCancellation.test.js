// hasFutureSession is pure, but the module also creates a Supabase client
// (and imports the mailer, which creates a Resend client) at import time —
// mock supabase-js out so this stays a fast, isolated unit test.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({})
}))

const { hasFutureSession } = require('../utils/classCancellation')

describe('hasFutureSession', () => {
  const now = new Date('2026-07-26T12:00:00.000Z')

  test('true when at least one session is scheduled and in the future', () => {
    const sessions = [
      { status: 'completed', session_date: '2026-07-20T12:00:00.000Z' },
      { status: 'scheduled', session_date: '2026-08-01T12:00:00.000Z' },
    ]
    expect(hasFutureSession(sessions, now)).toBe(true)
  })

  test('false when every session is in the past', () => {
    const sessions = [
      { status: 'completed', session_date: '2026-07-01T12:00:00.000Z' },
      { status: 'scheduled', session_date: '2026-07-02T12:00:00.000Z' },
    ]
    expect(hasFutureSession(sessions, now)).toBe(false)
  })

  test('false when a future session exists but is already cancelled', () => {
    const sessions = [
      { status: 'cancelled', session_date: '2026-08-01T12:00:00.000Z' },
    ]
    expect(hasFutureSession(sessions, now)).toBe(false)
  })

  test('false for an empty or missing session list', () => {
    expect(hasFutureSession([], now)).toBe(false)
    expect(hasFutureSession(undefined, now)).toBe(false)
  })

  test('true for a recurring class where only some sessions remain', () => {
    const sessions = [
      { status: 'completed', session_date: '2026-07-01T12:00:00.000Z' },
      { status: 'completed', session_date: '2026-07-08T12:00:00.000Z' },
      { status: 'scheduled', session_date: '2026-07-15T12:00:00.000Z' }, // past but still 'scheduled'
      { status: 'scheduled', session_date: '2026-08-15T12:00:00.000Z' },
    ]
    expect(hasFutureSession(sessions, now)).toBe(true)
  })
})
