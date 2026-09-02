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

// True when a class still has a session someone could join.
//
// Browsing means "what can I join". A class whose sessions have all happened
// cannot be joined, so listing it is noise — and it is noise that grows: on
// 2026-09-02 ten of the fourteen classes on the public browse page were
// finished, several of them test rows with titles like "Test" and "test",
// which is what a first-time visitor saw. Sorting them last was not enough,
// because with few classes "last" is still on screen.
//
// Deliberately not applied when a teacher_id filter is present: the
// dashboard, teacher profiles, the history page and StreakCalendar all query
// by teacher and need finished classes.
function hasUpcomingSession(cls, now = new Date()) {
  return earliestFutureSessionDate(cls, now) !== null
}

// Classes with no remaining future session sort to the end rather than
// being dropped here — a teacher's own page and the history view both need
// them. The public browse drops them separately; see hasUpcomingSession.
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

module.exports = { earliestFutureSessionDate, sortBySoonest, hasUpcomingSession }
