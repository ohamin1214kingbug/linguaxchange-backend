// isOverCap and windowStart are pure, but countFeedbackEarnings and
// releaseFeedbackCredit actually talk to the Supabase client, so this needs
// a richer mock than tests/creditSpendGate.test.js's `createClient: () => ({})`
// — one that can simulate success and error responses from .select()/.insert()/.rpc().
// Names must start with "mock" so babel-plugin-jest-hoist allows referencing
// them from inside the jest.mock() factory below.
const mockGte = jest.fn()
const mockInsert = jest.fn()
const mockRpc = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ gte: (...args) => mockGte(...args) }) }) }),
      insert: (...args) => mockInsert(...args),
    }),
    rpc: (...args) => mockRpc(...args),
  }),
}))

const {
  isOverCap, countFeedbackEarnings, releaseFeedbackCredit, windowStart,
  WEEKLY_FEEDBACK_CAP, FEEDBACK_TYPE, WINDOW_DAYS,
} = require('../utils/assignmentCredits')

beforeEach(() => {
  jest.resetAllMocks()
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

  test('reports failure without inserting when the payout RPC errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc down' } })

    const result = await releaseFeedbackCredit(42)

    expect(result).toEqual({ ok: false })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  test('reports failure without inserting when the payout RPC returns no row (no credits row)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    const result = await releaseFeedbackCredit(42)

    expect(result).toEqual({ ok: false })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  // FINDING 1: an unchecked insert here is exactly the bug that made the
  // weekly cap unenforceable in production (see migrations/add_assignment_feedback.sql).
  // The fix must notice the insert failed, reverse the payout via spend_credit,
  // and report failure — never claim success with no audit row.
  test('reverses the payout and reports failure when the audit insert fails', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 5, error: null }) // add_credit
      .mockResolvedValueOnce({ data: 4, error: null }) // spend_credit reversal
    mockInsert.mockResolvedValueOnce({ error: { code: '22001', message: 'value too long' } })

    const result = await releaseFeedbackCredit(42)

    expect(result).toEqual({ ok: false })
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'spend_credit', { p_user_id: 42, p_amount: 1 })
  })

  test('logs when the reversal itself cannot be applied, leaving balance and audit log out of sync', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: 5, error: null }) // add_credit
      .mockResolvedValueOnce({ data: null, error: { message: 'balance already spent' } }) // reversal fails
    mockInsert.mockResolvedValueOnce({ error: { message: 'insert failed' } })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const result = await releaseFeedbackCredit(42)

    expect(result).toEqual({ ok: false })
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('out of sync'),
      42,
      expect.anything()
    )

    errorSpy.mockRestore()
  })
})
