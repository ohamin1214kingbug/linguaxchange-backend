const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('./mailer')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Pure. A class can only be edited or cancelled while it still has at least
// one scheduled session in the future — once everything's already happened
// or been cancelled, there's nothing left to change.
function hasFutureSession(sessions, now = new Date()) {
  return (sessions || []).some(s => s.status === 'scheduled' && new Date(s.session_date) > now)
}

// Cancels a class: marks the class and all its still-scheduled future
// sessions 'cancelled' (the reminder cron filters on class_sessions.status
// = 'scheduled', so this is what actually stops reminders from firing —
// classes.status alone wouldn't do that), refunds every student currently
// booked into one of those sessions, and emails them. Idempotent: calling
// this on an already-cancelled class is a no-op, not an error or a second
// refund round — checked via the class's own status, not a separate lock.
//
// No waitlist cascade here — there's no waitlist feature anywhere in this
// codebase to cascade to.
async function cancelClass(classId, cls) {
  if (cls.status === 'cancelled') {
    return { alreadyCancelled: true, refundedCount: 0 }
  }

  const now = new Date()

  const { data: sessions } = await supabase
    .from('class_sessions')
    .select('id, session_date, status')
    .eq('class_id', classId)

  const futureSessionIds = (sessions || [])
    .filter(s => s.status === 'scheduled' && new Date(s.session_date) > now)
    .map(s => s.id)

  await supabase
    .from('classes')
    .update({ status: 'cancelled' })
    .eq('id', classId)

  if (futureSessionIds.length > 0) {
    await supabase
      .from('class_sessions')
      .update({ status: 'cancelled' })
      .in('id', futureSessionIds)
  }

  let refundedCount = 0
  if (futureSessionIds.length > 0) {
    const { data: enrollments } = await supabase
      .from('class_enrollments')
      .select('id, user_id, users(email, first_name)')
      .in('class_session_id', futureSessionIds)
      .eq('status', 'confirmed')

    for (const enrollment of enrollments || []) {
      try {
        await supabase
          .rpc('add_credit', { p_user_id: enrollment.user_id, p_amount: 1 })

        await supabase
          .from('credit_transactions')
          .insert([{
            user_id: enrollment.user_id,
            amount: 1,
            type: 'refunded',
            description: 'Class cancelled',
            related_class_id: classId
          }])

        // Marked, not deleted. A student who cancels for themselves has
        // their row removed — they chose to leave. This student did not:
        // they hold a "Class cancelled" credit transaction that points at a
        // class, so the enrolment has to survive for that to make sense.
        //
        // Marked per enrolment after its own refund lands, rather than in
        // one sweep afterwards: a refund that throws leaves its row
        // 'confirmed', so a re-run picks it up. It also tightens the guard
        // this loop already relies on — the select above only takes
        // 'confirmed' rows, so a refunded student can no longer be paid a
        // second time even if the class status check is ever bypassed.
        await supabase
          .from('class_enrollments')
          .update({ status: 'cancelled' })
          .eq('id', enrollment.id)

        await sendEmail({
          to: enrollment.users?.email,
          subject: `'${cls.title}' has been cancelled`,
          text: `Hi ${enrollment.users?.first_name || ''}, the class '${cls.title}' has been cancelled by the teacher. Your credit has been refunded.`
        })

        refundedCount++
      } catch (e) {
        console.error('[CLASS_CANCEL] Failed to refund/notify enrollment', enrollment.id, e.message)
      }
    }
  }

  return { alreadyCancelled: false, refundedCount }
}

// Cancels a teacher's classes, refunding and notifying every student booked
// into them. Shared by account deletion (everything upcoming) and suspension
// (only what falls inside the suspension window).
//
// `before` is the cutoff: a class is cancelled when it has a scheduled
// session between now and then. Omitted means no cutoff, which is deletion's
// case — the teacher is not coming back.
//
// ponytail: cancels the whole class, not just the sessions inside the
// window. One class in this database is recurring and the rest are one-time,
// so the difference is currently theoretical; if recurring classes become
// common, cancel per session instead of per class.
async function cancelTeacherClasses(supabase, teacherId, { before } = {}) {
  const { data: classes } = await supabase
    .from('classes')
    .select('id, status, class_sessions(id, session_date, status)')
    .eq('teacher_id', teacherId)

  const now = new Date()
  let cancelled = 0
  let refunded = 0

  for (const cls of classes || []) {
    if (cls.status === 'cancelled') continue

    const affected = (cls.class_sessions || []).some(session => {
      if (session.status !== 'scheduled') return false
      const at = new Date(session.session_date)
      return at > now && (!before || at < before)
    })
    if (!affected) continue

    try {
      const result = await cancelClass(cls.id, cls)
      if (!result.alreadyCancelled) {
        cancelled++
        refunded += result.refundedCount
      }
    } catch (e) {
      console.error('[CANCEL_TEACHER_CLASSES] Could not cancel class', cls.id, e.message)
    }
  }

  return { cancelled, refunded }
}

module.exports = { hasFutureSession, cancelClass, cancelTeacherClasses }
