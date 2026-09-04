const { parseUserQuery, MIN_QUERY, MAX_RESULTS, MAX_TERMS } = require('../utils/userSearch')

describe('parseUserQuery', () => {
  test('a user code becomes an exact id lookup', () => {
    expect(parseUserQuery('U000012')).toEqual({ ok: true, id: 12, term: null })
  })

  test('lowercase and stray space still read as a code — that is how it gets pasted', () => {
    expect(parseUserQuery('  u000012 ')).toEqual({ ok: true, id: 12, term: null })
  })

  test('a name becomes a term, not an id', () => {
    expect(parseUserQuery('Hamin')).toEqual({ ok: true, id: null, terms: ['Hamin'] })
  })

  // Someone typing a name is not typing a malformed code; falling back to a
  // name search is right, and refusing would make "Ulrich" unsearchable.
  test('a name that starts with U is a name', () => {
    expect(parseUserQuery('Ulrich')).toEqual({ ok: true, id: null, terms: ['Ulrich'] })
  })

  test('non-latin names are terms like any other', () => {
    expect(parseUserQuery('경훈')).toEqual({ ok: true, id: null, terms: ['경훈'] })
  })

  test('too short is refused, so one letter cannot list the site', () => {
    for (const q of ['', ' ', 'a', ' x ']) expect(parseUserQuery(q).ok).toBe(false)
  })

  test('a two-character name is the shortest allowed', () => {
    expect(parseUserQuery('Oh')).toEqual({ ok: true, id: null, terms: ['Oh'] })
    expect(MIN_QUERY).toBe(2)
  })

  // PostgREST's .or() filter treats these as syntax; a name containing one
  // would otherwise change the shape of the query rather than be matched.
  test('characters with meaning in the filter syntax are stripped', () => {
    expect(parseUserQuery('Oh,(x)').terms).toEqual(['Ohx'])
  })

  test('a query that is only punctuation has nothing left to match', () => {
    expect(parseUserQuery('(),,()').ok).toBe(false)
  })

  // The bug this split fixes: searching a person's whole name found nobody,
  // because neither column contains both halves of it.
  test('a full name splits into one term per word', () => {
    expect(parseUserQuery('경훈 박')).toEqual({ ok: true, id: null, terms: ['경훈', '박'] })
    expect(parseUserQuery('Hamin Oh')).toEqual({ ok: true, id: null, terms: ['Hamin', 'Oh'] })
  })

  test('a one-character surname survives the split', () => {
    expect(parseUserQuery('경훈 박').terms).toContain('박')
  })

  test('runs of whitespace do not become empty terms', () => {
    expect(parseUserQuery('  Hamin   Oh  ').terms).toEqual(['Hamin', 'Oh'])
  })

  test('a pasted sentence is capped rather than becoming one filter per word', () => {
    const many = parseUserQuery('one two three four five six seven')
    expect(many.terms).toHaveLength(MAX_TERMS)
  })

  test('caps how many rows a single query can return', () => {
    expect(MAX_RESULTS).toBe(20)
  })
})
