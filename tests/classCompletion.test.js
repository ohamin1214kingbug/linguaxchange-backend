jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { finishedAt, shouldComplete } = require('../utils/classCompletion')

const now = new Date('2026-11-11T12:00:00Z')
const session = (date, enrollments = [{ status: 'confirmed' }], status = 'scheduled') =>
  ({ session_date: date, status, class_enrollments: enrollments })
const cls = (sessions, extra = {}) => ({ status: 'approved', duration_minutes: 60, class_sessions: sessions, ...extra })

test('a class is finished an hour after its last session ends', () => {
  expect(finishedAt(cls([session('2026-11-11T09:00:00Z')]), now)).toEqual(new Date('2026-11-11T10:00:00Z'))
  // ends 11:30, so the hour of grace runs to 12:30
  expect(finishedAt(cls([session('2026-11-11T10:30:00Z')]), now)).toBeNull()
})

test('a recurring class with a session still ahead is not finished', () => {
  expect(finishedAt(cls([session('2026-11-04T09:00:00Z'), session('2026-11-18T09:00:00Z')]), now)).toBeNull()
})

test('cancelled sessions and classes with no session never finish it', () => {
  expect(finishedAt(cls([session('2026-11-18T09:00:00Z', [], 'cancelled'), session('2026-11-10T09:00:00Z')]), now)).not.toBeNull()
  expect(finishedAt(cls([]), now)).toBeNull()
})

test('completed only when a student stayed enrolled', () => {
  expect(shouldComplete(cls([session('2026-11-10T09:00:00Z')]), now)).toBe(true)
  expect(shouldComplete(cls([session('2026-11-10T09:00:00Z', [])]), now)).toBe(false)
  expect(shouldComplete(cls([session('2026-11-10T09:00:00Z', [{ status: 'cancelled' }])]), now)).toBe(false)
})

test('pending, cancelled and already completed classes are left alone', () => {
  for (const status of ['pending', 'cancelled', 'completed', 'rejected']) {
    expect(shouldComplete(cls([session('2026-11-10T09:00:00Z')], { status }), now)).toBe(false)
  }
})
