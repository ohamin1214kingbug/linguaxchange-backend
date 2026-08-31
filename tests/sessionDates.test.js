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
    // No timezone given, so the series is anchored to UTC and the UTC clock
    // time is what stays put. This used to depend on the machine's own
    // timezone and failed anywhere that observes DST.
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

// Europe/Madrid enters DST on 2026-03-29. A recurring class has to keep the
// hour its participants actually turn up at, which means the UTC time has to
// move, not stay put.
describe('buildSessionDates across a daylight-saving change', () => {
  const MADRID = 'Europe/Madrid'
  const localHour = (date, timeZone) =>
    new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hour12: false }).format(date)

  test('a weekly class keeps its local hour and shifts its UTC hour', () => {
    // 19:00 in Madrid on 25 March is 18:00Z (UTC+1, still winter).
    const dates = buildSessionDates(
      '2026-03-25T18:00:00.000Z', 'weekly', '2026-04-02T00:00:00.000Z', MADRID)

    expect(dates).toHaveLength(2)
    // 19:00 in Madrid on 1 April is 17:00Z (UTC+2, now summer).
    expect(dates[1].toISOString()).toBe('2026-04-01T17:00:00.000Z')
    expect(localHour(dates[0], MADRID)).toBe('19')
    expect(localHour(dates[1], MADRID)).toBe('19')
  })

  test('a monthly class keeps its local hour across the change', () => {
    const dates = buildSessionDates(
      '2026-02-15T18:00:00.000Z', 'monthly', '2026-04-16T00:00:00.000Z', MADRID)

    expect(dates).toHaveLength(3)
    expect(dates.map(d => localHour(d, MADRID))).toEqual(['19', '19', '19'])
    // February and March are still UTC+1; April has moved to UTC+2.
    expect(dates[2].toISOString()).toBe('2026-04-15T17:00:00.000Z')
  })

  test('the UTC hour is what moves, which is the whole point', () => {
    const dates = buildSessionDates(
      '2026-03-25T18:00:00.000Z', 'weekly', '2026-04-02T00:00:00.000Z', MADRID)
    expect(dates[0].getUTCHours()).toBe(18)
    expect(dates[1].getUTCHours()).toBe(17)
  })

  test('no timezone anchors the series to UTC, matching previous behaviour', () => {
    for (const tz of [undefined, null, '']) {
      const dates = buildSessionDates(
        '2026-03-25T18:00:00.000Z', 'weekly', '2026-04-02T00:00:00.000Z', tz)
      expect(dates[1].toISOString()).toBe('2026-04-01T18:00:00.000Z')
    }
  })

  test('an unusable timezone falls back to UTC instead of throwing', () => {
    // The value comes from a user-editable column, so it cannot be trusted to
    // be a real IANA name.
    const dates = buildSessionDates(
      '2026-03-25T18:00:00.000Z', 'weekly', '2026-04-02T00:00:00.000Z', 'Mars/Olympus_Mons')
    expect(dates[1].toISOString()).toBe('2026-04-01T18:00:00.000Z')
  })

  test('a zone with a half-hour offset is handled like any other', () => {
    const dates = buildSessionDates(
      '2026-01-01T10:00:00.000Z', 'weekly', '2026-01-09T00:00:00.000Z', 'Asia/Kolkata')
    expect(dates[1].toISOString()).toBe('2026-01-08T10:00:00.000Z')
    expect(localHour(dates[1], 'Asia/Kolkata')).toBe(localHour(dates[0], 'Asia/Kolkata'))
  })
})
