// Picks the earliest scheduled session a student hasn't already joined.
// `sessions` must already be ordered earliest-first. Returns undefined if
// the student has joined every session in the list.
function pickNextUnjoinedSession(sessions, enrolledSessionIds) {
  const enrolled = new Set(enrolledSessionIds)
  return sessions.find(s => !enrolled.has(s.id))
}

module.exports = { pickNextUnjoinedSession }
