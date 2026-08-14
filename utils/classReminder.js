const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('./mailer')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const FRONTEND_URL = 'https://linguaxchange-frontend.vercel.app'
const REMINDER_WINDOW_MIN_MS = 55 * 60 * 1000
const REMINDER_WINDOW_MAX_MS = 65 * 60 * 1000

// Pure — the 10-minute window (55-65 min out) comfortably exceeds the 5-10
// min cron polling interval, so no session is skipped between runs.
function computeReminderWindow(now = new Date()) {
  return {
    from: new Date(now.getTime() + REMINDER_WINDOW_MIN_MS),
    to: new Date(now.getTime() + REMINDER_WINDOW_MAX_MS)
  }
}

// Pure. `timezone` is an IANA zone name (e.g. "Asia/Seoul") from the user's
// profile — falls back to UTC (and says so explicitly, per spec, rather
// than guessing) for a user whose timezone hasn't been detected yet, e.g.
// they haven't logged in since this shipped.
function formatSessionTime(sessionDateISO, timezone, timeFormat) {
  const isUtcFallback = !timezone
  const zone = timezone || 'UTC'
  const display = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    dateStyle: 'medium',
    timeStyle: 'short',
    // undefined leaves Intl's own locale default in place — the exact
    // behaviour before this preference existed, for anyone who hasn't set one.
    hour12: timeFormat ? timeFormat === '12h' : undefined
  }).format(new Date(sessionDateISO)) + (isUtcFallback ? ' UTC' : '')

  return {
    display,
    isUtcFallback,
    note: isUtcFallback
      ? "This time is shown in UTC because we don't have your local timezone yet."
      : null
  }
}

async function sendReminderEmail(to, first_name, subject, bodyLines) {
  if (!to) return
  await sendEmail({
    to,
    subject,
    text: `Hi ${first_name || ''},\n\n${bodyLines.join('\n')}`
  })
}

// Called by the cron-triggered endpoint every 5-10 minutes. Claims each
// qualifying session with an atomic conditional UPDATE (reminder_sent_at IS
// NULL) BEFORE sending — not after — so an overlapping/slow cron run can't
// double-send even if two runs see the same unsent session at once. A
// session's own processing failure is isolated so one bad row can't sink
// the whole batch.
async function sendClassReminders(now = new Date()) {
  const { from, to } = computeReminderWindow(now)
  const summary = { sessionsProcessed: 0, remindersSent: 0, errors: 0 }

  try {
    const { data: sessions, error } = await supabase
      .from('class_sessions')
      .select('id, session_date, classes(id, title, teacher_id)')
      .eq('status', 'scheduled')
      .is('reminder_sent_at', null)
      .gte('session_date', from.toISOString())
      .lte('session_date', to.toISOString())

    if (error || !sessions) return summary

    for (const session of sessions) {
      try {
        const { data: claimed } = await supabase
          .from('class_sessions')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', session.id)
          .is('reminder_sent_at', null)
          .select()

        if (!claimed || claimed.length === 0) continue // lost the race to another run

        summary.sessionsProcessed++

        const cls = session.classes
        if (!cls) continue

        const { data: teacher } = await supabase
          .from('users')
          .select('email, first_name, timezone, time_format')
          .eq('id', cls.teacher_id)
          .single()

        const { data: enrollments } = await supabase
          .from('class_enrollments')
          .select('users(email, first_name, timezone, time_format)')
          .eq('class_session_id', session.id)

        const students = (enrollments || []).map(e => e.users).filter(Boolean)
        const joinLink = `${FRONTEND_URL}/classroom/${session.id}`

        // Each recipient's email renders in THEIR OWN stored timezone, not
        // one shared time for the whole session — a teacher and their
        // students can easily be in different zones.
        const teacherTime = formatSessionTime(session.session_date, teacher?.timezone, teacher?.time_format)

        // Teacher side: role-appropriate ("with [student]" only when unambiguous)
        const withWho = students.length === 0
          ? ''
          : students.length === 1
            ? ` with ${students[0].first_name}`
            : ` with ${students.length} students`

        await sendReminderEmail(teacher?.email, teacher?.first_name, 'Your class starts in 1 hour', [
          `Your class '${cls.title}'${withWho} starts in about 1 hour, at ${teacherTime.display}.`,
          teacherTime.note || '',
          `Join here: ${joinLink}`
        ].filter(Boolean))
        if (teacher?.email) summary.remindersSent++

        for (const student of students) {
          const studentTime = formatSessionTime(session.session_date, student.timezone, student.time_format)
          await sendReminderEmail(student.email, student.first_name, 'Your class starts in 1 hour', [
            `Your class with ${teacher?.first_name || 'your teacher'} starts in about 1 hour, at ${studentTime.display}.`,
            studentTime.note || '',
            `Join here: ${joinLink}`
          ].filter(Boolean))
          if (student.email) summary.remindersSent++
        }
      } catch (e) {
        console.error('[CLASS_REMINDER] Failed to process session', session.id, e.message)
        summary.errors++
      }
    }
  } catch (e) {
    console.error('[CLASS_REMINDER] Failed to query due sessions', e.message)
  }

  return summary
}

module.exports = { computeReminderWindow, formatSessionTime, sendClassReminders }
