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
