// POST /api/enrollments/:id/confirm locks attendance in first ('confirmed'
// -> 'attended', so a replay can't mint a second payout), then pays the
// teacher. It used to find the teacher with two more reads after the lock,
// reading only `data`: a failed read threw, the student got a 500, and the
// lock meant no retry could ever pay the teacher. The teacher now comes from
// the read that happens before the lock, and a payout that doesn't apply is
// logged. Driven through router.handle(), as in assignmentAcknowledge.test.js.

const mockCalls = []
let mockAddCredit = { data: 4, error: null }

function mockBuilder(table) {
  const call = { table, op: 'select' }
  mockCalls.push(call)
  const b = {
    select: () => b,
    update: () => { call.op = 'update'; return b },
    insert: rows => { call.op = 'insert'; call.rows = rows; return Promise.resolve({ error: null }) },
    eq: () => b,
    single: () => Promise.resolve(table === 'class_enrollments'
      ? { data: { id: 5, class_session_id: 101, class_sessions: { session_date: '2026-09-01T10:00:00Z', classes: { teacher_id: 3 } } }, error: null }
      : { data: null, error: { message: 'should not be read' } }),
    maybeSingle: () => Promise.resolve({ data: { id: 5, class_session_id: 101 }, error: null }),
  }
  return b
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: table => mockBuilder(table),
    rpc: (fn, args) => { mockCalls.push({ rpc: fn, args }); return Promise.resolve(mockAddCredit) },
  }),
}))
jest.mock('../middleware/auth', () => ({ requireAuth: (req, res, next) => { req.userId = 9; next() } }))
jest.mock('../utils/streak', () => ({ recordWeeklyActivity: jest.fn() }))
jest.mock('../utils/lowCreditNudge', () => ({ maybeSendLowCreditNudge: jest.fn(), resetLowCreditNotificationIfToppedUp: jest.fn() }))
jest.mock('../utils/mailer', () => ({ sendEmail: jest.fn() }))

const router = require('../routes/enrollments')

function confirm(id) {
  return new Promise(resolve => {
    const res = { statusCode: 200 }
    res.status = code => { res.statusCode = code; return res }
    res.json = body => { res.body = body; resolve(res); return res }
    router.handle({ method: 'POST', url: `/${id}/confirm`, headers: {} }, res, () => resolve(res))
  })
}

let errorSpy
beforeEach(() => {
  mockCalls.length = 0
  mockAddCredit = { data: 4, error: null }
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

describe('POST /:id/confirm payout', () => {
  test('pays the teacher found before the lock, with no reads after it', async () => {
    const res = await confirm(5)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(mockCalls).toContainEqual({ rpc: 'add_credit', args: { p_user_id: 3, p_amount: 1 } })
    const tablesRead = mockCalls.filter(c => c.op === 'select').map(c => c.table)
    expect(tablesRead).toEqual(['class_enrollments'])
    expect(mockCalls.find(c => c.op === 'insert')?.rows?.[0]).toMatchObject({ user_id: 3, amount: 1, type: 'earned' })
  })

  test('a payout that fails is logged, not silently dropped, and records no history', async () => {
    mockAddCredit = { data: null, error: { message: 'connection reset' } }
    const res = await confirm(5)
    expect(res.body).toEqual({ success: true })
    expect(errorSpy.mock.calls.map(c => c.join(' ')).join('\n')).toMatch(/\[CREDIT_LEDGER\].*teacher 3/)
    expect(mockCalls.some(c => c.op === 'insert')).toBe(false)
  })
})
