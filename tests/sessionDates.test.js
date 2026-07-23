const { buildSessionDates, MAX_RECURRING_SESSIONS } = require('../utils/sessionDates')

describe('buildSessionDates', () => {
  test('returns a single session when no recurrence type is given', () => {
    const dates = buildSessionDates('2026-01-01T10:00:00.000Z', null, null)
    expect(dates).toHaveLength(1)
    expect(dates[0].toISOString()).toBe('2026-01-01T10:00:00.000Z')
  })

  test('returns a single session when no end date is given', () => {
    const dates = buildSessionDates('2026-01-01T10:00:00.000Z', 'weekly', null)
    expect(dates).toHaveLength(1)
  })

  test('generates weekly sessions 7 days apart up to the end date', () => {
    const dates = buildSessionDates('2026-01-01T10:00:00.000Z', 'weekly', '2026-01-22T10:00:00.000Z')
    expect(dates).toHaveLength(4)
    expect(dates.map(d => d.toISOString())).toEqual([
      '2026-01-01T10:00:00.000Z',
      '2026-01-08T10:00:00.000Z',
      '2026-01-15T10:00:00.000Z',
      '2026-01-22T10:00:00.000Z'
    ])
  })

  test('generates biweekly sessions 14 days apart', () => {
    const dates = buildSessionDates('2026-01-01T10:00:00.000Z', 'biweekly', '2026-02-01T10:00:00.000Z')
    expect(dates).toHaveLength(3)
    expect(dates.map(d => d.toISOString())).toEqual([
      '2026-01-01T10:00:00.000Z',
      '2026-01-15T10:00:00.000Z',
      '2026-01-29T10:00:00.000Z'
    ])
  })

  test('generates monthly sessions on the same day each month', () => {
    const dates = buildSessionDates('2026-01-15T10:00:00.000Z', 'monthly', '2026-04-15T10:00:00.000Z')
    expect(dates).toHaveLength(4)
    expect(dates.map(d => d.toISOString())).toEqual([
      '2026-01-15T10:00:00.000Z',
      '2026-02-15T10:00:00.000Z',
      '2026-03-15T10:00:00.000Z',
      '2026-04-15T10:00:00.000Z'
    ])
  })

  test('excludes occurrences that fall after the end date', () => {
    // one hour past the 3rd weekly occurrence — 4th occurrence (day 21) should NOT be included
    const dates = buildSessionDates('2026-01-01T10:00:00.000Z', 'weekly', '2026-01-15T11:00:00.000Z')
    expect(dates).toHaveLength(3)
  })

  test('caps generation at MAX_RECURRING_SESSIONS even with a huge date range', () => {
    const dates = buildSessionDates('2026-01-01T10:00:00.000Z', 'weekly', '2030-01-01T10:00:00.000Z')
    expect(dates).toHaveLength(MAX_RECURRING_SESSIONS)
  })

  test('unknown recurrence type falls back to a 7-day step', () => {
    const dates = buildSessionDates('2026-01-01T10:00:00.000Z', 'daily', '2026-01-08T10:00:00.000Z')
    expect(dates).toHaveLength(2)
    expect(dates[1].toISOString()).toBe('2026-01-08T10:00:00.000Z')
  })
})
