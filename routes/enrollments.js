const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { sendEmail } = require('../utils/mailer')
const { requireAuth } = require('../middleware/auth')
const { pickNextUnjoinedSession } = require('../utils/pickSession')
const { recordWeeklyActivity } = require('../utils/streak')
const { maybeSendLowCreditNudge, resetLowCreditNotificationIfToppedUp } = require('../utils/lowCreditNudge')
const { blocksSpend, hasEverTaught } = require('../utils/creditSpendGate')
const { canConfirmAttendance } = require('../utils/attendanceConfirm')
const { canRefundCancellation } = require('../utils/enrollmentCancel')
const { isSessionFullError } = require('../utils/enrollmentCapacity')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// POST /api/enrollments - enroll in a class
router.post('/', requireAuth, async (req, res) => {
  const { class_id } = req.body
  const user_id = req.userId
  try {
    const { data: classRow } = await supabase
      .from('classes')
      .select('teacher_id')
      .eq('id', class_id)
      .single()

    if (classRow?.teacher_id === user_id) {
      return res.status(400).json({ error: "You can't join your own class" })
    }

    const { data: credit } = await supabase
      .from('credits')
      .select('balance')
      .eq('user_id', user_id)
      .single()

    if (!credit || credit.balance < 1) {
      return res.status(400).json({ error: 'Not enough credits' })
    }

    // Don't let a purely-consuming user drain their entire starting grant
    // without ever teaching — this would be their last credit
    if (blocksSpend(credit.balance - 1, await hasEverTaught(user_id))) {
      return res.status(400).json({
        error: "This would use your last credit. Teach a class first to keep earning credits — head to Classes to create one."
      })
    }

    // Find the earliest scheduled session for this class the student hasn't already joined
    // (a recurring class has multiple sessions, so this lets a student book each occurrence in turn)
    // session_date is selected, not just id: a session keeps status
    // 'scheduled' after it happens, so pickNextUnjoinedSession needs the
    // date to avoid handing back a class that already finished.
    const { data: sessions, error: sessionError } = await supabase
      .from('class_sessions')
      .select('id, session_date')
      .eq('class_id', parseInt(class_id))
      .eq('status', 'scheduled')
      .order('session_date', { ascending: true })

    if (sessionError) {
      console.log('SESSION ERROR:', sessionError)
      return res.status(400).json({ error: sessionError.message })
    }
    if (!sessions || sessions.length === 0) {
      return res.status(400).json({ error: 'No scheduled session for this class' })
    }

    const { data: myEnrollments } = await supabase
      .from('class_enrollments')
      .select('class_session_id')
      .eq('user_id', user_id)
      .in('class_session_id', sessions.map(s => s.id))

    const enrolledIds = (myEnrollments || []).map(e => e.class_session_id)
    const session = pickNextUnjoinedSession(sessions, enrolledIds)

    if (!session) {
      // Two different dead ends: nothing left to join because they took
      // every occurrence, versus nothing left because the class is over.
      // Telling someone they "already joined" a class they never attended
      // would just be confusing.
      const anyUpcoming = pickNextUnjoinedSession(sessions, [])
      return res.status(400).json({
        error: anyUpcoming
          ? 'Already joined all upcoming occurrences of this class'
          : 'This class has already happened'
      })
    }

    // Enroll student. Capacity is enforced by a trigger on this insert
    // (migrations/enforce_class_capacity.sql) rather than by counting seats
    // here, since a count-then-insert in app code lets two simultaneous
    // joins both pass. Note this runs BEFORE the credit deduction below, so
    // a rejected seat costs the student nothing.
    const { data, error } = await supabase
      .from('class_enrollments')
      .insert([{
        class_session_id: session.id,
        user_id,
        status: 'confirmed',
        attended: false
      }])
      .select()
      .single()

    if (error) {
      if (isSessionFullError(error)) {
        return res.status(400).json({ error: 'This class is already full.' })
      }
      console.log('ENROLLMENT ERROR:', error)
      return res.status(400).json({ error: error.message })
    }

    // Deduct 1 credit atomically. The balance read above is only an advisory
    // pre-check for the messages up top — two simultaneous joins can both
    // pass it, so the actual spend must be conditional in the DB. If it can't
    // cover the credit (lost the race for the user's last one), undo the seat
    // just taken so the student isn't enrolled for free.
    const { data: newBalance, error: spendError } = await supabase
      .rpc('spend_credit', { p_user_id: user_id, p_amount: 1 })

    if (spendError || newBalance === null) {
      await supabase.from('class_enrollments').delete().eq('id', data.id)
      return res.status(400).json({ error: 'Not enough credits' })
    }

    await supabase
      .from('credit_transactions')
      .insert([{
        user_id,
        amount: -1,
        type: 'spent',
        description: 'Joined a class'
      }])

    // Credit was just spent (not an admin/refund adjustment) — the right
    // trigger point for the low-credit nudge
    await maybeSendLowCreditNudge(user_id, newBalance)

    const { data: cls } = await supabase
      .from('classes')
      .select('title, teacher_id')
      .eq('id', class_id)
      .single()

    const { data: teacher } = await supabase
      .from('users')
      .select('email, first_name')
      .eq('id', cls?.teacher_id)
      .single()

    const { data: student } = await supabase
      .from('users')
      .select('first_name, email')
      .eq('id', user_id)
      .single()

    await sendEmail({
      to: teacher?.email,
      subject: `A student joined '${cls?.title}'`,
      text: `Hi ${teacher?.first_name}, ${student?.first_name} has joined your class.`
    })

    if (cls?.teacher_id) {
      await supabase.from('notifications').insert([{
        user_id: cls.teacher_id,
        type: 'student_joined',
        class_session_id: session.id,
        message: `${student?.first_name || 'A student'} joined '${cls?.title}'`
      }])
    }

    res.status(201).json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/enrollments/:id/confirm
router.post('/:id/confirm', requireAuth, async (req, res) => {
  const user_id = req.userId
  try {
    const { data: existing, error: fetchError } = await supabase
      .from('class_enrollments')
      .select('id, class_session_id, class_sessions(session_date)')
      .eq('id', req.params.id)
      .eq('user_id', user_id)
      .single()

    if (fetchError || !existing) return res.status(400).json({ error: 'Enrollment not found' })
    if (!canConfirmAttendance(existing.class_sessions.session_date)) {
      return res.status(400).json({ error: "This class hasn't happened yet" })
    }

    // Only the first confirm transitions 'confirmed' -> 'attended'. A repeat
    // call matches no row, so the teacher credit granted below can't be minted
    // again by replaying /confirm on the same enrollment. Without this guard,
    // a student could re-confirm a past class N times for N teacher credits.
    const { data: enrollment, error } = await supabase
      .from('class_enrollments')
      .update({ attended: true, status: 'attended' })
      .eq('id', req.params.id)
      .eq('user_id', user_id)
      .eq('status', 'confirmed')
      .select()
      .maybeSingle()

    if (error) return res.status(400).json({ error: error.message })
    // Already confirmed once — the credit below has already been paid out.
    if (!enrollment) return res.json({ success: true, already: true })

    // Student attended a class this week — counts toward their weekly activity streak
    await recordWeeklyActivity(user_id)

    const { data: session } = await supabase
      .from('class_sessions')
      .select('class_id')
      .eq('id', enrollment.class_session_id)
      .single()

    const { data: cls } = await supabase
      .from('classes')
      .select('teacher_id')
      .eq('id', session.class_id)
      .single()

    // Atomic grant so concurrent confirms can't lose each other's +1. NULL
    // means the teacher has no credits row to top up — skip the transaction
    // rather than record an 'earned' row that never moved a balance.
    const { data: newTeacherBalance } = await supabase
      .rpc('add_credit', { p_user_id: cls.teacher_id, p_amount: 1 })

    if (newTeacherBalance !== null) {
      await supabase
        .from('credit_transactions')
        .insert([{
          user_id: cls.teacher_id,
          amount: 1,
          type: 'earned',
          description: 'Student confirmed attendance'
        }])

      // Teacher just topped up — clears the low-credit flag if they're back above threshold
      await resetLowCreditNotificationIfToppedUp(cls.teacher_id, newTeacherBalance)
    }

    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not confirm attendance' })
  }
})

// POST /api/enrollments/:id/cancel — student cancels their own upcoming
// booking. Refunds the credit only if done 24h+ before the session (see
// utils/enrollmentCancel.js); deletes the row either way so the seat frees
// up and a later re-join isn't blocked by a stale enrollment.
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const user_id = req.userId
  try {
    const { data: enrollment, error: fetchError } = await supabase
      .from('class_enrollments')
      .select('id, status, class_sessions(session_date)')
      .eq('id', req.params.id)
      .eq('user_id', user_id)
      .single()

    if (fetchError || !enrollment) return res.status(404).json({ error: 'Enrollment not found' })
    if (enrollment.status !== 'confirmed') {
      return res.status(400).json({ error: 'This class has already happened' })
    }

    const refund = canRefundCancellation(enrollment.class_sessions.session_date)

    // Delete only while still 'confirmed', and let only the call that
    // actually removed the row continue to the refund below. A concurrent
    // double-cancel would otherwise both read 'confirmed' and both refund
    // the same booking. Same deleted-row-gates-refund trick as
    // classRequests.js DELETE /:id. See tests/enrollmentCancel.test.js.
    const { data: removed, error: deleteError } = await supabase
      .from('class_enrollments')
      .delete()
      .eq('id', enrollment.id)
      .eq('user_id', user_id)
      .eq('status', 'confirmed')
      .select('id')

    if (deleteError) return res.status(400).json({ error: deleteError.message })
    // Another request already cancelled it — don't refund twice.
    if (!removed || removed.length === 0) {
      return res.status(404).json({ error: 'Enrollment not found' })
    }

    if (refund) {
      await supabase.rpc('add_credit', { p_user_id: user_id, p_amount: 1 })

      await supabase
        .from('credit_transactions')
        .insert([{
          user_id,
          amount: 1,
          type: 'refunded',
          description: 'Cancelled class 24h+ before start'
        }])
    }

    res.json({ success: true, refunded: refund })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not cancel enrollment' })
  }
})

// GET /api/enrollments
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('class_enrollments')
      .select('*, class_sessions(*, classes(*, teacher:users!teacher_id(id, first_name, last_name, photo_url)))')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch enrollments' })
  }
})

module.exports = router
