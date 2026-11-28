jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
const { cleanInterests, sharedInterests } = require('../utils/interests')
const { tandemMatches, openPeople } = require('../utils/tandem')

test('keeps known tags, no duplicates, at most 5, in list order', () => {
  expect(cleanInterests(['travel', 'music', 'travel', 'hacking'])).toEqual(['music', 'travel'])
  expect(cleanInterests(['daily', 'pets', 'humour', 'culture', 'art', 'tech'])).toEqual(['tech', 'art', 'culture', 'humour', 'pets'])
  expect(cleanInterests([])).toEqual([])
  expect(cleanInterests('music')).toBeNull()
})

test('counts shared interests', () => {
  expect(sharedInterests({ interests: ['music', 'travel'] }, { interests: ['travel', 'music', 'books'] })).toBe(2)
  expect(sharedInterests({}, { interests: ['music'] })).toBe(0)
})

test('partners who share interests come right after perfect matches', () => {
  const me = { id: 1, teach_language: 'ko', learn_languages: ['es'], interests: ['music', 'travel'] }
  const others = [
    { id: 2, teach_language: 'es', learn_languages: ['ko'], interests: [] },
    { id: 3, teach_language: 'es', learn_languages: ['ko'], interests: ['music'] },
    { id: 4, teach_language: 'es', learn_languages: ['fr'], interests: ['music', 'travel'] },
  ]
  expect(tandemMatches(me, others).map(u => u.id)).toEqual([3, 2, 4])
  expect(openPeople(me, others).map(u => [u.id, u.sharedInterests])).toEqual([[3, 1], [2, 0], [4, 2]])
})
