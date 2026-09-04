const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { recordWeeklyActivity } = require('../utils/streak')
const { resetLowCreditNotificationIfToppedUp } = require('../utils/lowCreditNudge')
const { fail } = require('../utils/failure')
const { sendEmail } = require('../utils/mailer')
const { deleteAccount } = require('../utils/deleteAccount')
const { cancelTeacherClasses } = require('../utils/classCancellation')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

router.use(requireAuth, requireAdmin)

// Explicit allowlist rather than select('*') — excludes password_hash and
// reset_token/reset_token_expires, which have no reason to leave the DB.
const ADMIN_USER_COLUMNS = 'id, email, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, is_approved, approval_reason, current_streak, longest_streak, timezone, phone_number, phone_verified, google_id, created_at, suspended_until, suspension_reason, deleted_at'

router.get('/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(ADMIN_USER_COLUMNS)
      .order('created_at', { ascending: false })
    if (error) return fail(res, 400, 'Could not fetch users', error)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch users' })
  }
})

router.get('/classes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('classes')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return fail(res, 400, 'Could not fetch classes', error)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch classes' })
  }
})

router.post('/users/:id/approve', async (req, res) => {
  try {
    const { error } = await supabase
      .from('users')
      .update({ is_approved: true })
      .eq('id', req.params.id)
    if (error) return fail(res, 400, 'Could not approve user', error)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not approve user' })
  }
})

router.post('/users/:id/reject', async (req, res) => {
  try {
    const { error } = await supabase
      .from('users')
      .update({ is_approved: false, approval_reason: 'Rejected by admin' })
      .eq('id', req.params.id)
    if (error) return fail(res, 400, 'Could not reject user', error)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not reject user' })
  }
})

// POST /api/admin/users/:id/credit — manual grant (support cases, goodwill,
// etc). Mirrors the exact balance-update + audit-row shape every other
// credit change already uses (see routes/enrollments.js) rather than a
// separate code path, and reuses 'earned' since the type CHECK constraint
// only allows spent/earned/refunded — there's no dedicated "granted" type,
// and adding one is a bigger change than a description string covers.
router.post('/users/:id/credit', async (req, res) => {
  const amount = parseInt(req.body.amount)
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive whole number' })
  }
  try {
    // Atomic add so a grant can't lose a concurrent spend/grant. NULL means
    // the user has no credits row.
    const { data: newBalance, error } = await supabase
      .rpc('add_credit', { p_user_id: req.params.id, p_amount: amount })
    if (error) return fail(res, 400, 'Could not add credit', error)
    if (newBalance === null) return res.status(404).json({ error: 'User not found' })

    await supabase
      .from('credit_transactions')
      .insert([{
        user_id: req.params.id,
        amount,
        type: 'earned',
        description: req.body.description || 'Credit added by admin'
      }])

    // Same "balance went up" case resetLowCreditNotificationIfToppedUp
    // already covers for teaching/attendance credit — an admin grant that
    // clears the threshold should clear the flag too.
    await resetLowCreditNotificationIfToppedUp(req.params.id, newBalance)

    await supabase.from('notifications').insert([{
      user_id: req.params.id,
      type: 'credit_added',
      message: `You received ${amount} credit${amount === 1 ? '' : 's'}`
    }])

    res.json({ success: true, balance: newBalance })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not add credit' })
  }
})

// POST /api/admin/users/:id/suspend
// A permanent ban is a far-future `until`, not a separate flag — two columns
// can disagree about whether someone is banned, one cannot.
router.post('/users/:id/suspend', async (req, res) => {
  const { until, reason } = req.body
  const userId = parseInt(req.params.id)
  if (!userId) return res.status(400).json({ error: 'Invalid user id' })

  const endsAt = new Date(until)
  if (!until || Number.isNaN(endsAt.getTime())) {
    return res.status(400).json({ error: 'A valid end date is required' })
  }
  if (endsAt <= new Date()) {
    return res.status(400).json({ error: 'The end date must be in the future' })
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required' })
  }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, email, first_name, deleted_at')
      .eq('id', userId)
      .single()

    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.deleted_at) return res.status(400).json({ error: 'That account is already deleted' })

    const { data, error } = await supabase
      .from('users')
      .update({
        suspended_until: endsAt.toISOString(),
        suspension_reason: String(reason).trim(),
        // Kills every token already issued. Without this a suspended user
        // with an open tab keeps working until their JWT expires, which is
        // not a suspension.
        token_valid_after: new Date().toISOString()
      })
      .eq('id', userId)
      .select('id, suspended_until, suspension_reason')
      .single()

    if (error) return fail(res, 400, 'Could not suspend this account', error)

    // A suspended teacher cannot run the classes they are booked for, so the
    // ones inside the suspension window are cancelled and their students
    // refunded. Leaving them standing put a class on a student's dashboard
    // that nobody could turn up to teach.
    //
    // Only inside the window: a class after the suspension ends is one the
    // teacher will be back for, and cancelling it would punish the students
    // for something already handled.
    const classes = await cancelTeacherClasses(supabase, userId, { before: endsAt })

    // Someone locked out with no explanation files a support request, and
    // answering that by hand is worse than sending the mail.
    await sendEmail({
      to: user.email,
      subject: 'Your LinguaXchange account has been suspended',
      text: `Hi ${user.first_name},\n\nYour LinguaXchange account has been suspended until ${endsAt.toUTCString()}.\n\nReason: ${String(reason).trim()}\n\n${classes.cancelled ? `${classes.cancelled} of your upcoming class(es) have been cancelled and the students refunded.\n\n` : ''}If you believe this is a mistake, reply to this email.`
    }).catch(e => console.error('[SUSPEND] Notification email failed', e.message))

    res.json({ ...data, classes_cancelled: classes.cancelled, students_refunded: classes.refunded })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not suspend this account' })
  }
})

// POST /api/admin/users/:id/unsuspend
// token_valid_after is deliberately left where the suspension put it.
// Bumping it logged them out; leaving it bumped just means signing in again.
router.post('/users/:id/unsuspend', async (req, res) => {
  const userId = parseInt(req.params.id)
  if (!userId) return res.status(400).json({ error: 'Invalid user id' })

  try {
    const { data, error } = await supabase
      .from('users')
      .update({ suspended_until: null, suspension_reason: null })
      .eq('id', userId)
      .select('id, suspended_until')
      .single()

    if (error) return fail(res, 400, 'Could not lift the suspension', error)
    if (!data) return res.status(404).json({ error: 'User not found' })
    res.json(data)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not lift the suspension' })
  }
})

// POST /api/admin/users/:id/delete
// Runs the same sequence a member's own deletion runs, so a deleted
// teacher's students still get their classes cancelled and their credits
// refunded. Irreversible, and it sits inches from Suspend, which is not —
// so it takes the user's own code typed back rather than a single click.
router.post('/users/:id/delete', async (req, res) => {
  const userId = parseInt(req.params.id)
  if (!userId) return res.status(400).json({ error: 'Invalid user id' })

  const expected = 'U' + String(userId).padStart(6, '0')
  if (req.body.confirm !== expected) {
    return res.status(400).json({ error: `Type ${expected} to confirm` })
  }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, email, first_name, deleted_at')
      .eq('id', userId)
      .single()

    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.deleted_at) return res.status(400).json({ error: 'That account is already deleted' })

    const result = await deleteAccount(supabase, user)
    if (!result.ok) return fail(res, 500, 'Could not delete this account', result.error)

    res.json({ deleted: userId })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not delete this account' })
  }
})

// POST /api/admin/classes/:id/complete
// Record-keeping/moderation only — does NOT grant credit. Credit is earned
// solely via students confirming attendance (routes/enrollments.js
// POST /:id/confirm), which scales with how many students the teacher
// actually served instead of paying a flat amount regardless of class size.
// This still drives the teacher's weekly streak and the badges "taught"
// count, both of which key off classes.status = 'completed', not credits.
router.post('/classes/:id/complete', async (req, res) => {
  try {
    // Get the class to find the teacher
    const { data: cls, error: classError } = await supabase
      .from('classes')
      .select('teacher_id, status')
      .eq('id', req.params.id)
      .single()

    if (classError || !cls) {
      return res.status(404).json({ error: 'Class not found' })
    }

    // Mark class as completed
    await supabase
      .from('classes')
      .update({ status: 'completed' })
      .eq('id', req.params.id)

    // Teacher taught a class this week — counts toward their weekly activity streak
    await recordWeeklyActivity(cls.teacher_id)

    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not complete class' })
  }
})
module.exports = router
