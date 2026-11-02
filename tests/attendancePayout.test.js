// POST /api/enrollments/:id/confirm locks attendance in first ('confirmed'
// -> 'attended', so a replay can't mint a second payout), then pays the
// teacher. It used to find the teacher with two more reads after the lock,
// reading only `data`: a failed read threw, the student got a 500, and the
// lock meant no retry could ever pay the teacher. The teacher now comes from
// the read that happens before the lock, and a payout that doesn't apply is
// logged. Driven through router.handle(), as in assignmentAcknowledge.test.js.
//
// The payout now has its own lock (teacher_paid_at), shared with the
// automatic payout 72h after class (utils/attendancePayout.js): a confirm
// that finds it already claimed pays nothing, and a payout that fails
// releases the claim so the sweep retries it.

const mockCalls = []
let mockAddCredit = { data: 4, error: null }
let mockClaimed = true

function mockBuilder(table) {
  const call = { table, op: 'select' }
  mockCalls.push(call)
  const b = {
    select: () => b,
    update: payload => { call.op = 'update'; call.payload = payload; return b },
    is: () => b,
    then: (resolve, reject) => Promise.resolve(
      call.payload?.teacher_paid_at ? { data: mockClaimed ? [{ id: 5 }] : [], error: null } : { data: null, error: null }
    ).then(resolve, reject),
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
  mockClaimed = true
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
    // The claim is released so the automatic sweep can retry the payout.
    expect(mockCalls).toContainEqual(expect.objectContaining({ table: 'class_enrollments', op: 'update', payload: { teacher_paid_at: null } }))
  })

  test('pays nothing when the automatic payout already claimed this enrollment', async () => {
    mockClaimed = false
    const res = await confirm(5)
    expect(res.body).toEqual({ success: true })
    expect(mockCalls.some(c => c.rpc === 'add_credit')).toBe(false)
  })
})
