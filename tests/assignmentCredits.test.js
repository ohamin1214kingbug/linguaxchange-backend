// isOverCap and windowStart are pure, but countFeedbackEarnings and
// releaseFeedbackCredit actually talk to the Supabase client, so this needs
// a richer mock than tests/creditSpendGate.test.js's `createClient: () => ({})`
// — one that can simulate success and error responses from .select()/.insert()/.rpc().
// Names must start with "mock" so babel-plugin-jest-hoist allows referencing
// them from inside the jest.mock() factory below.
const mockGte = jest.fn()
const mockInsert = jest.fn()
const mockRpc = jest.fn()
const mockFrom = jest.fn()

// The fixed shape countFeedbackEarnings/releaseFeedbackCredit's tests below
// already rely on — kept as mockFrom's default so those tests need no
// changes. releaseDueFeedback/refundExpiredAssignments issue different
// .from() chains (select/is/lt, then update/eq/is/select) per call, so their
// tests override mockFrom per-call with chain() instead of using this default.
function defaultFromImpl() {
  return {
    select: () => ({ eq: () => ({ eq: () => ({ gte: (...args) => mockGte(...args) }) }) }),
    insert: (...args) => mockInsert(...args),
  }
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  }),
}))

jest.mock('../utils/requestCredits', () => ({
  refundForRequest: jest.fn(),
}))

const {
  isOverCap, countFeedbackEarnings, releaseFeedbackCredit, windowStart,
  WEEKLY_FEEDBACK_CAP, FEEDBACK_TYPE, WINDOW_DAYS,
  releaseDueFeedback, refundExpiredAssignments,
} = require('../utils/assignmentCredits')
const { refundForRequest } = require('../utils/requestCredits')

// Minimal chainable Postgrest-style builder: every method returns itself,
// and awaiting it resolves to `result` — enough to drive the select/update/
// is/lt chains in releaseDueFeedback and refundExpiredAssignments without
// reproducing the real Supabase client.
function chain(result) {
  const builder = {}
  const methods = ['select', 'eq', 'is', 'lt', 'update']
  methods.forEach((m) => { builder[m] = jest.fn(() => builder) })
  builder.then = (resolve) => resolve(result)
  return builder
}

beforeEach(() => {
  jest.resetAllMocks()
  mockFrom.mockImplementation(defaultFromImpl)
})

describe('isOverCap', () => {
  test('allows the first review of the week', () => {
    expect(isOverCap(0)).toBe(false)
  })

  test('allows reviews up to the cap', () => {
    expect(isOverCap(WEEKLY_FEEDBACK_CAP - 1)).toBe(false)
  })

  test('refuses once the cap has been reached', () => {
    // Having already earned WEEKLY_FEEDBACK_CAP this week, the next one is refused.
    expect(isOverCap(WEEKLY_FEEDBACK_CAP)).toBe(true)
  })

  test('refuses beyond the cap', () => {
    expect(isOverCap(WEEKLY_FEEDBACK_CAP + 5)).toBe(true)
  })

  test('the cap exists to stop reviewing beating teaching, so it is small', () => {
    // A banana buys a 60-minute class or ~10 minutes of annotation. Without a
    // cap the rational move is to stop teaching, and live classes are the part
    // universities want.
    expect(WEEKLY_FEEDBACK_CAP).toBeLessThanOrEqual(5)
  })
})

describe('windowStart', () => {
  test('returns exactly WINDOW_DAYS before the given time', () => {
    const now = new Date('2026-09-03T12:00:00.000Z')
    const result = windowStart(now)
    expect(result.getTime()).toBe(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  })

  test('defaults to measuring back from the current time', () => {
    const before = Date.now()
    const result = windowStart()
    const after = Date.now()
    expect(result.getTime()).toBeGreaterThanOrEqual(before - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    expect(result.getTime()).toBeLessThanOrEqual(after - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  })
})

describe('countFeedbackEarnings', () => {
  test('returns the row count on a successful lookup', async () => {
    mockGte.mockResolvedValueOnce({ count: 2, error: null })
    await expect(countFeedbackEarnings(1, new Date())).resolves.toBe(2)
  })

  test('treats a null count as zero', async () => {
    mockGte.mockResolvedValueOnce({ count: null, error: null })
    await expect(countFeedbackEarnings(1, new Date())).resolves.toBe(0)
  })

  // FINDING 2: this is the fail-closed branch. A regression that flips it to
  // `return 0` (fail-open, granting the earning on a DB failure) must fail here.
  test('fails closed to the cap when the lookup errors, refusing the earning', async () => {
    mockGte.mockResolvedValueOnce({ count: null, error: { message: 'connection reset' } })
    await expect(countFeedbackEarnings(1, new Date())).resolves.toBe(WEEKLY_FEEDBACK_CAP)
  })
})

describe('releaseFeedbackCredit', () => {
  test('pays out and records the audit row on success', async () => {
    mockRpc.mockResolvedValueOnce({ data: 5, error: null }) // add_credit
    mockInsert.mockResolvedValueOnce({ error: null })

    const result = await releaseFeedbackCredit(42)

    expect(result).toEqual({ ok: true, balance: 5 })
    expect(mockRpc).toHaveBeenCalledWith('add_credit', { p_user_id: 42, p_amount: 1 })
    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: 42, amount: 1, type: FEEDBACK_TYPE }),
    ])
  })

  test('reports a retryable failure without inserting when the payout RPC errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc down' } })

    const result = await releaseFeedbackCredit(42)

    // Nothing happened — add_credit never ran — so a caller may safely retry.
    expect(result).toEqual({ ok: false, retryable: true })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('reports a retryable failure without inserting when the payout RPC returns no row (no credits row)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    const result = await releaseFeedbackCredit(42)

    expect(result).toEqual({ ok: false, retryable: true })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  // FINDING 1: an unchecked insert here is exactly the bug that made the
  // weekly cap unenforceable in production (see migrations/add_assignment_feedback.sql).
  // The fix must notice the insert failed, reverse the payout via spend_credit,
  // and report failure — never claim success with no audit row.
  test('reverses the payout and reports a retryable failure when the audit insert fails', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 5, error: null }) // add_credit
      .mockResolvedValueOnce({ data: 4, error: null }) // spend_credit reversal
    mockInsert.mockResolvedValueOnce({ error: { code: '22001', message: 'value too long' } })

    const result = await releaseFeedbackCredit(42)

    // The reversal undid the payout, so net effect is nothing happened —
    // safe to retry.
    expect(result).toEqual({ ok: false, retryable: true })
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'spend_credit', { p_user_id: 42, p_amount: 1 })
  })

  // FINDING (fix round 2): when the reversal itself also fails, the credit
  // WAS granted and cannot be taken back — retrying would add_credit a
  // second time on top of this one. The caller must be told this is NOT
  // retryable, or it will double-pay on the next tick.
  test('reports a non-retryable failure when the reversal itself cannot be applied, leaving balance and audit log out of sync', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 5, error: null }) // add_credit
      .mockResolvedValueOnce({ data: null, error: { message: 'balance already spent' } }) // reversal fails
    mockInsert.mockResolvedValueOnce({ error: { message: 'insert failed' } })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const result = await releaseFeedbackCredit(42)

    expect(result).toEqual({ ok: false, retryable: false })
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('out of sync'),
      42,
      expect.anything()
    )

    errorSpy.mockRestore()
  })
})

describe('releaseDueFeedback', () => {
  const now = new Date('2026-09-03T12:00:00Z')

  test('a row whose claim loses the race to another tick is not paid out', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 7, reviewer_id: 3 }], error: null })) // due lookup
    mockFrom.mockReturnValueOnce(chain({ data: [], error: null })) // claim lost — another tick got it first

    const result = await releaseDueFeedback(now)

    expect(result).toEqual({ released: 0 })
    expect(mockRpc).not.toHaveBeenCalled() // releaseFeedbackCredit never ran
  })

  test('a claimed row is paid and counted', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 7, reviewer_id: 3 }], error: null })) // due lookup
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 7 }], error: null })) // claim wins
    mockRpc.mockResolvedValueOnce({ data: 6, error: null }) // add_credit
    mockInsert.mockResolvedValueOnce({ error: null }) // audit row

    const result = await releaseDueFeedback(now)

    expect(result).toEqual({ released: 1 })
    expect(mockRpc).toHaveBeenCalledWith('add_credit', { p_user_id: 3, p_amount: 1 })
  })

  // FINDING 1 (fix round 1): a failed payout must not leave credit_released_at
  // set, or the row is stuck "released" with no pay and no retry, forever
  // invisible to this same WHERE clause.
  test('a failed payout clears the claim so a later tick can retry', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 7, reviewer_id: 3 }], error: null })) // due lookup
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 7 }], error: null })) // claim wins
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'add_credit down' } }) // payout fails
    const clearBuilder = chain({ data: null, error: null })
    mockFrom.mockReturnValueOnce(clearBuilder) // the compensating un-claim

    const result = await releaseDueFeedback(now)

    expect(result).toEqual({ released: 0 })
    expect(clearBuilder.update).toHaveBeenCalledWith({ credit_released_at: null })
    expect(clearBuilder.eq).toHaveBeenCalledWith('id', 7)
  })

  // FINDING (fix round 2): add_credit succeeds, the audit insert fails, AND
  // the spend_credit reversal also fails — the credit is genuinely out
  // there with no audit row. Clearing the claim here would let the next
  // tick call releaseFeedbackCredit again and add_credit a second time on
  // top of the first, double-paying the reviewer. The row must stay marked
  // released, and released must not count a payout that never got recorded.
  test('a desynced payout (insert AND reversal both fail) is not retried and not counted', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 7, reviewer_id: 3 }], error: null })) // due lookup
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 7 }], error: null })) // claim wins
    mockRpc
      .mockResolvedValueOnce({ data: 5, error: null }) // add_credit succeeds
      .mockResolvedValueOnce({ data: null, error: { message: 'balance already spent' } }) // reversal fails
    mockInsert.mockResolvedValueOnce({ error: { message: 'insert failed' } })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const result = await releaseDueFeedback(now)

    expect(result).toEqual({ released: 0 })
    // Only 3 .from() calls total: the due lookup, the claim, and the audit
    // insert inside releaseFeedbackCredit — no fourth call to clear the claim.
    expect(mockFrom).toHaveBeenCalledTimes(3)

    errorSpy.mockRestore()
  })
})

describe('refundExpiredAssignments', () => {
  const now = new Date('2026-09-03T12:00:00Z')

  test('an answered request is not refunded as expired', async () => {
    mockFrom.mockReturnValueOnce(chain({
      data: [{ id: 11, student_id: 5, assignment_feedback: [{ id: 99 }] }],
      error: null,
    })) // stale lookup: the one row found has already been answered

    const result = await refundExpiredAssignments(now)

    expect(result).toEqual({ refunded: 0 })
    expect(refundForRequest).not.toHaveBeenCalled()
    expect(mockFrom).toHaveBeenCalledTimes(1) // skipped before any claim update
  })

  test('an unanswered expired request is refunded', async () => {
    mockFrom.mockReturnValueOnce(chain({
      data: [{ id: 12, student_id: 6, assignment_feedback: [] }],
      error: null,
    }))
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 12 }], error: null })) // claim wins
    refundForRequest.mockResolvedValueOnce({ ok: true, balance: 2 })

    const result = await refundExpiredAssignments(now)

    expect(result).toEqual({ refunded: 1 })
    expect(refundForRequest).toHaveBeenCalledWith(6, 'Assignment request expired unanswered')
  })

  // Same compensation as releaseDueFeedback above: a failed refund must not
  // leave credit_refunded_at set, or the student never gets their banana back.
  test('a failed refund clears the claim so a later tick can retry', async () => {
    mockFrom.mockReturnValueOnce(chain({
      data: [{ id: 12, student_id: 6, assignment_feedback: [] }],
      error: null,
    }))
    mockFrom.mockReturnValueOnce(chain({ data: [{ id: 12 }], error: null })) // claim wins
    refundForRequest.mockResolvedValueOnce({ ok: false })
    const clearBuilder = chain({ data: null, error: null })
    mockFrom.mockReturnValueOnce(clearBuilder) // the compensating un-claim

    const result = await refundExpiredAssignments(now)

    expect(result).toEqual({ refunded: 0 })
    expect(clearBuilder.update).toHaveBeenCalledWith({ credit_refunded_at: null })
    expect(clearBuilder.eq).toHaveBeenCalledWith('id', 12)
  })
})
