const {
  countWords, validateAssignmentRequest, MAX_WORDS, expiresAt,
  validateFeedback, CATEGORIES, MAX_ANNOTATIONS
} = require('../utils/assignmentValidation')

describe('countWords', () => {
  test('counts whitespace-separated tokens', () => {
    expect(countWords('hola que tal')).toBe(3)
  })

  test('ignores leading, trailing and repeated whitespace', () => {
    expect(countWords('  hola   que \n tal  ')).toBe(3)
  })

  test('an empty or whitespace-only string is zero, not one', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n  ')).toBe(0)
  })

  test('a non-string is zero rather than throwing', () => {
    expect(countWords(null)).toBe(0)
    expect(countWords(undefined)).toBe(0)
    expect(countWords(42)).toBe(0)
  })
})

describe('validateAssignmentRequest', () => {
  const good = {
    language_code: 'ES',
    level: 'B1',
    prompt: 'An email to my landlord about the heating',
    body: 'Estimado señor, le escribo porque la calefacción no funciona.'
  }

  test('accepts a well-formed request and returns cleaned fields', () => {
    const r = validateAssignmentRequest(good)
    expect(r.ok).toBe(true)
    expect(r.language_code).toBe('ES')
    expect(r.level).toBe('B1')
    expect(r.prompt).toBe(good.prompt)
    expect(r.body).toBe(good.body)
  })

  test('rejects an unknown language', () => {
    const r = validateAssignmentRequest({ ...good, language_code: 'XX' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/language/i)
  })

  test('accepts a missing level, since a passage need not have one', () => {
    const r = validateAssignmentRequest({ ...good, level: undefined })
    expect(r.ok).toBe(true)
    expect(r.level).toBe(null)
  })

  test('rejects a level that is not on the CEFR ladder', () => {
    expect(validateAssignmentRequest({ ...good, level: 'B3' }).ok).toBe(false)
  })

  test('requires a prompt, because feedback without intent is guesswork', () => {
    expect(validateAssignmentRequest({ ...good, prompt: '   ' }).ok).toBe(false)
  })

  test('accepts exactly MAX_WORDS and rejects one more', () => {
    const at = Array(MAX_WORDS).fill('palabra').join(' ')
    const over = Array(MAX_WORDS + 1).fill('palabra').join(' ')
    expect(validateAssignmentRequest({ ...good, body: at }).ok).toBe(true)
    const r = validateAssignmentRequest({ ...good, body: over })
    expect(r.ok).toBe(false)
    expect(r.error).toContain(String(MAX_WORDS))
  })

  test('rejects an empty body', () => {
    expect(validateAssignmentRequest({ ...good, body: '   ' }).ok).toBe(false)
  })

  test('preserves the body exactly, because annotation offsets index into it', () => {
    const spaced = 'uno  dos\ttres'
    const r = validateAssignmentRequest({ ...good, body: spaced })
    expect(r.body).toBe(spaced)
  })
})

describe('expiresAt', () => {
  test('is 72 hours after the given moment', () => {
    const from = new Date('2026-09-03T10:00:00Z')
    expect(expiresAt(from).toISOString()).toBe('2026-09-06T10:00:00.000Z')
  })
})

describe('validateFeedback', () => {
  const body = 'Estimado señor, le escribo porque la calefacción no funciona.'
  const ann = (over = {}) => ({ start: 0, end: 8, category: 'register', note: 'Too formal for a landlord you know.', ...over })

  test('accepts well-formed annotations', () => {
    const r = validateFeedback({ annotations: [ann()], overall: 'Solid tenses.' }, body)
    expect(r.ok).toBe(true)
    expect(r.annotations).toHaveLength(1)
    expect(r.annotations[0].category).toBe('register')
  })

  test('requires at least one annotation, since the point is marking spans', () => {
    const r = validateFeedback({ annotations: [], overall: 'Looks fine!' }, body)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/at least one/i)
  })

  test('rejects an offset past the end of the body', () => {
    const r = validateFeedback({ annotations: [ann({ end: body.length + 1 })] }, body)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/outside/i)
  })

  test('rejects a negative start', () => {
    expect(validateFeedback({ annotations: [ann({ start: -1 })] }, body).ok).toBe(false)
  })

  test('rejects an inverted range', () => {
    expect(validateFeedback({ annotations: [ann({ start: 10, end: 4 })] }, body).ok).toBe(false)
  })

  test('rejects a zero-length span, which marks nothing', () => {
    expect(validateFeedback({ annotations: [ann({ start: 5, end: 5 })] }, body).ok).toBe(false)
  })

  test('rejects an unknown category', () => {
    const r = validateFeedback({ annotations: [ann({ category: 'vibes' })] }, body)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/categor/i)
  })

  test('requires a note explaining why, because that is the whole product', () => {
    const r = validateFeedback({ annotations: [ann({ note: '  ' })] }, body)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/why/i)
  })

  test('rejects more annotations than the cap', () => {
    const many = Array(MAX_ANNOTATIONS + 1).fill(null).map(() => ann())
    expect(validateFeedback({ annotations: many }, body).ok).toBe(false)
  })

  test('allows an absent overall comment', () => {
    const r = validateFeedback({ annotations: [ann()] }, body)
    expect(r.ok).toBe(true)
    expect(r.overall).toBe(null)
  })

  test('rejects an overall comment past the limit, which is what keeps a rewrite out', () => {
    const long = 'a'.repeat(501)
    const r = validateFeedback({ annotations: [ann()], overall: long }, body)
    expect(r.ok).toBe(false)
  })

  test('every category is a stable lowercase key, never a display string', () => {
    for (const c of CATEGORIES) expect(c).toMatch(/^[a-z][a-z-]*$/)
  })

  test('keeps only the four known annotation fields', () => {
    const r = validateFeedback({ annotations: [ann({ evil: 'x' })] }, body)
    expect(Object.keys(r.annotations[0]).sort()).toEqual(['category', 'end', 'note', 'start'])
  })

  test('rejects a non-string body (object)', () => {
    const r = validateFeedback({ annotations: [ann()] }, { body: 'text' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/text to annotate/i)
  })

  test('rejects a null body', () => {
    const r = validateFeedback({ annotations: [ann()] }, null)
    expect(r.ok).toBe(false)
  })
})
