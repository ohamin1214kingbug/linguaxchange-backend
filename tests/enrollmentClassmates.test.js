jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { withClassmates } = require('../routes/enrollments')

// The history page shows who else was in the class. Only real classmates:
// not the member themselves, not someone who cancelled, and nothing beyond
// the first name and photo the query selects.
test('keeps other enrolled students and drops the member and cancelled places', () => {
  const enrollment = {
    id: 1,
    class_sessions: {
      id: 9,
      session_date: '2026-11-09T20:00:00Z',
      class_enrollments: [
        { status: 'confirmed', student: { id: 7, first_name: 'Me', photo_url: null } },
        { status: 'attended', student: { id: 8, first_name: 'Ana', photo_url: 'a.png' } },
        { status: 'cancelled', student: { id: 9, first_name: 'Gone', photo_url: null } },
        { status: 'confirmed', student: null },
      ],
    },
  }
  const out = withClassmates(enrollment, 7)
  expect(out.class_sessions.classmates).toEqual([{ id: 8, first_name: 'Ana', photo_url: 'a.png' }])
  expect(out.class_sessions.class_enrollments).toBeUndefined()
  expect(out.class_sessions.session_date).toBe('2026-11-09T20:00:00Z')
})

test('an enrollment without a session passes through', () => {
  expect(withClassmates({ id: 2, class_sessions: null }, 7)).toEqual({ id: 2, class_sessions: null })
})
