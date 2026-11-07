const { createClient } = require('@supabase/supabase-js')
const { recordCreditTransaction } = require('./creditLedger')
const { resetLowCreditNotificationIfToppedUp } = require('./lowCreditNudge')
const { rewardReferral } = require('./referrals')

let client
function db() {
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  return client
}

// A teacher was paid only when each student pressed "confirm attendance".
// Most never do, so a teacher could teach four people and earn nothing — and
// teaching is the only way to earn. A student's banana now reaches the
// teacher on its own this long after the class, the same 72 hours writing
// feedback already waits (assignmentCredits.AUTO_RELEASE_HOURS).
const AUTO_PAY_HOURS = 72

// Only recent sessions are swept. Keeps the scan small, and keeps the first
// run after launch from paying out old test bookings nobody ever confirmed.
const LOOKBACK_DAYS = 14

const HOUR_MS = 60 * 60 * 1000

// teacher_paid_at is the one lock both payout paths go through: the
// student's confirm and the sweep below. Whichever claims it first pays;
// the other finds it taken. It is separate from status/attended on purpose —
// an automatic payout must not record that the student attended, which feeds
// their participation record, badges and review rights.
async function claimTeacherPayout(enrollmentId, now = new Date()) {
  const { data, error } = await db()
    .from('class_enrollments')
    .update({ teacher_paid_at: now.toISOString() })
    .eq('id', enrollmentId)
    .is('teacher_paid_at', null)
    .select('id')
  if (error) return { claimed: false, error }
  return { claimed: !!(data && data.length > 0) }
}

// Releases a claim whose payout did not apply, so the sweep can retry it.
async function releaseClaim(enrollmentId) {
  const { error } = await db()
    .from('class_enrollments')
    .update({ teacher_paid_at: null })
    .eq('id', enrollmentId)
  if (error) {
    console.error('[CREDIT_LEDGER] could not un-claim payout for enrollment', enrollmentId,
      '— marked paid with NO payout and will not be retried, needs a manual top-up', error.message)
  }
}

// Type 'earned' on purpose: creditSpendGate.hasEverTaught counts these rows,
// and a teacher paid automatically has taught just as much as one whose
// students clicked the button.
async function payTeacher(teacherId, description) {
  const { data: balance, error } = await db()
    .rpc('add_credit', { p_user_id: teacherId, p_amount: 1 })
  if (error || balance === null) return { ok: false, reason: error?.message || 'no credits row' }
  await recordCreditTransaction(db(), { user_id: teacherId, amount: 1, type: 'earned', description })
  await resetLowCreditNotificationIfToppedUp(teacherId, balance)
  return { ok: true }
}

// A student who reported the teacher or the class has said something went
// wrong, so their banana waits for an admin instead of paying out on a timer.
// Fails closed: if reports can't be read, nothing is paid this tick.
async function hasOpenComplaint(studentId, teacherId, classId) {
  const { data, error } = await db()
    .from('reports')
    .select('id')
    .eq('reporter_id', studentId)
    .neq('status', 'rejected')
    .or(`and(report_type.eq.user,reported_id.eq.${Number(teacherId)}),and(report_type.eq.class,reported_id.eq.${Number(classId)})`)
    .limit(1)
  if (error) return true
  return (data || []).length > 0
}

async function releaseDueAttendancePayouts(now = new Date()) {
  const dueBefore = new Date(now.getTime() - AUTO_PAY_HOURS * HOUR_MS)
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * HOUR_MS)
  let paid = 0
  try {
    // 'attended' is included so a confirm whose payout failed (and was
    // un-claimed) gets retried here too.
    const { data: due, error } = await db()
      .from('class_enrollments')
      .select('id, user_id, class_sessions!inner(session_date, status, classes(id, teacher_id))')
      .in('status', ['confirmed', 'attended'])
      .is('teacher_paid_at', null)
      .neq('class_sessions.status', 'cancelled')
      .lt('class_sessions.session_date', dueBefore.toISOString())
      .gte('class_sessions.session_date', since.toISOString())
    if (error) throw error

    for (const row of due || []) {
      const cls = row.class_sessions?.classes
      if (!cls?.teacher_id) continue
      if (await hasOpenComplaint(row.user_id, cls.teacher_id, cls.id)) continue

      const claim = await claimTeacherPayout(row.id, now)
      if (!claim.claimed) continue

      const payout = await payTeacher(cls.teacher_id, 'Class attendance (paid automatically after 72 hours)')
      if (payout.ok) {
        paid++
        // Paid out as attended, so it counts as an invited member's first class.
        await rewardReferral(row.user_id)
      } else {
        console.error('[CREDIT_LEDGER] automatic attendance payout not applied for teacher', cls.teacher_id,
          'enrollment', row.id, payout.reason, '— will retry next tick')
        await releaseClaim(row.id)
      }
    }
  } catch (e) {
    // null, not 0: the cron response must tell "nothing was due" apart from
    // "the sweep is broken", or a failing query looks like a quiet day.
    console.error('releaseDueAttendancePayouts failed', e)
    return { paid: null }
  }
  return { paid }
}

module.exports = {
  AUTO_PAY_HOURS, LOOKBACK_DAYS,
  claimTeacherPayout, releaseClaim, payTeacher, releaseDueAttendancePayouts
}
