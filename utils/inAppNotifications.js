const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const STARTING_SOON_MIN_MS = 8 * 60 * 1000
const STARTING_SOON_MAX_MS = 13 * 60 * 1000
// A session still counts as "just started" for this long after session_date
// — same 5-min-wide-window idea as the reminder windows, sized to the
// cron's own 5-minute polling interval.
const LIVE_GRACE_MS = 5 * 60 * 1000

function computeStartingSoonWindow(now = new Date()) {
  return {
    from: new Date(now.getTime() + STARTING_SOON_MIN_MS),
    to: new Date(now.getTime() + STARTING_SOON_MAX_MS)
  }
}

function computeLiveWindow(now = new Date()) {
  return {
    from: new Date(now.getTime() - LIVE_GRACE_MS),
    to: now
  }
}

async function notifyParticipants(session, type, message) {
  const cls = session.classes
  if (!cls) return 0

  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('user_id')
    .eq('class_session_id', session.id)
    .eq('status', 'confirmed')

  const userIds = [cls.teacher_id, ...(enrollments || []).map(e => e.user_id)]
  const rows = userIds.map(user_id => ({ user_id, type, class_session_id: session.id, message }))

  const { error } = await supabase.from('notifications').insert(rows)
  return error ? 0 : rows.length
}

// Shared by both notification types below: claim the session (atomic
// conditional update on `column`, same as classReminder.js's
// reminder_sent_at) before notifying, so an overlapping cron run can't
// double-send.
async function claimAndNotify(sessions, column, type, buildMessage) {
  let sent = 0
  for (const session of sessions || []) {
    try {
      const { data: claimed } = await supabase
        .from('class_sessions')
        .update({ [column]: new Date().toISOString() })
        .eq('id', session.id)
        .is(column, null)
        .select()

      if (!claimed || claimed.length === 0) continue // lost the race to another run

      sent += await notifyParticipants(session, type, buildMessage(session))
    } catch (e) {
      console.error('[IN_APP_NOTIFICATIONS] Failed to process session', session.id, e.message)
    }
  }
  return sent
}

async function sendStartingSoonNotifications(now = new Date()) {
  const { from, to } = computeStartingSoonWindow(now)
  const { data: sessions } = await supabase
    .from('class_sessions')
    .select('id, classes(teacher_id, title)')
    .eq('status', 'scheduled')
    .is('starting_soon_notified_at', null)
    .gte('session_date', from.toISOString())
    .lte('session_date', to.toISOString())

  return claimAndNotify(sessions, 'starting_soon_notified_at', 'class_starting_soon',
    session => `'${session.classes?.title}' starts in 10 minutes`)
}

async function sendLiveNotifications(now = new Date()) {
  const { from, to } = computeLiveWindow(now)
  const { data: sessions } = await supabase
    .from('class_sessions')
    .select('id, classes(teacher_id, title)')
    .eq('status', 'scheduled')
    .is('live_notified_at', null)
    .gte('session_date', from.toISOString())
    .lte('session_date', to.toISOString())

  return claimAndNotify(sessions, 'live_notified_at', 'class_started',
    session => `'${session.classes?.title}' has started`)
}

module.exports = { computeStartingSoonWindow, computeLiveWindow, sendStartingSoonNotifications, sendLiveNotifications }
