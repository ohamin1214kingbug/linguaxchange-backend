jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
jest.mock('../utils/push', () => ({ pushNotifications: () => {} }))
const { isTeacherNoShow, consequence } = require('../utils/noShow')

const start = '2026-11-20T18:00:00Z'

test('a teacher who opens the room within 15 minutes of the start is not a no-show', () => {
  expect(isTeacherNoShow({ sessionDate: start, teacherJoinedAt: '2026-11-20T17:50:00Z' })).toBe(false)
  expect(isTeacherNoShow({ sessionDate: start, teacherJoinedAt: '2026-11-20T18:15:00Z' })).toBe(false)
  expect(isTeacherNoShow({ sessionDate: start, teacherJoinedAt: '2026-11-20T18:16:00Z' })).toBe(true)
  expect(isTeacherNoShow({ sessionDate: start, teacherJoinedAt: null })).toBe(true)
})

test('teachers: 2 strikes in 30 days pause new classes for 7 days', () => {
  const now = new Date('2026-11-20T19:00:00Z')
  expect(consequence('teacher', 1, now).until).toBeNull()
  expect(consequence('teacher', 2, now).until.toISOString()).toBe('2026-11-27T19:00:00.000Z')
})

test('students: 3 strikes in 30 days limit booking for 14 days', () => {
  const now = new Date('2026-11-20T19:00:00Z')
  expect(consequence('student', 2, now).until).toBeNull()
  expect(consequence('student', 3, now).until.toISOString()).toBe('2026-12-04T19:00:00.000Z')
})
