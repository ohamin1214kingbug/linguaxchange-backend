const { validateResource } = require('../utils/resources')

const valid = extra => ({
  language_code: 'ES',
  level: 'A1',
  title: 'Spanish A1 — What to Study',
  ...extra,
})

describe('validateResource', () => {
  test('accepts a minimal valid resource', () => {
    const r = validateResource(valid())
    expect(r.ok).toBe(true)
    expect(r.language_code).toBe('ES')
    expect(r.level).toBe('A1')
    expect(r.audience).toBe('learner')
    expect(r.description).toBe(null)
    expect(r.source_url).toBe(null)
    expect(r.attribution).toBe(null)
  })

  test('normalises language and level to uppercase', () => {
    const r = validateResource(valid({ language_code: 'es', level: 'b1' }))
    expect(r.language_code).toBe('ES')
    expect(r.level).toBe('B1')
  })

  test('rejects an unknown language or level', () => {
    expect(validateResource(valid({ language_code: 'ZZ' })).ok).toBe(false)
    expect(validateResource(valid({ language_code: '' })).ok).toBe(false)
    expect(validateResource(valid({ level: 'A3' })).ok).toBe(false)
    expect(validateResource(valid({ level: undefined })).ok).toBe(false)
  })

  test('rejects an unknown audience but defaults to learner', () => {
    expect(validateResource(valid()).audience).toBe('learner')
    expect(validateResource(valid({ audience: 'teacher' })).ok).toBe(true)
    expect(validateResource(valid({ audience: 'recruiter' })).ok).toBe(false)
  })

  test('requires a non-blank title within the length cap', () => {
    expect(validateResource(valid({ title: '   ' })).ok).toBe(false)
    expect(validateResource(valid({ title: 'x'.repeat(201) })).ok).toBe(false)
    expect(validateResource(valid({ title: 'x'.repeat(200) })).ok).toBe(true)
  })

  test('trims the title and description', () => {
    const r = validateResource(valid({ title: '  Guide  ', description: '  Text  ' }))
    expect(r.title).toBe('Guide')
    expect(r.description).toBe('Text')
  })

  test('caps the description length', () => {
    expect(validateResource(valid({ description: 'x'.repeat(1001) })).ok).toBe(false)
    expect(validateResource(valid({ description: 'x'.repeat(1000) })).ok).toBe(true)
  })

  test('accepts an http(s) source URL and rejects anything else', () => {
    expect(validateResource(valid({ source_url: 'https://www.uned.es/x' })).ok).toBe(true)
    expect(validateResource(valid({ source_url: 'http://uned.es' })).ok).toBe(true)
    expect(validateResource(valid({ source_url: 'javascript:alert(1)' })).ok).toBe(false)
    expect(validateResource(valid({ source_url: 'uned.es' })).ok).toBe(false)
  })

  test('an empty source URL is allowed and stored as null', () => {
    expect(validateResource(valid({ source_url: '' })).source_url).toBe(null)
    expect(validateResource(valid({ source_url: '   ' })).source_url).toBe(null)
  })
})
