// No supertest in this repo — express.Router() exposes .handle(req, res, next)
// and dispatches standalone against plain mock req/res objects, which is
// enough to drive POST /:id/acknowledge's branching without adding a
// dependency for it.

const mockFrom = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => mockFrom(...args) }),
}))

jest.mock('../middleware/auth', () => ({
  requireAuth: (req, res, next) => { req.userId = 1; next() },
}))

const mockReleaseFeedbackCredit = jest.fn()
jest.mock('../utils/assignmentCredits', () => ({
  isOverCap: jest.fn(),
  countFeedbackEarnings: jest.fn(),
  releaseFeedbackCredit: (...args) => mockReleaseFeedbackCredit(...args),
}))

const router = require('../routes/assignments')

// Same minimal chainable builder as tests/assignmentCredits.test.js: every
// method returns itself, and awaiting it resolves to `result`.
function chain(result) {
  const builder = {}
  const methods = ['select', 'eq', 'is', 'update', 'maybeSingle']
  methods.forEach((m) => { builder[m] = jest.fn(() => builder) })
  builder.then = (resolve) => resolve(result)
  return builder
}

// router.handle() never returns a promise; every branch in the route ends by
// calling res.json() (directly or via fail()/res.status().json()), so
// resolving there is how the test knows the async handler finished.
function dispatch(req) {
  return new Promise((resolve) => {
    const res = {}
    res.status = (code) => { res.statusCode = code; return res }
    res.json = (body) => { res.body = body; resolve(res); return res }
    router.handle(req, res, () => resolve(res))
  })
}

function acknowledgeReq(id) {
  return { method: 'POST', url: `/${id}/acknowledge`, headers: {} }
}

beforeEach(() => {
  jest.resetAllMocks()
})

describe('POST /:id/acknowledge', () => {
  test('happy path: releases the credit and reports success', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { id: 5, student_id: 1 }, error: null })) // find the request
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 9, reviewer_id: 2 }], error: null })) // claim
    mockReleaseFeedbackCredit.mockResolvedValueOnce({ ok: true, balance: 4 })

    const res = await dispatch(acknowledgeReq(5))

    expect(res.body).toEqual({ success: true })
    expect(mockReleaseFeedbackCredit).toHaveBeenCalledWith(2)
  })

  test('double-acknowledge is idempotent: the second click succeeds without paying twice', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { id: 5, student_id: 1 }, error: null })) // find the request
    mockFrom.mockReturnValueOnce(chain({ data: [], error: null })) // already released — no row transitions

    const res = await dispatch(acknowledgeReq(5))

    expect(res.body).toEqual({ success: true, already: true })
    expect(mockReleaseFeedbackCredit).not.toHaveBeenCalled()
  })

  // FINDING 1/2 (fix round 1): a retryable failure must not be reported as
  // success, and the row must not be left marked released with no pay — the
  // route clears credit_released_at back to null on this same row so a retry
  // (another click, or the cron sweep) can claim and pay it again.
  //
  // FINDING 2 (final review): acknowledged_at must be cleared with it. The UI
  // renders the acknowledge button on !feedback.acknowledged_at, so leaving it
  // set removes the very button the retry depends on.
  test('a retryable failure is not reported as success, and the claim is cleared for a retry', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { id: 5, student_id: 1 }, error: null })) // find the request
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 9, reviewer_id: 2 }], error: null })) // claim
    mockReleaseFeedbackCredit.mockResolvedValueOnce({ ok: false, retryable: true })
    const clearBuilder = chain({ data: null, error: null })
    mockFrom.mockReturnValueOnce(clearBuilder) // the compensating un-claim

    const res = await dispatch(acknowledgeReq(5))

    expect(res.statusCode).toBe(500)
    expect(res.body.success).toBe(false)
    expect(clearBuilder.update).toHaveBeenCalledWith({ acknowledged_at: null, credit_released_at: null })
    expect(clearBuilder.eq).toHaveBeenCalledWith('id', 9)
  })

  // FINDING (fix round 2): a non-retryable failure means releaseFeedbackCredit
  // already granted the credit and could not reverse it — clearing the claim
  // here would let a second click (or the cron sweep) pay the same reviewer
  // again. The row must stay marked released, so no third .from() call happens.
  test('a non-retryable failure (desync) still fails the request but does not clear the claim', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: { id: 5, student_id: 1 }, error: null })) // find the request
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 9, reviewer_id: 2 }], error: null })) // claim
    mockReleaseFeedbackCredit.mockResolvedValueOnce({ ok: false, retryable: false })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const res = await dispatch(acknowledgeReq(5))

    expect(res.statusCode).toBe(500)
    expect(res.body.success).toBe(false)
    expect(mockFrom).toHaveBeenCalledTimes(2) // no third call to clear the claim

    errorSpy.mockRestore()
  })
})
