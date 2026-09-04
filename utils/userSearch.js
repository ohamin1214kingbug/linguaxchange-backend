const { userIdFromCode } = require('./reports')

// Two characters, because one letter would turn the search box into a
// listing of everyone whose name starts with that letter.
const MIN_QUERY = 2

// A lookup, not a directory. Someone who remembers a name gets their
// answer in the first few rows; someone harvesting the member list has to
// work for it one query at a time.
const MAX_RESULTS = 20

// Four words is a generous full name. Past that it is someone pasting a
// sentence, and each word costs another filter on the query.
const MAX_TERMS = 4

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
  const cleaned = raw.replace(/[(),]/g, '').trim()
  if (cleaned.length < MIN_QUERY) return { ok: false, error: `Type at least ${MIN_QUERY} characters` }

  // Split on whitespace so a full name works. Matching the whole string
  // against one column meant "경훈 박" found nobody: the first name is
  // "경훈" and the last is "박", and neither contains both.
  //
  // Each word must match one column or the other, so "Hamin Oh" needs
  // "Hamin" somewhere and "Oh" somewhere — not both in the same field.
  //
  // No per-word minimum: "박" is one character and a whole surname. The
  // length guard is on the query as a whole, which is what stops a single
  // letter from listing the site.
  const terms = cleaned.split(/\s+/).filter(Boolean).slice(0, MAX_TERMS)

  return { ok: true, id: null, terms }
}

module.exports = { parseUserQuery, MIN_QUERY, MAX_RESULTS, MAX_TERMS }
