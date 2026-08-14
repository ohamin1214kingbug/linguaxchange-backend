const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth } = require('../middleware/auth')
const { loginLimiter } = require('../middleware/rateLimit')
const { sendEmail } = require('../utils/mailer')
const { cancelClass, hasFutureSession } = require('../utils/classCancellation')
const { anonymizedFields, OWN_DATA_DELETIONS } = require('../utils/accountDeletion')

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

    // Cancel first, while the account still looks normal: cancelClass()
    // refunds every enrolled student's credit and notifies them. Doing this
    // after anonymizing would send "your class with Deleted User was
    // cancelled" and, worse, run refunds against a half-scrubbed account.
    const { data: classes } = await supabase
      .from('classes')
      .select('id, status, class_sessions(id, session_date, status)')
      .eq('teacher_id', user.id)

    for (const cls of classes || []) {
      if (cls.status !== 'cancelled' && hasFutureSession(cls.class_sessions || [])) {
        try {
          await cancelClass(cls.id, cls)
        } catch (e) {
          console.error('[ACCOUNT_DELETE] Could not cancel class', cls.id, e.message)
        }
      }
    }

    for (const { table, column } of OWN_DATA_DELETIONS) {
      const { error } = await supabase.from(table).delete().eq(column, user.id)
      if (error) console.error('[ACCOUNT_DELETE] Could not clear', table, error.message)
    }

    // Forfeited, per policy. The credit_transactions ledger stays intact as
    // the financial record; only the spendable balance goes.
    await supabase.from('credits').update({ balance: 0 }).eq('user_id', user.id)

    // Their avatar is public and keyed by user id, so nulling photo_url
    // alone would leave the image fetchable at a guessable URL forever.
    await supabase.storage.from('avatars')
      .remove(['jpg', 'png', 'webp'].map(ext => `avatars/${user.id}.${ext}`))

    const { error: anonError } = await supabase
      .from('users')
      .update(anonymizedFields(user.id))
      .eq('id', user.id)

    if (anonError) return res.status(500).json({ error: 'Could not delete your account' })

    // Last use of the real address, after the DB work succeeded.
    await sendEmail({
      to: user.email,
      subject: 'Your LinguaXchange account has been deleted',
      text: `Hi ${user.first_name},\n\nYour LinguaXchange account has been deleted and your personal details have been removed.\n\nClasses you had scheduled were cancelled and the students enrolled in them were refunded. Records of past classes and credit transactions are kept without your name attached, because other members' history and our financial records depend on them.\n\nIf you didn't request this, reply to this email immediately.`
    }).catch(e => console.error('[ACCOUNT_DELETE] Confirmation email failed', e.message))

    res.json({ message: 'Account deleted' })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not delete your account' })
  }
})

module.exports = router
