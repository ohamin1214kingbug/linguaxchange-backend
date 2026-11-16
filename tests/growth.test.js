const { buildGrowth, weekOf } = require('../utils/growth')

const now = new Date('2026-11-16T12:00:00Z') // a Monday
const user = (id, created_at, extra = {}) => ({ id, created_at, photo_url: null, teach_language: null, learn_languages: [], ...extra })

test('weekOf gives the Monday of the UTC week', () => {
  expect(weekOf('2026-11-16T12:00:00Z')).toBe('2026-11-16')
  expect(weekOf('2026-11-15T23:00:00Z')).toBe('2026-11-09')
})

test('counts members, not bookings, at each step, by week of sign-up', () => {
  const users = [
    user(1, '2026-11-16T09:00:00Z', { photo_url: 'p', teach_language: 'KO', learn_languages: ['ES'], phone_verified: true }),
    user(2, '2026-11-12T09:00:00Z', { learn_languages: ['ES'] }),
    user(3, '2026-01-01T09:00:00Z', { photo_url: 'p', teach_language: 'ES', learn_languages: ['KO'] }),
    user(4, '2026-01-02T09:00:00Z', { photo_url: 'p', teach_language: '', learn_languages: [''] }), // blanks: not done
  ]
  const enrollments = [
    { user_id: 3, status: 'attended', attended: true }, { user_id: 3, status: 'attended', attended: true }, // two bookings, one member
    { user_id: 2, status: 'cancelled' },
    { user_id: 1, status: 'confirmed' },
  ]
  const classes = [{ teacher_id: 3, status: 'completed' }, { teacher_id: 1, status: 'rejected' }]
  const g = buildGrowth({ users, enrollments, classes, upcoming: [{ language_code: 'KO' }], now })
  expect(g.totals).toEqual({ signedUp: 4, phoneVerified: 1, profileDone: 2, booked: 2, attended: 1, taught: 1 })
  expect(g.weeks[0]).toEqual({ week: '2026-11-16', signedUp: 1, phoneVerified: 1, profileDone: 1, booked: 1, attended: 0, taught: 0 })
  expect(g.weeks[1]).toMatchObject({ week: '2026-11-09', signedUp: 1, booked: 0 })
  expect(g.weeks.at(-1)).toMatchObject({ week: 'earlier', signedUp: 2, attended: 1, taught: 1 })
  // Spanish: 2 learners, no classes, so it comes first.
  expect(g.languages[0]).toEqual({ code: 'ES', learners: 2, teachers: 1, upcoming: 0 })
})
