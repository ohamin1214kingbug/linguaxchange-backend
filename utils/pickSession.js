// Picks the earliest scheduled session a student hasn't already joined.
// `sessions` must already be ordered earliest-first. Returns undefined if
// the student has joined every session in the list, or if the only ones
// left have already started.
//
// A session keeps status 'scheduled' after it happens — nothing flips it
// once the clock passes — so filtering on status alone would let a student
// spend a credit joining a class that already finished. The date check is
// what actually makes "upcoming" mean upcoming.
//
// Sessions without a session_date are treated as joinable so a caller that
// only selected ids keeps working; every caller that can enforce the rule
// passes the date.
function pickNextUnjoinedSession(sessions, enrolledSessionIds, now = new Date()) {
  const enrolled = new Set(enrolledSessionIds)
  return (sessions || []).find(s =>
    !enrolled.has(s.id) &&
    (s.session_date === undefined || new Date(s.session_date) > now)
  )
}

module.exports = { pickNextUnjoinedSession }
