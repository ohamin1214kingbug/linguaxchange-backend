const { validateRequest, expiresAt, hoursLeft, REQUEST_TTL_HOURS } = require('../utils/classRequests')

const NOW = new Date('2026-08-06T12:00:00Z')
const SOON = '2026-08-08T18:00:00Z'

const valid = extra => ({
  language_code: 'ES',
  topic: 'Pronouns in Spanish',
  max_students: 4,
  preferred_time: SOON,
  ...extra
})

describe('validateRequest', () => {
  test('accepts a complete request and normalises it', () => {
    const r = validateRequest(valid({ level: 'A2', details: '  direct vs indirect  ', time_flexible: true }), NOW)
    expect(r.ok).toBe(true)
    expect(r.topic).toBe('Pronouns in Spanish')
    expect(r.details).toBe('direct vs indirect')
    expect(r.level).toBe('A2')
    expect(r.time_flexible).toBe(true)
    expect(r.preferred_time).toBe(new Date(SOON).toISOString())
  })

  test('level and details are optional', () => {
    const r = validateRequest(valid(), NOW)
    expect(r.ok).toBe(true)
    expect(r.level).toBeNull()
    expect(r.details).toBeNull()
    expect(r.time_flexible).toBe(false)
  })

  test('rejects an unknown language or level', () => {
    expect(validateRequest(valid({ language_code: 'XX' }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ language_code: '' }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ level: 'C3' }), NOW).ok).toBe(false)
  })

  test('requires a topic within the length cap', () => {
    expect(validateRequest(valid({ topic: '   ' }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ topic: 'x'.repeat(81) }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ topic: 'x'.repeat(80) }), NOW).ok).toBe(true)
  })

  test('rejects a class size outside 1-20', () => {
    expect(validateRequest(valid({ max_students: 0 }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ max_students: 21 }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ max_students: 2.5 }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ max_students: '6' }), NOW).ok).toBe(true)
  })

  test('needs a real future time even when flexible', () => {
    expect(validateRequest(valid({ preferred_time: '' }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ preferred_time: 'not a date' }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ preferred_time: '2026-08-05T12:00:00Z' }), NOW).ok).toBe(false)
    expect(validateRequest(valid({ preferred_time: '', time_flexible: true }), NOW).ok).toBe(false)
  })
})

describe('expiry', () => {
  test('expires 24 hours after posting', () => {
    expect(expiresAt(NOW).toISOString()).toBe('2026-08-07T12:00:00.000Z')
    expect(hoursLeft(expiresAt(NOW), NOW)).toBe(REQUEST_TTL_HOURS)
  })

  test('counts down and floors at zero', () => {
    const expires = expiresAt(NOW)
    expect(hoursLeft(expires, new Date('2026-08-07T09:30:00Z'))).toBe(2)
    expect(hoursLeft(expires, new Date('2026-08-07T11:59:00Z'))).toBe(0)
    expect(hoursLeft(expires, new Date('2026-08-08T00:00:00Z'))).toBe(0)
  })
})
