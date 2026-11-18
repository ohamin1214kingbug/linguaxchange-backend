const { cleanAnswers, isComplete, summarize } = require('../utils/survey')

test('keeps valid answers, drops unknown ones, caps goals at 2', () => {
  expect(cleanAnswers({ heard_from: 'poster', heard_detail: '  Filología ', who: 'hacker', goals: ['speaking', 'travel', 'exam', 'bogus'], times: ['weekend', 'weekend'] }))
    .toEqual({ heard_from: 'poster', heard_detail: 'Filología', who: null, goals: ['speaking', 'travel'], times: ['weekend'] })
  expect(cleanAnswers({})).toEqual({})
})

test('complete needs questions 1-4; ideas are optional', () => {
  const row = { heard_from: 'tiktok', who: 'ucm', goals: ['speaking'], times: ['weekend'] }
  expect(isComplete(row)).toBe(true)
  expect(isComplete({ ...row, times: [] })).toBe(false)
})

test('summary counts only finished surveys', () => {
  const s = summarize([
    { heard_from: 'poster', heard_detail: 'Filología', who: 'ucm', who_detail: 'Comercio y Turismo', goals: ['speaking'], times: ['weekend'], ideas: 'More German', completed_at: '2026-11-18T10:00:00Z' },
    { heard_from: 'tiktok', who: 'erasmus', goals: [], times: [], completed_at: null },
  ])
  expect(s.answered).toBe(1)
  expect(s.heard.poster).toBe(1)
  expect(s.heard.tiktok).toBe(0)
  expect(s.posterFaculties).toEqual({ 'Filología': 1 })
  expect(s.ideas).toEqual(['More German'])
})
