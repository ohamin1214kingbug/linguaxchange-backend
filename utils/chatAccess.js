// Who may read and write a class session's chat, and until when. Pure, so
// the rules are tested without a database.
//
// The teacher and every student with a booking may use it, from the moment
// they book until 24 hours after the class ends. That includes a session
// that was cancelled and a booking cancelled with it (owner, 2026-11-27):
// the teacher can still explain and share the PDF. A student who cancels
// for themselves has their booking deleted, so they leave the chat.
const CHAT_MAX = 500
const OPEN_AFTER_END_MS = 24 * 60 * 60 * 1000

function chatAccess({ isTeacher, enrollmentStatus, sessionDate, durationMinutes, now = new Date() }) {
  const allowed = Boolean(isTeacher) || Boolean(enrollmentStatus)
  const end = new Date(sessionDate).getTime() + (durationMinutes || 60) * 60 * 1000
  const closesAt = new Date(end + OPEN_AFTER_END_MS)
  const open = allowed && now <= closesAt
  return { allowed, open, closesAt }
}

// Trimmed body, or null when empty or too long.
function cleanMessage(body) {
  if (typeof body !== 'string') return null
  const text = body.trim()
  return text && text.length <= CHAT_MAX ? text : null
}

module.exports = { chatAccess, cleanMessage, CHAT_MAX }
