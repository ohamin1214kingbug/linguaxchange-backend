const { pickNextUnjoinedSession } = require('../utils/pickSession')

describe('pickNextUnjoinedSession', () => {
  test('picks the first session when none are joined', () => {
    const sessions = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(pickNextUnjoinedSession(sessions, [])).toEqual({ id: 1 })
  })

  test('skips sessions already joined and picks the next one', () => {
    const sessions = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(pickNextUnjoinedSession(sessions, [1])).toEqual({ id: 2 })
  })

  test('lets a student book each occurrence of a recurring class in turn', () => {
    const sessions = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(pickNextUnjoinedSession(sessions, [1, 2])).toEqual({ id: 3 })
  })

  test('returns undefined once every session has been joined', () => {
    const sessions = [{ id: 1 }, { id: 2 }]
    expect(pickNextUnjoinedSession(sessions, [1, 2])).toBeUndefined()
  })

  test('returns undefined for an empty session list', () => {
    expect(pickNextUnjoinedSession([], [])).toBeUndefined()
  })

  test('ignores enrolled ids that are not in the session list', () => {
    const sessions = [{ id: 5 }, { id: 6 }]
    expect(pickNextUnjoinedSession(sessions, [999])).toEqual({ id: 5 })
  })
})

// A session stays status 'scheduled' after it happens, so without a date
// check a student could spend a credit joining a class that already
// finished — which is what the teacher profile page was offering.
describe('pickNextUnjoinedSession — past sessions', () => {
  const NOW = new Date('2026-08-21T12:00:00Z')
  const past = { id: 1, session_date: '2026-07-31T09:00:00Z' }
  const future = { id: 2, session_date: '2026-09-01T09:00:00Z' }

  test('skips a session that has already started', () => {
    expect(pickNextUnjoinedSession([past, future], [], NOW)).toEqual(future)
  })

  test('returns undefined when every remaining session is in the past', () => {
    expect(pickNextUnjoinedSession([past], [], NOW)).toBeUndefined()
  })

  test('a future session already joined does not fall back to a past one', () => {
    expect(pickNextUnjoinedSession([past, future], [2], NOW)).toBeUndefined()
  })

  test('sessions with no date stay joinable, for callers that only select ids', () => {
    expect(pickNextUnjoinedSession([{ id: 9 }], [], NOW)).toEqual({ id: 9 })
  })
})
