// computeEarnedBadges is pure, but the module also creates a Supabase client
// at import time — mock it out so this stays a fast, isolated unit test.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({})
}))

const { computeEarnedBadges } = require('../utils/badges')

function badgeIds(stats) {
  return computeEarnedBadges(stats).map(b => b.id)
}

describe('computeEarnedBadges', () => {
  test('a brand new user with zero activity earns no badges (not an error)', () => {
    const result = computeEarnedBadges({ taughtCount: 0, attendedCount: 0, languageCount: 0 })
    expect(result).toEqual([])
  })

  test('first_class is earned by teaching, even with zero attendance', () => {
    expect(badgeIds({ taughtCount: 1, attendedCount: 0, languageCount: 1 })).toEqual(['first_class'])
  })

  test('first_class is earned by attending, even with zero teaching', () => {
    expect(badgeIds({ taughtCount: 0, attendedCount: 1, languageCount: 1 })).toEqual(['first_class'])
  })

  test('five_taught is not earned at 4 taught classes', () => {
    expect(badgeIds({ taughtCount: 4, attendedCount: 0, languageCount: 1 })).toEqual(['first_class'])
  })

  test('five_taught is earned at exactly 5 taught classes', () => {
    expect(badgeIds({ taughtCount: 5, attendedCount: 0, languageCount: 1 })).toEqual(
      expect.arrayContaining(['first_class', 'five_taught'])
    )
  })

  test('five_taught does not count attended classes toward the threshold', () => {
    expect(badgeIds({ taughtCount: 0, attendedCount: 5, languageCount: 1 })).toEqual(['first_class'])
  })

  test('polyglot is not earned at 2 distinct languages', () => {
    expect(badgeIds({ taughtCount: 1, attendedCount: 0, languageCount: 2 })).toEqual(['first_class'])
  })

  test('polyglot is earned at exactly 3 distinct languages', () => {
    expect(badgeIds({ taughtCount: 1, attendedCount: 0, languageCount: 3 })).toEqual(
      expect.arrayContaining(['first_class', 'polyglot'])
    )
  })

  test('acceptance criteria: 5 taught sessions across 3 languages earns all three badges', () => {
    const result = computeEarnedBadges({ taughtCount: 5, attendedCount: 0, languageCount: 3 })
    expect(result.map(b => b.id).sort()).toEqual(['first_class', 'five_taught', 'polyglot'])
  })

  test('each earned badge includes id, icon, label, and criteria', () => {
    const [badge] = computeEarnedBadges({ taughtCount: 1, attendedCount: 0, languageCount: 1 })
    expect(badge).toEqual({
      id: 'first_class',
      icon: expect.any(String),
      label: expect.any(String),
      criteria: expect.any(String)
    })
  })
})
