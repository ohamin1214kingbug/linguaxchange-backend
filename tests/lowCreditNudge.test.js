// isLowBalance/shouldConsiderNudge are pure, but the module also creates a
// Supabase client at import time — mock it out so this stays a fast,
// isolated unit test with no network/DB dependency.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({})
}))

const { LOW_CREDIT_THRESHOLD, isLowBalance, shouldConsiderNudge, nudgeEnabledFromPrefs } = require('../utils/lowCreditNudge')

describe('isLowBalance', () => {
  test('threshold is 1 credit', () => {
    expect(LOW_CREDIT_THRESHOLD).toBe(1)
  })

  test('balance at the threshold is low', () => {
    expect(isLowBalance(1)).toBe(true)
  })

  test('balance of 0 is low', () => {
    expect(isLowBalance(0)).toBe(true)
  })

  test('balance above the threshold is not low', () => {
    expect(isLowBalance(2)).toBe(false)
  })
})

describe('shouldConsiderNudge', () => {
  test('a brand-new user spending their first-ever credit is not nudged', () => {
    // priorTransactionCount = 0: nothing happened before the spend that triggered this check
    expect(shouldConsiderNudge(0, 0)).toBe(false)
  })

  test('an engaged user dropping to a low balance is nudged', () => {
    expect(shouldConsiderNudge(1, 1)).toBe(true)
    expect(shouldConsiderNudge(0, 3)).toBe(true)
  })

  test('an engaged user with plenty of credits is not nudged', () => {
    expect(shouldConsiderNudge(5, 3)).toBe(false)
  })

  test('a brand-new user is never nudged regardless of balance', () => {
    expect(shouldConsiderNudge(0, 0)).toBe(false)
    expect(shouldConsiderNudge(1, 0)).toBe(false)
  })
})

describe('nudgeEnabledFromPrefs', () => {
  test('opt-out, not opt-in: missing preferences default to enabled', () => {
    expect(nudgeEnabledFromPrefs(undefined)).toBe(true)
    expect(nudgeEnabledFromPrefs(null)).toBe(true)
    expect(nudgeEnabledFromPrefs({})).toBe(true)
  })

  test('an explicit false disables it', () => {
    expect(nudgeEnabledFromPrefs({ low_credit_nudge: false })).toBe(false)
  })

  test('an explicit true keeps it enabled', () => {
    expect(nudgeEnabledFromPrefs({ low_credit_nudge: true })).toBe(true)
  })
})
