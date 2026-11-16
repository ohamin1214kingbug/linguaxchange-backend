// Who may read and write a class session's chat, and until when. Pure, so
// the rules are tested without a database.
//
// The teacher and every student with a booking that is not cancelled may
// use it, from the moment they book until 24 hours after the class ends.
// After that, and for a cancelled session, it is closed.
const CHAT_MAX = 500
const OPEN_AFTER_END_MS = 24 * 60 * 60 * 1000

function chatAccess({ isTeacher, enrollmentStatus, sessionDate, sessionStatus, durationMinutes, now = new Date() }) {
  const allowed = Boolean(isTeacher) || (Boolean(enrollmentStatus) && enrollmentStatus !== 'cancelled')
  const end = new Date(sessionDate).getTime() + (durationMinutes || 60) * 60 * 1000
  const closesAt = new Date(end + OPEN_AFTER_END_MS)
  const open = allowed && sessionStatus !== 'cancelled' && now <= closesAt
  return { allowed, open, closesAt }
}

// Trimmed body, or null when empty or too long.
function cleanMessage(body) {
  if (typeof body !== 'string') return null
  const text = body.trim()
  return text && text.length <= CHAT_MAX ? text : null
}

module.exports = { chatAccess, cleanMessage, CHAT_MAX }
