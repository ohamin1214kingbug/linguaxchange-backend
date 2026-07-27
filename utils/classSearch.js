// Pure. PostgREST can't easily order a parent query by an aggregate/min of
// a child table (a class's earliest session_date lives on class_sessions,
// not classes), so sorting happens here in JS after the filtered rows come
// back — simple substring search over ILIKE is already the proportionate
// amount of engineering for this app's scale, and the same philosophy
// applies to sorting a small, unpaginated result set.
function earliestFutureSessionDate(cls, now = new Date()) {
  const upcoming = (cls.class_sessions || [])
    .filter(s => s.status === 'scheduled' && new Date(s.session_date) > now)
    .map(s => new Date(s.session_date))

  if (upcoming.length === 0) return null
  return new Date(Math.min(...upcoming))
}

// Classes with no remaining future session sort to the end rather than
// being dropped — they're still valid results for a text/teacher search,
// just not worth surfacing first in a "what can I join soon" browse.
function sortBySoonest(classes, now = new Date()) {
  return [...classes].sort((a, b) => {
    const aDate = earliestFutureSessionDate(a, now)
    const bDate = earliestFutureSessionDate(b, now)
    if (!aDate && !bDate) return 0
    if (!aDate) return 1
    if (!bDate) return -1
    return aDate - bDate
  })
}

module.exports = { earliestFutureSessionDate, sortBySoonest }
