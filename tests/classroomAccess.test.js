const { canJoinClassroom, TEACHER_EARLY_MS, STUDENT_SKEW_MS, OVERRUN_MS } = require('../utils/classroomAccess')

const START = Date.UTC(2026, 8, 4, 17, 0, 0) // 2026-09-04T17:00:00Z
const sessionDate = new Date(START).toISOString()
const base = { sessionDate, durationMinutes: 60 }

const at = (offsetMs, extra = {}) =>
  canJoinClassroom({ ...base, ...extra, now: new Date(START + offsetMs) })

describe('canJoinClassroom', () => {
  describe('students', () => {
    test('locked out well before the class', () => {
      expect(at(-60 * 60 * 1000).ok).toBe(false)
    })

    // The teacher's 10-minute head start is the whole point of the gate: a
    // student who could join then could hold the room before the teacher.
    test('still locked out during the teacher-only window', () => {
      expect(at(-TEACHER_EARLY_MS + 1000).ok).toBe(false)
    })

    test('let in one minute early, absorbing browser clock skew', () => {
      expect(at(-STUDENT_SKEW_MS).ok).toBe(true)
    })

    test('locked out a second before that grace opens', () => {
      expect(at(-STUDENT_SKEW_MS - 1000).ok).toBe(false)
    })

    test('let in once the class starts', () => {
      expect(at(0).ok).toBe(true)
    })

    test('reports when the door opens, so the UI can say so', () => {
      const result = at(-60 * 60 * 1000)
      expect(result.opensAt.getTime()).toBe(START - STUDENT_SKEW_MS)
    })
  })

  describe('teachers', () => {
    const teacher = { isTeacher: true }

    test('let in ten minutes early', () => {
      expect(at(-TEACHER_EARLY_MS, teacher).ok).toBe(true)
    })

    test('locked out a second before that', () => {
      expect(at(-TEACHER_EARLY_MS - 1000, teacher).ok).toBe(false)
    })
  })

  describe('the end of the class', () => {
    const HOUR = 60 * 60 * 1000

    // Cutting the room at the scheduled minute would eject a class that is
    // simply running long.
    test('a class running over is not cut off', () => {
      expect(at(HOUR + 10 * 60 * 1000).ok).toBe(true)
    })

    test('open until the overrun grace expires', () => {
      expect(at(HOUR + OVERRUN_MS).ok).toBe(true)
    })

    test('closed once it does', () => {
      expect(at(HOUR + OVERRUN_MS + 1000).ok).toBe(false)
    })

    test('a longer class stays open longer', () => {
      expect(at(2 * HOUR, { durationMinutes: 120 }).ok).toBe(true)
    })

    test('a missing duration is treated as one hour', () => {
      expect(at(HOUR + OVERRUN_MS + 1000, { durationMinutes: null }).ok).toBe(false)
    })
  })

  describe('bad data', () => {
    test('an unparseable session date refuses rather than throwing', () => {
      const result = canJoinClassroom({ ...base, sessionDate: 'not a date' })
      expect(result.ok).toBe(false)
    })

    test('a session with no date at all refuses', () => {
      const result = canJoinClassroom({ ...base, sessionDate: null })
      expect(result.ok).toBe(false)
    })
  })
})
