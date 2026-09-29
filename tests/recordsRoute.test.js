// Drives GET /api/records/:token the same way tests/assignmentAcknowledge.test.js
// drives its route: router.handle() against plain req/res objects, no supertest.
//
// The database is a small stand-in for PostgREST that only answers for tables
// and columns the real schema has, and fails the way PostgREST does for
// anything else. That is what this test guards: the route once queried
// .from('enrollments') filtered by 'student_id' — neither exists — and because
// it only reads `data`, the error vanished and every shared record showed zero
// attended classes from 2026-08-31 until 2026-09-21. The existing tests only
// covered summarise(), which was never wrong.

const TABLES = {
  users: {
    columns: ['id', 'record_token'],
    rows: [{ id: 7, first_name: 'Ana', last_name: 'García', university_domain: null, university_verified_at: null, record_token: 'tok-ana' }],
  },
  class_enrollments: {
    columns: ['user_id', 'attended'],
    rows: [
      { user_id: 7, attended: true, class_sessions: { session_date: '2026-09-01T10:00:00Z', classes: { language_code: 'KO', level: 'A1', duration_minutes: 60 } } },
      { user_id: 7, attended: true, class_sessions: { session_date: '2026-09-08T10:00:00Z', classes: { language_code: 'KO', level: 'A2', duration_minutes: 90 } } },
      // Joined but never confirmed: joining proves nothing happened.
      { user_id: 7, attended: false, class_sessions: { session_date: '2026-09-15T10:00:00Z', classes: { language_code: 'ES', level: 'B1', duration_minutes: 60 } } },
      // Someone else's class.
      { user_id: 8, attended: true, class_sessions: { session_date: '2026-09-02T10:00:00Z', classes: { language_code: 'DE', level: 'A1', duration_minutes: 60 } } },
    ],
  },
  classes: { columns: ['teacher_id'], rows: [] },
}

function mockQuery(table) {
  const def = TABLES[table]
  let error = def ? null : { code: 'PGRST205', message: `Could not find the table 'public.${table}'` }
  let rows = def ? def.rows : []
  const builder = {
    select: () => builder,
    eq: (column, value) => {
      if (!error && !def.columns.includes(column)) error = { code: '42703', message: `column ${table}.${column} does not exist` }
      rows = rows.filter(r => r[column] === value)
      return builder
    },
    maybeSingle: () => Promise.resolve(error ? { data: null, error } : { data: rows[0] || null, error: null }),
    then: (resolve, reject) => Promise.resolve(error ? { data: null, error } : { data: rows, error: null }).then(resolve, reject),
  }
  return builder
}

jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: table => mockQuery(table) }) }))
jest.mock('../middleware/auth', () => ({ requireAuth: (req, res, next) => next() }))
jest.mock('../middleware/rateLimit', () => ({ publicGetLimiter: (req, res, next) => next() }))

const router = require('../routes/records')

function get(token) {
  return new Promise(resolve => {
    const res = { statusCode: 200 }
    res.status = code => { res.statusCode = code; return res }
    res.json = body => { res.body = body; resolve(res); return res }
    router.handle({ method: 'GET', url: `/${token}`, headers: {} }, res, () => resolve(res))
  })
}

describe('GET /api/records/:token', () => {
  test('counts only the member’s own confirmed attendance', async () => {
    const res = await get('tok-ana')
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      name: 'Ana García',
      attendedCount: 2,
      attendedMinutes: 150,
      languages: ['KO'],
      levels: ['A1', 'A2'],
      firstActivity: '2026-09-01T10:00:00.000Z',
      lastActivity: '2026-09-08T10:00:00.000Z',
    })
  })

  test('an unknown token is a flat 404', async () => {
    const res = await get('not-a-token')
    expect(res.statusCode).toBe(404)
  })
})
