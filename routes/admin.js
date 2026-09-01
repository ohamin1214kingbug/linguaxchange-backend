const express = require('express')
const router = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { recordWeeklyActivity } = require('../utils/streak')
const { resetLowCreditNotificationIfToppedUp } = require('../utils/lowCreditNudge')
const { fail } = require('../utils/failure')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

router.use(requireAuth, requireAdmin)

// Explicit allowlist rather than select('*') — excludes password_hash and
// reset_token/reset_token_expires, which have no reason to leave the DB.
const ADMIN_USER_COLUMNS = 'id, email, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, is_approved, approval_reason, current_streak, longest_streak, timezone, phone_number, phone_verified, google_id, created_at'

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
