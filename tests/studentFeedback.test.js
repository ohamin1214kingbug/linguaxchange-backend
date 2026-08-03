const { validateFeedback, SKILLS, MIN_SKILLS } = require('../utils/studentFeedback')

// Enough skills to clear the minimum, for tests about something else.
const enough = extra => ({ vocabulary: 4, grammar: 2, fluency: 3, ...extra })

describe('validateFeedback', () => {
  test('accepts a partial rating and leaves unrated skills null', () => {
    const r = validateFeedback(enough())
    expect(r.ok).toBe(true)
    expect(r.skills.vocabulary).toBe(4)
    expect(r.skills.grammar).toBe(2)
    expect(r.skills.listening).toBeNull()
  })

  test('accepts numeric strings from a form post', () => {
    const r = validateFeedback({ listening: '5', grammar: '3', fluency: '1' })
    expect(r.ok).toBe(true)
    expect(r.skills.listening).toBe(5)
    expect(r.skills.fluency).toBe(1)
  })

  test('rejects an out-of-range score', () => {
    expect(validateFeedback(enough({ fluency: 6 })).ok).toBe(false)
    expect(validateFeedback(enough({ fluency: 0 })).ok).toBe(false)
    expect(validateFeedback(enough({ fluency: 2.5 })).ok).toBe(false)
  })

  test(`requires at least ${MIN_SKILLS} skills`, () => {
    expect(validateFeedback({}).ok).toBe(false)
    expect(validateFeedback({ comment: 'nice work' }).ok).toBe(false)
    expect(validateFeedback({ grammar: 4 }).ok).toBe(false)
    expect(validateFeedback({ grammar: 4, fluency: 3 }).ok).toBe(false)
    expect(validateFeedback({ grammar: 4, fluency: 3, listening: 2 }).ok).toBe(true)
  })

  test('rejects an over-long comment', () => {
    const r = validateFeedback(enough({ comment: 'x'.repeat(301) }))
    expect(r.ok).toBe(false)
  })

  test('trims the comment and nulls it when blank', () => {
    expect(validateFeedback(enough({ comment: '  ok  ' })).comment).toBe('ok')
    expect(validateFeedback(enough({ comment: '   ' })).comment).toBeNull()
  })

  test('covers every skill column the table defines', () => {
    expect(SKILLS).toHaveLength(7)
    const r = validateFeedback(Object.fromEntries(SKILLS.map(s => [s, 3])))
    expect(SKILLS.every(s => r.skills[s] === 3)).toBe(true)
  })
})
