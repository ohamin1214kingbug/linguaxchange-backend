// The dashboard's "Chats" list. Pure, so it is tested without a database.
const { chatAccess } = require('./chatAccess')

// Newest message per thread from rows already sorted newest first.
function latestByThread(rows = []) {
  const latest = new Map()
  for (const r of rows) {
    const key = `${r.thread_type}:${r.thread_id}`
    if (!latest.has(key)) latest.set(key, r)
  }
  return latest
}

// sessions: [{ id, session_date, status, classes: { id, title, teacher_id, duration_minutes } }]
// with `enrollmentStatus` set for sessions the member booked.
// requests: open class requests the member is part of.
// Threads with messages come first, newest first; the rest by when they
// happen (a class) or close (a request).
function buildInbox({ userId, sessions = [], requests = [], messages = [], now = new Date() }) {
  const latest = latestByThread(messages)
  const last = key => {
    const m = latest.get(key)
    return m ? { id: m.id, body: m.body, created_at: m.created_at, proposed_time: m.proposed_time || null,
      user_id: m.user_id, first_name: m.users?.first_name || '', mine: m.user_id === userId } : null
  }
  const items = []
  const seen = new Set()
  for (const s of sessions) {
    if (!s?.classes || seen.has(s.id)) continue
    seen.add(s.id)
    const isTeacher = s.classes.teacher_id === userId
    const access = chatAccess({ isTeacher, enrollmentStatus: s.enrollmentStatus, sessionDate: s.session_date,
      sessionStatus: s.status, durationMinutes: s.classes.duration_minutes, now })
    if (!access.open) continue
    items.push({ type: 'session', id: s.id, title: s.classes.title, href: `/chat/${s.id}`,
      session_date: s.session_date, closes_at: access.closesAt.toISOString(), is_teacher: isTeacher,
      last: last(`session:${s.id}`) })
  }
  for (const r of requests) {
    if (r.fulfilled_class_id || new Date(r.expires_at) <= now) continue
    items.push({ type: 'request', id: r.id, title: r.topic, href: `/chat/request/${r.id}`,
      closes_at: new Date(r.expires_at).toISOString(), is_requester: r.student_id === userId,
      last: last(`request:${r.id}`) })
  }
  const when = i => i.type === 'session' ? i.session_date : i.closes_at
  return items.sort((a, b) =>
    a.last && b.last ? b.last.id - a.last.id
      : a.last ? -1 : b.last ? 1
        : new Date(when(a)) - new Date(when(b)))
}

module.exports = { buildInbox, latestByThread }
