jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const { isOverCap, WEEKLY_FEEDBACK_CAP } = require('../utils/assignmentCredits')

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
