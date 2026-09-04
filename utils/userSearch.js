const { userIdFromCode } = require('./reports')

// Two characters, because one letter would turn the search box into a
// listing of everyone whose name starts with that letter.
const MIN_QUERY = 2

// A lookup, not a directory. Someone who remembers a name gets their
// answer in the first few rows; someone harvesting the member list has to
// work for it one query at a time.
const MAX_RESULTS = 20

// Decides what the person typed: a user code is an exact id, anything else
// is a name.
//
// The code parser is the one the report form already uses, so "U000012"
// cannot mean one thing here and another there.
function parseUserQuery(q) {
  const raw = String(q || '').trim()
  if (raw.length < MIN_QUERY) return { ok: false, error: `Type at least ${MIN_QUERY} characters` }

  const id = userIdFromCode(raw)
  if (id) return { ok: true, id, term: null }

  // ( ) and , are operators inside PostgREST's .or() filter — a name
  // containing one would alter the query's shape instead of being matched.
  const term = raw.replace(/[(),]/g, '').trim()
  if (term.length < MIN_QUERY) return { ok: false, error: `Type at least ${MIN_QUERY} characters` }

  return { ok: true, id: null, term }
}

module.exports = { parseUserQuery, MIN_QUERY, MAX_RESULTS }
