const { isImplicitAutoSync, isValidTimezone } = require('../utils/timezonePolicy')

describe('isValidTimezone', () => {
  test('accepts IANA names and "not set yet"', () => {
    expect(isValidTimezone('Europe/Madrid')).toBe(true)
    expect(isValidTimezone('Asia/Seoul')).toBe(true)
    expect(isValidTimezone(null)).toBe(true)
    expect(isValidTimezone('')).toBe(true)
  })

  test('rejects names Intl cannot use, and non-strings', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
    expect(isValidTimezone('Madrid')).toBe(false)
    expect(isValidTimezone(42)).toBe(false)
  })
})

// Only an implicit auto-sync may be suppressed for a manual user. The first
// version of this guard asked "is the incoming source not 'manual'?", which
// also swallowed the reset-to-auto-detect save — the user ended up flagged
// 'auto' but still pinned to their old manual zone.
describe('isImplicitAutoSync', () => {
  test('login-time sync sends only a timezone — suppressible', () => {
    expect(isImplicitAutoSync({ timezone: 'America/New_York' })).toBe(true)
  })

  test('picking a zone in settings is never suppressed', () => {
    expect(isImplicitAutoSync({ timezone: 'Europe/Madrid', timezone_source: 'manual' })).toBe(false)
  })

  test('reset to auto-detect is never suppressed (the bug this caught)', () => {
    expect(isImplicitAutoSync({ timezone: 'Asia/Seoul', timezone_source: 'auto' })).toBe(false)
  })

  test('edits that do not touch the timezone are irrelevant', () => {
    expect(isImplicitAutoSync({ bio: 'hello' })).toBe(false)
    expect(isImplicitAutoSync({})).toBe(false)
  })

  test('a time_format-only save is not mistaken for a sync', () => {
    expect(isImplicitAutoSync({ time_format: '24h' })).toBe(false)
  })
})
