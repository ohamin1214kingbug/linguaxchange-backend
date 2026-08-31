const { summarise } = require('../utils/participation')

const a = (extra = {}) => ({
  language_code: 'ES', level: 'A1', duration_minutes: 60,
  date: '2026-09-01T17:00:00.000Z', ...extra,
})

describe('summarise', () => {
  test('counts attended and taught separately', () => {
    const r = summarise({ attended: [a(), a()], taught: [a()] })
    expect(r.attendedCount).toBe(2)
    expect(r.taughtCount).toBe(1)
  })

  test('sums minutes from duration_minutes', () => {
    const r = summarise({ attended: [a({ duration_minutes: 60 }), a({ duration_minutes: 90 })], taught: [] })
    expect(r.attendedMinutes).toBe(150)
  })

  test('counts a missing duration as zero rather than NaN', () => {
    const r = summarise({ attended: [a({ duration_minutes: null }), a({ duration_minutes: 60 })], taught: [] })
    expect(r.attendedMinutes).toBe(60)
  })

  test('lists distinct languages and levels across both sides', () => {
    const r = summarise({
      attended: [a({ language_code: 'ES', level: 'A1' }), a({ language_code: 'ES', level: 'A1' })],
      taught: [a({ language_code: 'KO', level: 'B1' })],
    })
    expect(r.languages.sort()).toEqual(['ES', 'KO'])
    expect(r.levels.sort()).toEqual(['A1', 'B1'])
  })

  test('reports the first and last activity across both sides', () => {
    const r = summarise({
      attended: [a({ date: '2026-09-10T17:00:00.000Z' })],
      taught: [a({ date: '2026-08-01T17:00:00.000Z' })],
    })
    expect(r.firstActivity).toBe('2026-08-01T17:00:00.000Z')
    expect(r.lastActivity).toBe('2026-09-10T17:00:00.000Z')
  })

  test('returns zeroes and nulls for someone with no activity', () => {
    expect(summarise({ attended: [], taught: [] })).toEqual({
      attendedCount: 0, taughtCount: 0,
      attendedMinutes: 0, taughtMinutes: 0,
      languages: [], levels: [],
      firstActivity: null, lastActivity: null,
    })
  })

  test('tolerates missing arrays', () => {
    expect(summarise({}).attendedCount).toBe(0)
    expect(summarise().taughtCount).toBe(0)
  })

  test('ignores rows with no usable date when picking the range', () => {
    const r = summarise({ attended: [a({ date: null }), a({ date: '2026-09-05T17:00:00.000Z' })], taught: [] })
    expect(r.firstActivity).toBe('2026-09-05T17:00:00.000Z')
    expect(r.lastActivity).toBe('2026-09-05T17:00:00.000Z')
  })
})
