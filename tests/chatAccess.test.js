const { chatAccess, cleanMessage } = require('../utils/chatAccess')

const base = { sessionDate: '2026-11-20T18:00:00Z', sessionStatus: 'scheduled', durationMinutes: 60 }
const at = iso => new Date(iso)

test('the teacher and booked students may use it, also a booking cancelled with the class; others may not', () => {
  expect(chatAccess({ ...base, isTeacher: true, now: at('2026-11-18T10:00:00Z') }).open).toBe(true)
  expect(chatAccess({ ...base, enrollmentStatus: 'confirmed', now: at('2026-11-18T10:00:00Z') }).open).toBe(true)
  expect(chatAccess({ ...base, enrollmentStatus: 'attended', now: at('2026-11-20T20:00:00Z') }).open).toBe(true)
  expect(chatAccess({ ...base, enrollmentStatus: 'cancelled', now: at('2026-11-18T10:00:00Z') }).open).toBe(true)
  expect(chatAccess({ ...base, enrollmentStatus: null, now: at('2026-11-18T10:00:00Z') }).allowed).toBe(false)
})

test('closes 24 hours after the class ends; a cancelled session stays open until then', () => {
  expect(chatAccess({ ...base, isTeacher: true, now: at('2026-11-21T18:59:00Z') }).open).toBe(true)
  const late = chatAccess({ ...base, isTeacher: true, now: at('2026-11-21T19:01:00Z') })
  expect(late.open).toBe(false)
  expect(late.allowed).toBe(true)
  expect(late.closesAt.toISOString()).toBe('2026-11-21T19:00:00.000Z')
  expect(chatAccess({ ...base, sessionStatus: 'cancelled', isTeacher: true, now: at('2026-11-18T10:00:00Z') }).open).toBe(true)
})

test('messages are trimmed and limited to 500 characters', () => {
  expect(cleanMessage('  hi  ')).toBe('hi')
  expect(cleanMessage('   ')).toBeNull()
  expect(cleanMessage('x'.repeat(500))).toHaveLength(500)
  expect(cleanMessage('x'.repeat(501))).toBeNull()
  expect(cleanMessage(42)).toBeNull()
})
