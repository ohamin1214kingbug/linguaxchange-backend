// blocksSpend is pure, but the module also creates a Supabase client at
// import time — mock it out so this stays a fast, isolated unit test.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({})
}))

const { blocksSpend } = require('../utils/creditSpendGate')

describe('blocksSpend', () => {
  test('blocks a never-taught user from spending their last credit (the 3rd of 3 free credits)', () => {
    // balance 1 -> spend -> 0, never taught
    expect(blocksSpend(0, false)).toBe(true)
  })

  test('does not block a user who has taught before, even at 0 after spending', () => {
    expect(blocksSpend(0, true)).toBe(false)
  })

  test('does not block a never-taught user while credits remain after the spend', () => {
    // 3 -> 2 and 2 -> 1 should both be fine regardless of teaching history
    expect(blocksSpend(2, false)).toBe(false)
    expect(blocksSpend(1, false)).toBe(false)
  })

  test('never blocks a user who has taught, at any resulting balance', () => {
    expect(blocksSpend(5, true)).toBe(false)
    expect(blocksSpend(1, true)).toBe(false)
    expect(blocksSpend(0, true)).toBe(false)
  })
})
