// Interest tags, Discord-role style (owner, 2026-11-28): members pick up to
// 5 from a fixed list at sign-up or in settings. A fixed list, not free
// text: it translates into all 7 languages, needs no moderation, and two
// members' tags can be compared to sort tandem partners. Keys only here;
// the labels live in the frontend translations (interests.<key>).
const INTERESTS = ['music', 'movies', 'anime', 'sports', 'gaming', 'travel', 'food', 'books',
  'business', 'exams', 'tech', 'art', 'culture', 'humour', 'pets', 'daily']
const MAX_INTERESTS = 5

// Known keys, no duplicates, at most 5, in list order; null when the input
// isn't a list at all.
function cleanInterests(value) {
  if (!Array.isArray(value)) return null
  const picked = new Set(value)
  return INTERESTS.filter(k => picked.has(k)).slice(0, MAX_INTERESTS)
}

// How many interests two members share.
function sharedInterests(a, b) {
  const mine = new Set(a?.interests || [])
  return (b?.interests || []).filter(k => mine.has(k)).length
}

module.exports = { INTERESTS, MAX_INTERESTS, cleanInterests, sharedInterests }
