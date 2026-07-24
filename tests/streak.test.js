// getWeekStart/computeStreakUpdate are pure, but the module also creates a Supabase
// client at import time — mock it out so this stays a fast, isolated unit test.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({})
}))

const { getWeekStart, computeStreakUpdate } = require('../utils/streak')

describe('getWeekStart', () => {
  test('returns the Monday of the same week for a mid-week date', () => {
    expect(getWeekStart(new Date('2026-07-22T10:00:00Z'))).toBe('2026-07-20') // Wednesday -> Monday
  })

  test('a Monday maps to itself', () => {
    expect(getWeekStart(new Date('2026-07-20T00:00:00Z'))).toBe('2026-07-20')
  })

  test('a Sunday maps to the Monday that started its week', () => {
    expect(getWeekStart(new Date('2026-07-26T23:59:00Z'))).toBe('2026-07-20')
  })
})

describe('computeStreakUpdate', () => {
  const empty = { current_streak: 0, longest_streak: 0, last_active_week: null }

  test('first-ever activity starts the streak at 1, not 0', () => {
    const result = computeStreakUpdate(empty, new Date('2026-07-22T10:00:00Z'))
    expect(result).toEqual({ current_streak: 1, longest_streak: 1, last_active_week: '2026-07-20' })
  })

  test('a second class in the same week does not increase the streak', () => {
    const afterFirst = { current_streak: 1, longest_streak: 1, last_active_week: '2026-07-20' }
    const result = computeStreakUpdate(afterFirst, new Date('2026-07-24T10:00:00Z')) // same week, Friday
    expect(result).toEqual({ current_streak: 1, longest_streak: 1, last_active_week: '2026-07-20' })
  })

  test('activity exactly one week later increments the streak', () => {
    const afterFirst = { current_streak: 1, longest_streak: 1, last_active_week: '2026-07-20' }
    const result = computeStreakUpdate(afterFirst, new Date('2026-07-27T10:00:00Z')) // next Monday's week
    expect(result).toEqual({ current_streak: 2, longest_streak: 2, last_active_week: '2026-07-27' })
  })

  test('a missed week resets current_streak to 1, not 0', () => {
    const afterTwo = { current_streak: 2, longest_streak: 2, last_active_week: '2026-07-20' }
    const result = computeStreakUpdate(afterTwo, new Date('2026-08-10T10:00:00Z')) // 3 weeks later, gap
    expect(result.current_streak).toBe(1)
    expect(result.last_active_week).toBe('2026-08-10')
  })

  test('longest_streak never decreases after a reset', () => {
    const afterFive = { current_streak: 5, longest_streak: 5, last_active_week: '2026-07-20' }
    const result = computeStreakUpdate(afterFive, new Date('2026-08-10T10:00:00Z')) // gap resets current to 1
    expect(result.current_streak).toBe(1)
    expect(result.longest_streak).toBe(5)
  })

  test('longest_streak updates once current_streak surpasses it', () => {
    const atRecord = { current_streak: 3, longest_streak: 3, last_active_week: '2026-07-20' }
    const result = computeStreakUpdate(atRecord, new Date('2026-07-27T10:00:00Z'))
    expect(result).toEqual({ current_streak: 4, longest_streak: 4, last_active_week: '2026-07-27' })
  })

  test('crossing a month boundary still counts as consecutive when exactly 7 days apart', () => {
    const lastWeekOfJuly = { current_streak: 3, longest_streak: 3, last_active_week: '2026-07-27' }
    const result = computeStreakUpdate(lastWeekOfJuly, new Date('2026-08-03T10:00:00Z')) // next Monday's week
    expect(result).toEqual({ current_streak: 4, longest_streak: 4, last_active_week: '2026-08-03' })
  })
})
