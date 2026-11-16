// Rules for the chat on a class request. Pure, so they are tested without
// a database.

const DAY_MS = 24 * 60 * 60 * 1000
// The request's own 24 hours plus at most 2 more while teachers talk.
const MAX_OPEN_MS = 3 * DAY_MS

// A teacher offering or writing keeps the request open 24 hours from now,
// but never past 72 hours after it was posted, and never shorter than it
// already was. This is the "paused refund clock": the banana only comes
// back once the conversation has gone quiet for a day.
function extendedExpiry({ expiresAt, createdAt, now = new Date() }) {
  const current = new Date(expiresAt).getTime()
  const cap = new Date(createdAt).getTime() + MAX_OPEN_MS
  return new Date(Math.max(current, Math.min(now.getTime() + DAY_MS, cap)))
}

// The student who asked, anyone who pressed +1, and every teacher who
// offered may read the chat. It is open while the request is: not yet
// answered with a class and not expired.
function requestChatAccess({ userId, request, interestedIds = [], teacherIds = [], now = new Date() }) {
  const isRequester = request.student_id === userId
  const isTeacher = teacherIds.includes(userId)
  const allowed = isRequester || isTeacher || interestedIds.includes(userId)
  const open = allowed && !request.fulfilled_class_id && new Date(request.expires_at) > now
  return { allowed, open, isRequester, isTeacher }
}

// Who may accept a suggested time. The student who asked accepts a time a
// teacher suggested; a teacher who offered accepts a time the student
// suggested. Either way the agreed teacher is the teacher in that pair.
function acceptTime({ proposerId, accepterId, studentId, teacherIds = [] }) {
  if (teacherIds.includes(proposerId)) {
    return accepterId === studentId
      ? { ok: true, agreedTeacherId: proposerId }
      : { ok: false, error: "Only the student who asked can accept a teacher's time" }
  }
  if (proposerId === studentId) {
    return teacherIds.includes(accepterId)
      ? { ok: true, agreedTeacherId: accepterId }
      : { ok: false, error: "Only a teacher who offered can accept the student's time" }
  }
  return { ok: false, error: 'That is not a suggested time' }
}

module.exports = { extendedExpiry, requestChatAccess, acceptTime, MAX_OPEN_MS }
