const { earliestFutureSessionDate, sortBySoonest } = require('../utils/classSearch')

const now = new Date('2026-07-27T12:00:00.000Z')

describe('earliestFutureSessionDate', () => {
  test('picks the earliest of several future scheduled sessions', () => {
    const cls = {
      class_sessions: [
        { status: 'scheduled', session_date: '2026-08-10T12:00:00.000Z' },
        { status: 'scheduled', session_date: '2026-08-01T12:00:00.000Z' },
        { status: 'scheduled', session_date: '2026-08-20T12:00:00.000Z' },
      ]
    }
    expect(earliestFutureSessionDate(cls, now).toISOString()).toBe('2026-08-01T12:00:00.000Z')
  })

  test('ignores past and completed sessions', () => {
    const cls = {
      class_sessions: [
        { status: 'completed', session_date: '2026-07-01T12:00:00.000Z' },
        { status: 'scheduled', session_date: '2026-07-01T12:00:00.000Z' }, // past but 'scheduled'
        { status: 'scheduled', session_date: '2026-08-15T12:00:00.000Z' },
      ]
    }
    expect(earliestFutureSessionDate(cls, now).toISOString()).toBe('2026-08-15T12:00:00.000Z')
  })

  test('returns null when there is no future scheduled session', () => {
    const cls = { class_sessions: [{ status: 'completed', session_date: '2026-07-01T12:00:00.000Z' }] }
    expect(earliestFutureSessionDate(cls, now)).toBeNull()
  })

  test('returns null for a class with no sessions at all', () => {
    expect(earliestFutureSessionDate({ class_sessions: [] }, now)).toBeNull()
    expect(earliestFutureSessionDate({}, now)).toBeNull()
  })
})

describe('sortBySoonest', () => {
  test('sorts classes by their earliest future session, soonest first', () => {
    const classes = [
      { id: 'B', class_sessions: [{ status: 'scheduled', session_date: '2026-09-01T12:00:00.000Z' }] },
      { id: 'A', class_sessions: [{ status: 'scheduled', session_date: '2026-08-01T12:00:00.000Z' }] },
      { id: 'C', class_sessions: [{ status: 'scheduled', session_date: '2026-10-01T12:00:00.000Z' }] },
    ]
    expect(sortBySoonest(classes, now).map(c => c.id)).toEqual(['A', 'B', 'C'])
  })

  test('classes with no future session sort to the end, not dropped', () => {
    const classes = [
      { id: 'expired', class_sessions: [{ status: 'completed', session_date: '2026-07-01T12:00:00.000Z' }] },
      { id: 'upcoming', class_sessions: [{ status: 'scheduled', session_date: '2026-08-01T12:00:00.000Z' }] },
    ]
    const sorted = sortBySoonest(classes, now)
    expect(sorted.map(c => c.id)).toEqual(['upcoming', 'expired'])
    expect(sorted.length).toBe(2) // nothing dropped
  })

  test('does not mutate the input array', () => {
    const classes = [
      { id: 'B', class_sessions: [{ status: 'scheduled', session_date: '2026-09-01T12:00:00.000Z' }] },
      { id: 'A', class_sessions: [{ status: 'scheduled', session_date: '2026-08-01T12:00:00.000Z' }] },
    ]
    const original = [...classes]
    sortBySoonest(classes, now)
    expect(classes).toEqual(original)
  })
})
