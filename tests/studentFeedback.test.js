const { validateFeedback, SKILLS } = require('../utils/studentFeedback')

describe('validateFeedback', () => {
  test('accepts a partial rating and leaves unrated skills null', () => {
    const r = validateFeedback({ vocabulary: 4, grammar: 2 })
    expect(r.ok).toBe(true)
    expect(r.skills.vocabulary).toBe(4)
    expect(r.skills.grammar).toBe(2)
    expect(r.skills.fluency).toBeNull()
  })

  test('accepts numeric strings from a form post', () => {
    const r = validateFeedback({ listening: '5' })
    expect(r.ok).toBe(true)
    expect(r.skills.listening).toBe(5)
  })

  test('rejects an out-of-range score', () => {
    expect(validateFeedback({ fluency: 6 }).ok).toBe(false)
    expect(validateFeedback({ fluency: 0 }).ok).toBe(false)
    expect(validateFeedback({ fluency: 2.5 }).ok).toBe(false)
  })

  test('rejects a submission with nothing rated', () => {
    expect(validateFeedback({}).ok).toBe(false)
    expect(validateFeedback({ comment: 'nice work' }).ok).toBe(false)
  })

  test('rejects an over-long comment', () => {
    const r = validateFeedback({ grammar: 3, comment: 'x'.repeat(301) })
    expect(r.ok).toBe(false)
  })

  test('trims the comment and nulls it when blank', () => {
    expect(validateFeedback({ grammar: 3, comment: '  ok  ' }).comment).toBe('ok')
    expect(validateFeedback({ grammar: 3, comment: '   ' }).comment).toBeNull()
  })

  test('covers every skill column the table defines', () => {
    expect(SKILLS).toHaveLength(7)
    const r = validateFeedback(Object.fromEntries(SKILLS.map(s => [s, 3])))
    expect(SKILLS.every(s => r.skills[s] === 3)).toBe(true)
  })
})
