const { validateReport, CATEGORIES, MAX_REASON } = require('../utils/reports')

const valid = { report_type: 'user', reported_id: 12, reason: 'Sent me abusive messages', category: 'harassment' }

describe('validateReport', () => {
  test('accepts a well-formed user report', () => {
    const result = validateReport(valid)
    expect(result.ok).toBe(true)
    expect(result.category).toBe('harassment')
  })

  test('lists exactly the five agreed categories', () => {
    expect(CATEGORIES).toEqual(['harassment', 'inappropriate_content', 'spam_or_scam', 'no_show', 'other'])
  })

  test('rejects a category that is not one of them', () => {
    expect(validateReport({ ...valid, category: 'i_dont_like_them' }).ok).toBe(false)
  })

  // The category is a sorting aid, never a substitute for saying what
  // happened, so the free-text reason stays required.
  test('still requires a reason even with a category', () => {
    expect(validateReport({ ...valid, reason: '   ' }).ok).toBe(false)
  })

  test('defaults a missing category to other rather than refusing', () => {
    expect(validateReport({ ...valid, category: undefined }).category).toBe('other')
  })

  test('rejects a reason past the limit', () => {
    expect(validateReport({ ...valid, reason: 'x'.repeat(MAX_REASON + 1) }).ok).toBe(false)
  })

  test('rejects a report with no target', () => {
    expect(validateReport({ ...valid, reported_id: undefined }).ok).toBe(false)
  })
})
