const { validateReport } = require('../utils/reports')

const valid = extra => ({ report_type: 'user', reported_id: 7, reason: 'Was rude and cancelled last minute', ...extra })

describe('validateReport', () => {
  test('accepts a valid user report', () => {
    const r = validateReport(valid())
    expect(r.ok).toBe(true)
    expect(r.report_type).toBe('user')
    expect(r.reported_type).toBe('user')
    expect(r.reported_id).toBe(7)
  })

  test('accepts a class report', () => {
    const r = validateReport(valid({ report_type: 'class' }))
    expect(r.ok).toBe(true)
    expect(r.reported_type).toBe('class')
  })

  test('rejects an unknown or missing report_type', () => {
    expect(validateReport(valid({ report_type: 'content' })).ok).toBe(false)
    expect(validateReport(valid({ report_type: '' })).ok).toBe(false)
  })

  test('rejects a missing or zero reported_id', () => {
    expect(validateReport(valid({ reported_id: 0 })).ok).toBe(false)
    expect(validateReport(valid({ reported_id: undefined })).ok).toBe(false)
  })

  test('requires a non-blank reason within the length cap', () => {
    expect(validateReport(valid({ reason: '  ' })).ok).toBe(false)
    expect(validateReport(valid({ reason: 'x'.repeat(501) })).ok).toBe(false)
    expect(validateReport(valid({ reason: 'x'.repeat(500) })).ok).toBe(true)
  })

  test('trims the reason', () => {
    expect(validateReport(valid({ reason: '  rude  ' })).reason).toBe('rude')
  })
})
