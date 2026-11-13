const { createClient } = require('@supabase/supabase-js')
const { pushNotifications } = require('./push')

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
  if (!error) pushNotifications(rows)
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

// After a class: ask each student who has not confirmed yet to confirm and
// review. Confirming is what pays the teacher straight away (otherwise after
// 72h) and unlocks the review, and both were easy to miss. Students only:
// the teacher has nothing to confirm.
const ENDED_GRACE_MS = 10 * 60 * 1000
// Only sessions that ended recently. The first run after deploy must not
// notify about every class since the beginning.
const ENDED_LOOKBACK_MS = 24 * 60 * 60 * 1000

// Pure. Over (with a few minutes' grace for classes that run long) and not
// longer ago than the lookback.
function isRecentlyEnded(session, now = new Date()) {
  const end = new Date(session.session_date).getTime() + (session.classes?.duration_minutes || 60) * 60 * 1000
  return end + ENDED_GRACE_MS <= now.getTime() && now.getTime() - end <= ENDED_LOOKBACK_MS
}

async function sendEndedNotifications(now = new Date()) {
  // Duration lives on the class, so the end time is worked out here rather
  // than in the query; the query only bounds the start.
  const { data: sessions } = await supabase
    .from('class_sessions')
    .select('id, session_date, classes(title, duration_minutes)')
    .eq('status', 'scheduled')
    .is('ended_notified_at', null)
    .gte('session_date', new Date(now.getTime() - ENDED_LOOKBACK_MS - 6 * 60 * 60 * 1000).toISOString())
    .lte('session_date', now.toISOString())

  let sent = 0
  for (const session of (sessions || []).filter(s => isRecentlyEnded(s, now))) {
    try {
      const { data: claimed } = await supabase
        .from('class_sessions')
        .update({ ended_notified_at: now.toISOString() })
        .eq('id', session.id)
        .is('ended_notified_at', null)
        .select('id')
      if (!claimed || claimed.length === 0) continue

      // 'confirmed' = booked and not yet confirmed as attended.
      const { data: enrollments } = await supabase
        .from('class_enrollments')
        .select('user_id')
        .eq('class_session_id', session.id)
        .eq('status', 'confirmed')
      const rows = (enrollments || []).map(e => ({
        user_id: e.user_id,
        type: 'class_ended',
        class_session_id: session.id,
        message: `How was '${session.classes?.title}'? Confirm you attended and leave a review.`,
      }))
      if (!rows.length) continue
      const { error } = await supabase.from('notifications').insert(rows)
      if (error) { console.error('[CLASS_ENDED] Could not save notifications', error.message); continue }
      pushNotifications(rows)
      sent += rows.length
    } catch (e) {
      console.error('[CLASS_ENDED] Failed to process session', session.id, e.message)
    }
  }
  return sent
}

module.exports = { computeStartingSoonWindow, computeLiveWindow, isRecentlyEnded, sendStartingSoonNotifications, sendLiveNotifications, sendEndedNotifications }
