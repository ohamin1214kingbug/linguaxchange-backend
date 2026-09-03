const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { loginLimiter } = require('../middleware/rateLimit')
const { deleteAccount } = require('../utils/deleteAccount')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// GET /api/account/export
// Streams straight to the response — nothing is written to storage, same as
// the certificate flow. Everything here is scoped to req.userId; where a row
// necessarily involves someone else (a report names who was reported, a
// review names its author) the other party's identity is left out rather
// than exported into this user's file.
router.get('/export', requireAuth, async (req, res) => {
  try {
    const id = req.userId

    const [profile, credits, transactions, classesTaught, enrollments, reviewsWritten, feedbackReceived, savedTeachers, reportsFiled] =
      await Promise.all([
        supabase.from('users')
          .select('id, email, first_name, last_name, nationality, bio, photo_url, teach_language, teach_level, learn_languages, has_certificate, certificate_explanation, created_at, timezone, timezone_source, time_format, current_streak, longest_streak, phone_number, phone_verified, is_approved')
          .eq('id', id).single(),
        supabase.from('credits').select('balance').eq('user_id', id).maybeSingle(),
        supabase.from('credit_transactions').select('*').eq('user_id', id),
        supabase.from('classes').select('*, class_sessions(*)').eq('teacher_id', id),
        supabase.from('class_enrollments').select('*').eq('user_id', id),
        supabase.from('class_reviews').select('*').eq('student_id', id),
        supabase.from('student_feedback').select('*').eq('student_id', id),
        supabase.from('saved_teachers').select('teacher_id, created_at').eq('user_id', id),
        // Only the parts that are this user's own words/actions. reported_id
        // is another person and is deliberately not included.
        supabase.from('reports').select('id, report_type, reason, status, created_at').eq('reporter_id', id)
      ])

    const payload = {
      exported_at: new Date().toISOString(),
      note: 'Everything LinguaXchange holds that is personal to your account. Records involving other people (their reviews, their bookings on your classes) are excluded.',
      profile: profile.data || null,
      credit_balance: credits.data?.balance ?? 0,
      credit_transactions: transactions.data || [],
      classes_taught: classesTaught.data || [],
      class_enrollments: enrollments.data || [],
      reviews_written: reviewsWritten.data || [],
      feedback_received: feedbackReceived.data || [],
      saved_teachers: savedTeachers.data || [],
      reports_filed: reportsFiled.data || []
    }

    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="linguaxchange-data-${id}.json"`)
    res.send(JSON.stringify(payload, null, 2))
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not export your data' })
  }
})

// POST /api/account/delete
// Anonymizes rather than deletes — see utils/accountDeletion.js for why the
// row has to survive. Rate-limited with the login limiter because it takes a
// password.
router.post('/delete', requireAuth, loginLimiter, async (req, res) => {
  const { password, confirm } = req.body

  if (confirm !== 'DELETE') {
    return res.status(400).json({ error: 'Type DELETE to confirm' })
  }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, email, first_name, password_hash, deleted_at')
      .eq('id', req.userId)
      .single()

    if (!user || user.deleted_at) return res.status(400).json({ error: 'This account is already deleted' })

    // Google-only accounts have no password to re-enter; the typed phrase
    // plus a valid session is all that's available for them.
    if (user.password_hash) {
      if (!password) return res.status(400).json({ error: 'Your password is required' })
      if (!(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Password is incorrect' })
      }
    }

    const result = await deleteAccount(supabase, user)
    if (!result.ok) return res.status(500).json({ error: 'Could not delete your account' })

    res.json({ message: 'Account deleted' })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not delete your account' })
  }
})

module.exports = router
