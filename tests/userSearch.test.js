const { parseUserQuery, MIN_QUERY, MAX_RESULTS } = require('../utils/userSearch')

describe('parseUserQuery', () => {
  test('a user code becomes an exact id lookup', () => {
    expect(parseUserQuery('U000012')).toEqual({ ok: true, id: 12, term: null })
  })

  test('lowercase and stray space still read as a code — that is how it gets pasted', () => {
    expect(parseUserQuery('  u000012 ')).toEqual({ ok: true, id: 12, term: null })
  })

  test('a name becomes a term, not an id', () => {
    expect(parseUserQuery('Hamin')).toEqual({ ok: true, id: null, term: 'Hamin' })
  })

  // Someone typing a name is not typing a malformed code; falling back to a
  // name search is right, and refusing would make "Ulrich" unsearchable.
  test('a name that starts with U is a name', () => {
    expect(parseUserQuery('Ulrich')).toEqual({ ok: true, id: null, term: 'Ulrich' })
  })

  test('non-latin names are terms like any other', () => {
    expect(parseUserQuery('경훈')).toEqual({ ok: true, id: null, term: '경훈' })
  })

  test('too short is refused, so one letter cannot list the site', () => {
    for (const q of ['', ' ', 'a', ' x ']) expect(parseUserQuery(q).ok).toBe(false)
  })

  test('a two-character name is the shortest allowed', () => {
    expect(parseUserQuery('Oh')).toEqual({ ok: true, id: null, term: 'Oh' })
    expect(MIN_QUERY).toBe(2)
  })

  // PostgREST's .or() filter treats these as syntax; a name containing one
  // would otherwise change the shape of the query rather than be matched.
  test('characters with meaning in the filter syntax are stripped', () => {
    expect(parseUserQuery('Oh,(x)').term).toBe('Ohx')
  })

  test('a query that is only punctuation has nothing left to match', () => {
    expect(parseUserQuery('(),,()').ok).toBe(false)
  })

  test('caps how many rows a single query can return', () => {
    expect(MAX_RESULTS).toBe(20)
  })
})
