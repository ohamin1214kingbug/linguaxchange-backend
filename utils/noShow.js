const { createClient } = require('@supabase/supabase-js')
const { recordCreditTransaction } = require('./creditLedger')
const { pushNotifications } = require('./push')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN
// The rules the owner approved (2026-11-16).
const TEACHER_GRACE_MS = 15 * MIN // teacher must open the room by start + 15 min
const STUDENT_CHECK_AFTER_END_MS = 15 * MIN
const STRIKE_WINDOW_MS = 30 * DAY
const TEACHER_STRIKES = 2, TEACHER_PAUSE_DAYS = 7
const STUDENT_STRIKES = 3, STUDENT_LIMIT_DAYS = 14
// Only recent sessions are judged, so the first run after deploy does not
// judge old classes that had no room record.
const LOOKBACK_MS = 2 * DAY

// Pure. Did the teacher fail to open the room in time?
function isTeacherNoShow({ sessionDate, teacherJoinedAt }) {
  if (!teacherJoinedAt) return true
  return new Date(teacherJoinedAt).getTime() > new Date(sessionDate).getTime() + TEACHER_GRACE_MS
}

// Pure. What a strike count leads to; `until` is null below the threshold.
function consequence(role, strikes, now = new Date()) {
  const [limit, days] = role === 'teacher' ? [TEACHER_STRIKES, TEACHER_PAUSE_DAYS] : [STUDENT_STRIKES, STUDENT_LIMIT_DAYS]
  return { strikes, limit, until: strikes >= limit ? new Date(now.getTime() + days * DAY) : null }
}

async function strike(userId, sessionId, role, now) {
  await supabase.from('no_show_events').insert([{ user_id: userId, session_id: sessionId, role }])
  const { count } = await supabase.from('no_show_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('role', role).is('undone_at', null)
    .gte('created_at', new Date(now.getTime() - STRIKE_WINDOW_MS).toISOString())
  const result = consequence(role, count || 0, now)
  if (result.until) {
    const column = role === 'teacher' ? 'teaching_paused_until' : 'booking_limited_until'
    await supabase.from('users').update({ [column]: result.until.toISOString() }).eq('id', userId)
  }
  return result
}

async function notify(rows) {
  if (!rows.length) return
  const { error } = await supabase.from('notifications').insert(rows)
  if (error) console.error('[NO_SHOW] notification failed', error.message)
  else pushNotifications(rows)
}

const day = d => d.toISOString().slice(0, 10)

// A teacher who never opened the room within 15 minutes: the session is
// cancelled, every booked student gets their banana back, and the teacher
// gets a strike (2 in 30 days: no new classes for 7 days).
async function checkTeachers(now) {
  let found = 0
  const { data: sessions, error } = await supabase.from('class_sessions')
    .select('id, session_date, classes(id, title, teacher_id)')
    .eq('status', 'scheduled').is('teacher_checked_at', null)
    .lte('session_date', new Date(now.getTime() - TEACHER_GRACE_MS).toISOString())
    .gte('session_date', new Date(now.getTime() - LOOKBACK_MS).toISOString())
  if (error) throw error
  for (const s of sessions || []) {
    const { data: claimed } = await supabase.from('class_sessions')
      .update({ teacher_checked_at: now.toISOString() }).eq('id', s.id).is('teacher_checked_at', null).select('id')
    if (!claimed?.length || !s.classes) continue
    const { data: join } = await supabase.from('room_joins').select('first_joined_at')
      .eq('session_id', s.id).eq('user_id', s.classes.teacher_id).maybeSingle()
    if (!isTeacherNoShow({ sessionDate: s.session_date, teacherJoinedAt: join?.first_joined_at })) continue

    const { data: bookings } = await supabase.from('class_enrollments')
      .select('id, user_id').eq('class_session_id', s.id).in('status', ['confirmed', 'attended'])
    if (!bookings?.length) continue // nobody booked: nobody let down
    found++
    await supabase.from('class_sessions').update({ status: 'cancelled' }).eq('id', s.id)
    for (const b of bookings) {
      try {
        const { data: balance, error: refundError } = await supabase.rpc('add_credit', { p_user_id: b.user_id, p_amount: 1 })
        if (refundError) throw new Error(refundError.message)
        if (balance !== null) {
          await recordCreditTransaction(supabase, { user_id: b.user_id, amount: 1, type: 'refunded', description: 'The teacher did not start the class', related_class_id: s.classes.id })
        }
        await supabase.from('class_enrollments').update({ status: 'cancelled' }).eq('id', b.id)
      } catch (e) {
        console.error('[NO_SHOW] REFUND FAILED, needs a manual refund: enrollment', b.id, e.message)
      }
    }
    const result = await strike(s.classes.teacher_id, s.id, 'teacher', now)
    await notify([
      ...bookings.map(b => ({ user_id: b.user_id, type: 'no_show', class_session_id: s.id,
        message: `'${s.classes.title}' did not start: the teacher never joined. Your banana is back.` })),
      { user_id: s.classes.teacher_id, type: 'no_show', class_session_id: s.id,
        message: result.until
          ? `You did not open '${s.classes.title}' within 15 minutes, so its students were refunded. That is ${result.strikes} in 30 days: you can post new classes again on ${day(result.until)}.`
          : `You did not open '${s.classes.title}' within 15 minutes, so its students were refunded. A second time within 30 days pauses new classes for 7 days.` },
    ])
  }
  return found
}

// After a class the teacher did run: booked students who never opened the
// room keep no refund (the place was held for them) and get a strike
// (3 in 30 days: one booked class at a time for 14 days). The teacher
// still earns their banana through the normal payout.
async function checkStudents(now) {
  let found = 0
  const { data: sessions, error } = await supabase.from('class_sessions')
    .select('id, session_date, classes(id, title, teacher_id, duration_minutes)')
    .eq('status', 'scheduled').is('students_checked_at', null)
    .not('teacher_checked_at', 'is', null)
    .gte('session_date', new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .lte('session_date', now.toISOString())
  if (error) throw error
  for (const s of sessions || []) {
    if (!s.classes) continue
    const end = new Date(s.session_date).getTime() + (s.classes.duration_minutes || 60) * MIN
    if (end + STUDENT_CHECK_AFTER_END_MS > now.getTime()) continue
    const { data: claimed } = await supabase.from('class_sessions')
      .update({ students_checked_at: now.toISOString() }).eq('id', s.id).is('students_checked_at', null).select('id')
    if (!claimed?.length) continue
    const [{ data: bookings }, { data: joins }] = await Promise.all([
      supabase.from('class_enrollments').select('id, user_id').eq('class_session_id', s.id).eq('status', 'confirmed'),
      supabase.from('room_joins').select('user_id').eq('session_id', s.id),
    ])
    const joined = new Set((joins || []).map(j => j.user_id))
    for (const b of (bookings || []).filter(b => !joined.has(b.user_id))) {
      found++
      await supabase.from('class_enrollments').update({ no_show_at: now.toISOString() }).eq('id', b.id)
      const result = await strike(b.user_id, s.id, 'student', now)
      await notify([{ user_id: b.user_id, type: 'no_show', class_session_id: s.id,
        message: result.until
          ? `You booked '${s.classes.title}' but did not join. That is ${result.strikes} in 30 days: until ${day(result.until)} you can book one class at a time.`
          : `You booked '${s.classes.title}' but did not join, so the banana is not refunded. If you can't come, cancel 24 h before.` }])
    }
  }
  return found
}

// On the reminders cron. Never throws: a failed check must not cost the
// reminders that share the tick. null means the check itself failed.
async function runNoShowChecks(now = new Date()) {
  try {
    return { teachers: await checkTeachers(now), students: await checkStudents(now) }
  } catch (e) {
    console.error('[NO_SHOW] check failed', e.message)
    return { teachers: null, students: null }
  }
}

// Recorded when the room token is issued (routes/video.js). Never throws.
async function recordJoin(sessionId, userId) {
  const { error } = await supabase.from('room_joins')
    .upsert([{ session_id: sessionId, user_id: userId }], { onConflict: 'session_id,user_id', ignoreDuplicates: true })
  if (error) console.error('[NO_SHOW] could not record room join', error.message)
}

module.exports = { isTeacherNoShow, consequence, runNoShowChecks, recordJoin, TEACHER_GRACE_MS }
